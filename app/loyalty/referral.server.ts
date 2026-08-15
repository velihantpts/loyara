// Referral program. A referrer gets a shareable code that mints a real Shopify
// discount for their friends (so friends have a reason to use it). When a friend's
// paid order carries that code, both sides earn points — attributed from the
// order's discount_codes, which is reliable and needs no cross-session tracking.

import crypto from "node:crypto";
import prisma from "../db.server";
import { applyEntry } from "./points.server";
import { klaviyoEvent } from "./klaviyo.server";

type GraphqlAdmin = {
  graphql: (
    query: string,
    opts?: { variables?: Record<string, unknown> },
  ) => Promise<{ json: () => Promise<unknown> }>;
};

const FRIEND_CODE_TTL_DAYS = 365;

/** Get (or lazily create + mint) the referrer's shareable code. Returns null if
 *  referrals are disabled or the mint fails. */
export async function getOrCreateReferral(
  shop: string,
  admin: GraphqlAdmin,
  referrerGid: string,
  friendDiscount: number,
): Promise<{ code: string } | null> {
  const existing = await prisma.referral.findFirst({
    where: { shop, referrerGid },
    select: { code: true },
  });
  if (existing) return { code: existing.code };
  if (friendDiscount <= 0) return null;

  const code = `REF-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const ok = await mintFriendDiscount(admin, code, friendDiscount);
  if (!ok) return null;
  await prisma.referral.create({ data: { shop, code, referrerGid } });
  return { code };
}

interface OrderRef {
  test?: boolean;
  customer?: { admin_graphql_api_id?: string; email?: string | null } | null;
  discount_codes?: { code?: string }[];
}

/** Attribute a referral from a paid order's discount codes. Idempotent: the
 *  referrer earns once per referred friend, the friend earns once ever. */
export async function attributeReferral(
  shop: string,
  payload: OrderRef,
  // See earnFromOrder: dev/App-Review stores can only place test orders, so we
  // attribute referrals on those during review; real stores skip test orders.
  accrueTestOrders = false,
): Promise<void> {
  if (payload.test && !accrueTestOrders) return; // skip test orders on real stores
  const buyerGid = payload.customer?.admin_graphql_api_id;
  const codes = (payload.discount_codes ?? [])
    .map((d) => d.code)
    .filter((c): c is string => Boolean(c));
  if (!buyerGid || codes.length === 0) return;

  const cfg = await prisma.shopConfig.findUnique({ where: { shop } });
  if (!cfg || !cfg.programActive || !cfg.isPro || cfg.referralReward <= 0) return;

  for (const code of codes) {
    const ref = await prisma.referral.findUnique({
      where: { shop_code: { shop, code } },
      select: { referrerGid: true },
    });
    if (!ref) continue;
    if (ref.referrerGid === buyerGid) continue; // no self-referral

    // Referrer earns once per referred friend.
    const refRes = await applyEntry({
      shop,
      customerGid: ref.referrerGid,
      delta: cfg.referralReward,
      reason: "EARN_REFERRAL",
      sourceType: "referral",
      sourceId: `referral:${code}:${buyerGid}`,
    });
    // Friend earns once, ever.
    const friendRes = await applyEntry({
      shop,
      customerGid: buyerGid,
      customerEmail: payload.customer?.email ?? null,
      delta: cfg.referralReward,
      reason: "EARN_REFERRAL",
      sourceType: "referral",
      sourceId: `referral-bonus:${buyerGid}`,
    });

    if (cfg.isPro && cfg.klaviyoApiKey) {
      klaviyoEvent(
        cfg.klaviyoApiKey,
        "Loyalty Referral Completed",
        payload.customer?.email ?? null,
        { points: cfg.referralReward, role: "referred", balance: friendRes.balance },
        { loyalty_points: friendRes.balance },
      );
      const referrer = await prisma.customer.findUnique({
        where: { shop_shopifyGid: { shop, shopifyGid: ref.referrerGid } },
        select: { email: true },
      });
      if (referrer?.email)
        klaviyoEvent(
          cfg.klaviyoApiKey,
          "Loyalty Referral Completed",
          referrer.email,
          { points: cfg.referralReward, role: "referrer", balance: refRes.balance },
          { loyalty_points: refRes.balance },
        );
    }
    break; // one referral attributed per order
  }
}

async function mintFriendDiscount(
  admin: GraphqlAdmin,
  code: string,
  amountOff: number,
): Promise<boolean> {
  const now = new Date();
  const ends = new Date(now.getTime() + FRIEND_CODE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const resp = await admin.graphql(
    `#graphql
    mutation Ref($basic: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basic) {
        codeDiscountNode { id }
        userErrors { message }
      }
    }`,
    {
      variables: {
        basic: {
          title: `Loyara referral ${code}`,
          code,
          startsAt: now.toISOString(),
          endsAt: ends.toISOString(),
          customerSelection: { all: true },
          customerGets: {
            value: { discountAmount: { amount: amountOff, appliesOnEachItem: false } },
            items: { all: true },
          },
          appliesOncePerCustomer: true, // each friend can use it once
        },
      },
    },
  );
  const json = (await resp.json()) as {
    data?: {
      discountCodeBasicCreate?: {
        codeDiscountNode?: { id?: string };
        userErrors?: { message?: string }[];
      };
    };
  };
  const r = json?.data?.discountCodeBasicCreate;
  if (r?.userErrors?.length) {
    console.warn("[referral] mint userErrors:", r.userErrors);
    return false;
  }
  return Boolean(r?.codeDiscountNode?.id);
}
