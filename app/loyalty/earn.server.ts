// Earn side of the ledger: accrual from a paid order, signup bonus, birthday bonus.
// All paths funnel through applyEntry so idempotency + balance/VIP updates are
// handled in one place.

import prisma from "../db.server";
import { applyEntry } from "./points.server";
import { parseVipTiers, vipMultiplier, computeVipTier } from "./config";
import { klaviyoEvent } from "./klaviyo.server";

// Minimal shape of the orders/paid REST webhook payload we rely on.
interface OrderPayload {
  admin_graphql_api_id?: string; // gid://shopify/Order/123
  id?: number;
  test?: boolean;
  subtotal_price?: string;
  current_subtotal_price?: string;
  customer?: {
    admin_graphql_api_id?: string;
    id?: number;
    email?: string | null;
  } | null;
}

/**
 * Accrue points for a PAID order. Basis = current_subtotal_price (post line-item
 * discount, pre tax & shipping) so we never award points on money the merchant
 * didn't collect. Idempotent on the order GID.
 */
export async function earnFromOrder(
  shop: string,
  payload: OrderPayload,
  webhookEventId?: string | null,
): Promise<void> {
  if (payload.test) return; // never accrue on test orders

  const orderGid =
    payload.admin_graphql_api_id ??
    (payload.id ? `gid://shopify/Order/${payload.id}` : null);
  const customerGid = payload.customer?.admin_graphql_api_id ?? null;
  if (!orderGid || !customerGid) return; // guest checkout / nothing to attribute

  const cfg = await prisma.shopConfig.findUnique({ where: { shop } });
  if (!cfg || !cfg.programActive) return;

  const basis = parseMoney(
    payload.current_subtotal_price ?? payload.subtotal_price,
  );
  if (basis <= 0) return;

  // VIP multiplier from the member's CURRENT lifetime (pre-this-earn).
  const existing = await prisma.customer.findUnique({
    where: { shop_shopifyGid: { shop, shopifyGid: customerGid } },
    select: { lifetimeEarned: true },
  });
  // VIP multipliers are Pro-only — ignore stored tiers on a free/downgraded plan.
  const mult = cfg.isPro
    ? vipMultiplier(existing?.lifetimeEarned ?? 0, parseVipTiers(cfg.vipTiers))
    : 1;

  const points = Math.floor(basis * cfg.pointsPerDollar * mult);
  if (points <= 0) return;

  const res = await applyEntry({
    shop,
    customerGid,
    customerEmail: payload.customer?.email ?? null,
    delta: points,
    reason: "EARN_ORDER",
    sourceType: "order",
    sourceId: orderGid,
    orderGid,
    webhookEventId,
    meta: { basis, rate: cfg.pointsPerDollar, mult },
  });

  if (res.applied && cfg.isPro && cfg.klaviyoApiKey) {
    const email = payload.customer?.email ?? null;
    klaviyoEvent(
      cfg.klaviyoApiKey,
      "Loyalty Points Earned",
      email,
      { points, source: "order", balance: res.balance },
      { loyalty_points: res.balance },
    );
    // VIP tier change → its own event so flows can react.
    const tiers = parseVipTiers(cfg.vipTiers);
    const oldTier = computeVipTier(existing?.lifetimeEarned ?? 0, tiers)?.name ?? null;
    const newTier = computeVipTier(res.lifetimeEarned ?? 0, tiers)?.name ?? null;
    if (newTier && newTier !== oldTier) {
      klaviyoEvent(
        cfg.klaviyoApiKey,
        "Loyalty VIP Tier Changed",
        email,
        { tier: newTier, previous_tier: oldTier },
        { loyalty_vip_tier: newTier, loyalty_points: res.balance },
      );
    }
  }
}

/** Signup bonus — granted once per customer on customers/create. */
export async function earnSignup(
  shop: string,
  customerGid: string,
  email: string | null,
  webhookEventId?: string | null,
): Promise<void> {
  const cfg = await prisma.shopConfig.findUnique({ where: { shop } });
  if (!cfg || !cfg.programActive || cfg.signupBonus <= 0) return;

  await applyEntry({
    shop,
    customerGid,
    customerEmail: email,
    delta: cfg.signupBonus,
    reason: "EARN_SIGNUP",
    sourceType: "signup",
    sourceId: customerGid, // one signup bonus per customer, ever
    webhookEventId,
  });
}

/** Birthday bonus — granted once per customer per year (called by the daily cron). */
export async function earnBirthday(
  shop: string,
  customerGid: string,
  year: number,
): Promise<void> {
  const cfg = await prisma.shopConfig.findUnique({ where: { shop } });
  if (!cfg || !cfg.programActive || cfg.birthdayBonus <= 0) return;

  await applyEntry({
    shop,
    customerGid,
    delta: cfg.birthdayBonus,
    reason: "EARN_BIRTHDAY",
    sourceType: "birthday",
    sourceId: `${customerGid}:${year}`, // idempotent per year
  });
}

/** Parse a Shopify money string ("42.50") to a number; 0 on garbage. */
function parseMoney(s: string | undefined | null): number {
  if (!s) return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
