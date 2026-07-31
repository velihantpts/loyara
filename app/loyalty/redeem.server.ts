// Redemption: points → a customer-pinned, one-time discount code.
//
// Correctness guarantees:
//  - Idempotent on the client key (a retried request returns the SAME code, never
//    double-charges), and the key is bound to the requesting customer (no replay).
//  - Race-safe debit via a CONDITIONAL updateMany (balance >= cost) — atomic at the
//    DB level, so two concurrent redeems can never drive the balance below zero
//    (no SELECT FOR UPDATE needed; SQLite serializes writers).
//  - A concurrent same-key submit that loses the unique-constraint race re-reads
//    and returns the winner's code instead of 500-ing.
//  - Never leaves a customer debited without a code: if the mint fails we
//    compensate with a reversing ledger entry and mark the redemption FAILED.

import crypto from "node:crypto";
import prisma from "../db.server";
import { parseRedeemTiers, type RedeemTier } from "./config";
import { applyEntry } from "./points.server";
import { sendEmail } from "../lib/core/email.server";
import { BRAND } from "../config";

type GraphqlAdmin = {
  graphql: (
    query: string,
    opts?: { variables?: Record<string, unknown> },
  ) => Promise<{ json: () => Promise<unknown> }>;
};

export type RedeemResult =
  | { ok: true; code: string; cost: number }
  | {
      ok: false;
      error: "program_off" | "bad_tier" | "no_customer" | "insufficient" | "mint_failed" | "pending" | "forbidden";
      balance?: number;
    };

type DebitResult =
  | { status: "no_customer" }
  | { status: "insufficient"; balance: number }
  | { status: "debited"; customerId: string };

const CODE_TTL_DAYS = 90;

export async function redeem(args: {
  shop: string;
  admin: GraphqlAdmin;
  customerGid: string;
  tierIndex: number;
  idempotencyKey: string;
}): Promise<RedeemResult> {
  const { shop, admin, customerGid, tierIndex, idempotencyKey } = args;

  const cfg = await prisma.shopConfig.findUnique({ where: { shop } });
  if (!cfg || !cfg.programActive) return { ok: false, error: "program_off" };

  const tiers = parseRedeemTiers(cfg.redeemTiers);
  const tier = tiers[tierIndex];
  if (!tier || tier.points <= 0) return { ok: false, error: "bad_tier" };
  const cost = tier.points;

  // Resolve the requesting member up front so we can bind the idempotency key to
  // them (prevents one customer replaying another's key to read their code).
  const requester = await prisma.customer.findUnique({
    where: { shop_shopifyGid: { shop, shopifyGid: customerGid } },
    select: { id: true },
  });

  // Idempotency: a redemption already recorded for this key?
  const prior = await prisma.redemption.findUnique({
    where: { shop_idempotencyKey: { shop, idempotencyKey } },
  });
  if (prior) {
    // A key belongs to exactly one customer — reject a replay from anyone else.
    if (!requester || prior.customerId !== requester.id)
      return { ok: false, error: "forbidden" };
    if (prior.status === "ISSUED" && prior.discountCode)
      return { ok: true, code: prior.discountCode, cost: prior.cost };
    if (prior.status === "PENDING") return { ok: false, error: "pending" };
    // FAILED prior → the debit was already reversed; treat as done.
    return { ok: false, error: "mint_failed" };
  }
  if (!requester) return { ok: false, error: "no_customer" };

  // Atomic debit + ledger + redemption row, all-or-nothing.
  const runDebit = (): Promise<DebitResult> =>
    prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({
        where: { shop_shopifyGid: { shop, shopifyGid: customerGid } },
        select: { id: true, balance: true },
      });
      if (!customer) return { status: "no_customer" };

      // Conditional decrement: only succeeds if balance still covers the cost.
      const dec = await tx.customer.updateMany({
        where: { id: customer.id, balance: { gte: cost } },
        data: { balance: { decrement: cost } },
      });
      if (dec.count === 0)
        return { status: "insufficient", balance: customer.balance };

      await tx.pointsLedger.create({
        data: {
          shop,
          customerId: customer.id,
          delta: -cost,
          reason: "REDEEM",
          sourceType: "redemption",
          sourceId: idempotencyKey,
          meta: JSON.stringify({ tierIndex, value: tier.value, type: tier.type }),
        },
      });
      await tx.redemption.create({
        data: { shop, customerId: customer.id, cost, status: "PENDING", idempotencyKey },
      });
      return { status: "debited", customerId: customer.id };
    });

  let debit: DebitResult;
  try {
    debit = await runDebit();
  } catch (e) {
    // Concurrent submit with the same key: the unique constraint on the ledger /
    // redemption fired and rolled this one back. Re-read and return the winner.
    const again = await prisma.redemption.findUnique({
      where: { shop_idempotencyKey: { shop, idempotencyKey } },
    });
    if (again?.status === "ISSUED" && again.discountCode)
      return { ok: true, code: again.discountCode, cost: again.cost };
    if (again?.status === "PENDING") return { ok: false, error: "pending" };
    throw e;
  }

  if (debit.status === "no_customer") return { ok: false, error: "no_customer" };
  if (debit.status === "insufficient")
    return { ok: false, error: "insufficient", balance: debit.balance };

  // Debit committed — now mint the code. Any failure past here must compensate.
  const code = `LOYARA-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  try {
    const nodeId = await mintDiscount(admin, { code, customerGid, tier });
    if (!nodeId) throw new Error("no node id / userErrors");
    await prisma.redemption.update({
      where: { shop_idempotencyKey: { shop, idempotencyKey } },
      data: { status: "ISSUED", discountCode: code, discountNodeGid: nodeId },
    });
    // Best-effort: email the code to the customer so it's never lost.
    if (cfg.emailNotifications && debit.customerId) {
      void emailRedemptionCode(shop, debit.customerId, code).catch(() => {});
    }
    return { ok: true, code, cost };
  } catch (e) {
    console.warn("[redeem] mint failed, compensating:", shop, idempotencyKey, e);
    // Reverse the debit (distinct sourceId so it's its own idempotent entry).
    await applyEntry({
      shop,
      customerGid,
      delta: cost,
      reason: "ADJUST_MANUAL",
      sourceType: "manual",
      sourceId: `${idempotencyKey}:refund`,
      meta: { reason: "redeem_mint_failed" },
    });
    await prisma.redemption
      .update({
        where: { shop_idempotencyKey: { shop, idempotencyKey } },
        data: { status: "FAILED" },
      })
      .catch(() => {});
    return { ok: false, error: "mint_failed" };
  }
}

async function emailRedemptionCode(
  shop: string,
  customerId: string,
  code: string,
): Promise<void> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { email: true },
  });
  if (!customer?.email) return;
  const applyUrl = `https://${shop}/discount/${encodeURIComponent(code)}`;
  await sendEmail({
    to: customer.email,
    subject: `Your ${BRAND} reward code`,
    html: `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a">
      <h2>Your reward is ready 🎉</h2>
      <p>Use this code at checkout:</p>
      <p style="font-size:22px;font-family:monospace;letter-spacing:.06em;padding:12px;background:#f4f6f8;border-radius:8px;text-align:center">${code}</p>
      <p><a href="${applyUrl}" style="display:inline-block;padding:10px 18px;background:#1a1a1a;color:#fff;border-radius:8px;text-decoration:none">Apply at checkout</a></p>
      <p style="font-size:12px;color:#888">— ${BRAND}</p>
    </div>`,
  });
}

async function mintDiscount(
  admin: GraphqlAdmin,
  args: {
    code: string;
    customerGid: string;
    tier: RedeemTier;
  },
): Promise<string | null> {
  const now = new Date();
  const ends = new Date(now.getTime() + CODE_TTL_DAYS * 24 * 60 * 60 * 1000);

  const customerGets =
    args.tier.type === "percent"
      ? { value: { percentage: args.tier.value / 100 }, items: { all: true } }
      : {
          value: {
            discountAmount: {
              amount: args.tier.value,
              appliesOnEachItem: false,
            },
          },
          items: { all: true },
        };

  const resp = await admin.graphql(
    `#graphql
    mutation Redeem($basic: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basic) {
        codeDiscountNode { id }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        basic: {
          title: `Loyara reward ${args.code}`,
          code: args.code,
          startsAt: now.toISOString(),
          endsAt: ends.toISOString(),
          customerSelection: { customers: { add: [args.customerGid] } },
          customerGets,
          appliesOncePerCustomer: true,
          usageLimit: 1,
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
  const result = json?.data?.discountCodeBasicCreate;
  if (result?.userErrors && result.userErrors.length > 0) {
    console.warn("[redeem] discountCodeBasicCreate userErrors:", result.userErrors);
    return null;
  }
  return result?.codeDiscountNode?.id ?? null;
}
