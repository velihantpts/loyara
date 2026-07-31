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
import { parseRedeemTiers, parseRedemptionMode, type RedeemTier } from "./config";
import { applyEntry } from "./points.server";
import { sendEmail } from "../lib/core/email.server";
import { klaviyoEvent } from "./klaviyo.server";
import { BRAND } from "../config";

// Store credit is real money; expire it so it isn't an unbounded merchant liability
// (also acts as a fraud/abuse cap — unused credit doesn't accumulate forever).
const STORE_CREDIT_TTL_DAYS = 365;

type GraphqlAdmin = {
  graphql: (
    query: string,
    opts?: { variables?: Record<string, unknown> },
  ) => Promise<{ json: () => Promise<unknown> }>;
};

export type RedeemResult =
  | { ok: true; mode: "discount"; code: string; cost: number }
  | { ok: true; mode: "store_credit"; credited: number; currency: string; cost: number }
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

  // Resolve the requesting member up front so we can bind the idempotency key to
  // them (prevents one customer replaying another's key to read their code).
  const requester = await prisma.customer.findUnique({
    where: { shop_shopifyGid: { shop, shopifyGid: customerGid } },
    select: { id: true },
  });

  // Idempotency FIRST — before any current-config validation. A completed or
  // in-flight redemption for this key must replay to the SAME result even if the
  // merchant has since paused the program or edited/removed the tier; otherwise a
  // redemption whose points are already spent would look like a fresh error.
  const prior = await prisma.redemption.findUnique({
    where: { shop_idempotencyKey: { shop, idempotencyKey } },
  });
  if (prior) {
    // A key belongs to exactly one customer — reject a replay from anyone else.
    if (!requester || prior.customerId !== requester.id)
      return { ok: false, error: "forbidden" };
    if (prior.status === "ISSUED") {
      if (prior.discountCode)
        return { ok: true, mode: "discount", code: prior.discountCode, cost: prior.cost };
      // Store credit carries no code — replay the amount we ACTUALLY credited
      // (persisted), not a value re-derived from possibly-changed current config.
      return {
        ok: true,
        mode: "store_credit",
        credited: prior.creditAmount ?? 0,
        currency: cfg?.currency ?? "USD",
        cost: prior.cost,
      };
    }
    if (prior.status === "PENDING") return { ok: false, error: "pending" };
    // FAILED prior → the debit was already reversed; treat as done.
    return { ok: false, error: "mint_failed" };
  }

  // A genuinely NEW redemption — now validate the current config/tier.
  if (!cfg || !cfg.programActive) return { ok: false, error: "program_off" };
  if (!requester) return { ok: false, error: "no_customer" };

  const tiers = parseRedeemTiers(cfg.redeemTiers);
  const tier = tiers[tierIndex];
  // Reject a missing tier OR a garbage value (<=0 / NaN) BEFORE debiting, so a
  // misconfigured tier can't churn a debit-then-refund pair on every attempt.
  if (!tier || tier.points <= 0 || !(tier.value > 0) || !Number.isFinite(tier.value))
    return { ok: false, error: "bad_tier" };
  const cost = tier.points;

  // Store-credit fulfilment is Pro-only; a downgraded shop silently falls back to
  // discount codes (never blocks redemption). A % tier has no monetary amount, so
  // it can't be issued as store credit — reject BEFORE any debit.
  const mode = cfg.isPro ? parseRedemptionMode(cfg.redemptionMode) : "discount";
  if (mode === "store_credit" && tier.type === "percent")
    return { ok: false, error: "bad_tier" };

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
    // A key belongs to one customer — don't hand its code to a racing stranger.
    if (again && again.customerId !== requester.id)
      return { ok: false, error: "forbidden" };
    if (again?.status === "ISSUED") {
      if (again.discountCode)
        return { ok: true, mode: "discount", code: again.discountCode, cost: again.cost };
      return {
        ok: true,
        mode: "store_credit",
        credited: again.creditAmount ?? 0,
        currency: cfg.currency ?? "USD",
        cost: again.cost,
      };
    }
    if (again?.status === "PENDING") return { ok: false, error: "pending" };
    throw e;
  }

  if (debit.status === "no_customer") return { ok: false, error: "no_customer" };
  if (debit.status === "insufficient")
    return { ok: false, error: "insufficient", balance: debit.balance };

  // Debit committed. The compensating try wraps ONLY the Shopify mutation: if the
  // reward is never delivered we reverse the debit exactly once. Everything AFTER
  // a successful mutation (persisting ISSUED, emails, events) must NOT compensate —
  // refunding points the customer already got value for would be a double-payout.
  let fulfil:
    | { mode: "store_credit"; txId: string; credited: number; currency: string }
    | { mode: "discount"; code: string; nodeId: string };
  try {
    if (mode === "store_credit") {
      const currency = cfg.currency ?? (await fetchShopCurrency(admin)) ?? "USD";
      const txId = await issueStoreCredit(admin, { customerGid, amount: tier.value, currency });
      if (!txId) throw new Error("store credit failed / userErrors");
      fulfil = { mode: "store_credit", txId, credited: tier.value, currency };
    } else {
      const code = `LOYARA-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const nodeId = await mintDiscount(admin, { code, customerGid, tier });
      if (!nodeId) throw new Error("no node id / userErrors");
      fulfil = { mode: "discount", code, nodeId };
    }
  } catch (e) {
    // NOTE: a THROW here is ambiguous — the mutation may have applied at Shopify
    // before the connection dropped. We favour the customer (reverse their points);
    // the rare orphaned credit/code is a manual-reconcile edge, logged loudly.
    console.warn("[redeem] fulfilment failed, compensating debit:", shop, idempotencyKey, e);
    await applyEntry({
      shop,
      customerGid,
      delta: cost,
      reason: "ADJUST_MANUAL",
      sourceType: "manual",
      sourceId: `${idempotencyKey}:refund`, // distinct, idempotent reversal
      meta: { reason: "redeem_fulfil_failed" },
    });
    await prisma.redemption
      .update({
        where: { shop_idempotencyKey: { shop, idempotencyKey } },
        data: { status: "FAILED" },
      })
      .catch(() => {});
    return { ok: false, error: "mint_failed" };
  }

  // Reward delivered — persist ISSUED (with a small retry, since losing this write
  // strands a delivered reward as PENDING). Never compensate past this point.
  const issuedData =
    fulfil.mode === "store_credit"
      ? { status: "ISSUED", discountNodeGid: fulfil.txId, creditAmount: fulfil.credited }
      : { status: "ISSUED", discountCode: fulfil.code, discountNodeGid: fulfil.nodeId };
  let persisted = false;
  for (let attempt = 0; attempt < 3 && !persisted; attempt++) {
    try {
      await prisma.redemption.update({
        where: { shop_idempotencyKey: { shop, idempotencyKey } },
        data: issuedData,
      });
      persisted = true;
    } catch (e) {
      if (attempt === 2)
        console.error(
          "[redeem] CRITICAL: reward delivered but ISSUED write failed after retries — row left PENDING, needs manual reconcile:",
          shop,
          idempotencyKey,
          e,
        );
    }
  }

  // Best-effort notifications — must never throw out of here (would not, and must
  // not, trigger compensation; the reward already stands).
  if (fulfil.mode === "discount" && cfg.emailNotifications && cfg.isPro && debit.customerId) {
    void emailRedemptionCode(shop, debit.customerId, fulfil.code).catch(() => {});
  }
  await emitRedeemedEvent(
    cfg,
    debit.customerId,
    cost,
    fulfil.mode === "discount" ? fulfil.code : undefined,
  ).catch(() => {});

  return fulfil.mode === "store_credit"
    ? { ok: true, mode: "store_credit", credited: fulfil.credited, currency: fulfil.currency, cost }
    : { ok: true, mode: "discount", code: fulfil.code, cost };
}

/** Fire the "Loyalty Reward Redeemed" Klaviyo event (Pro + key only). Best-effort. */
async function emitRedeemedEvent(
  cfg: { isPro: boolean; klaviyoApiKey: string | null },
  customerId: string | undefined,
  cost: number,
  code?: string,
): Promise<void> {
  if (!(cfg.isPro && cfg.klaviyoApiKey && customerId)) return;
  const cust = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { email: true, balance: true },
  });
  if (!cust?.email) return;
  klaviyoEvent(
    cfg.klaviyoApiKey,
    "Loyalty Reward Redeemed",
    cust.email,
    {
      points_spent: cost,
      balance: Math.max(0, cust.balance),
      ...(code ? { code } : { store_credit: true }),
    },
    { loyalty_points: Math.max(0, cust.balance) },
  );
}

/** Credit the customer's Shopify store-credit account. Returns the transaction GID
 *  or null on failure. Amount is in whole shop-currency units (matches tier config).
 *  Credit expires (STORE_CREDIT_TTL_DAYS) so it isn't an unbounded liability. */
async function issueStoreCredit(
  admin: GraphqlAdmin,
  args: { customerGid: string; amount: number; currency: string },
): Promise<string | null> {
  if (!(args.amount > 0)) return null;
  const expiresAt = new Date(
    Date.now() + STORE_CREDIT_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const resp = await admin.graphql(
    `#graphql
    mutation Credit($id: ID!, $in: StoreCreditAccountCreditInput!) {
      storeCreditAccountCredit(id: $id, creditInput: $in) {
        storeCreditAccountTransaction { id }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        id: args.customerGid, // account owner (Customer) — Shopify resolves the account
        in: {
          creditAmount: {
            amount: args.amount.toFixed(2),
            currencyCode: args.currency,
          },
          expiresAt,
        },
      },
    },
  );

  const json = (await resp.json()) as {
    data?: {
      storeCreditAccountCredit?: {
        storeCreditAccountTransaction?: { id?: string };
        userErrors?: { message?: string }[];
      };
    };
  };
  const r = json?.data?.storeCreditAccountCredit;
  if (r?.userErrors && r.userErrors.length > 0) {
    console.warn("[redeem] storeCreditAccountCredit userErrors:", r.userErrors);
    return null;
  }
  return r?.storeCreditAccountTransaction?.id ?? null;
}

/** Fetch the shop's currency code (for store credit) when it isn't cached on the
 *  config yet. Best-effort — returns null on any failure. */
async function fetchShopCurrency(admin: GraphqlAdmin): Promise<string | null> {
  try {
    const resp = await admin.graphql(`#graphql
      query { shop { currencyCode } }`);
    const j = (await resp.json()) as {
      data?: { shop?: { currencyCode?: string } };
    };
    return j?.data?.shop?.currencyCode ?? null;
  } catch {
    return null;
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
