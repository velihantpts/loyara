// Core ledger primitive. Every point movement in the app goes through applyEntry,
// which is the ONLY place Customer.balance is mutated — always in the same DB
// transaction as the ledger insert, and always idempotent on the natural key
// [shop, sourceType, sourceId]. This is the correctness heart of the app.

import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { parseVipTiers, computeVipTier } from "./config";

export interface EntryInput {
  shop: string;
  customerGid: string; // gid://shopify/Customer/123
  customerEmail?: string | null;
  delta: number; // signed: +earn, -redeem, -clawback
  reason: string; // EARN_* | REDEEM | CLAWBACK_* | ADJUST_MANUAL | EXPIRE
  sourceType: string; // order | refund | cancel | signup | birthday | referral | redemption | manual | expire
  sourceId: string;
  webhookEventId?: string | null;
  orderGid?: string | null;
  meta?: unknown;
}

export interface EntryResult {
  applied: boolean; // false = idempotent duplicate, nothing changed
  customerId?: string;
  balance?: number; // true balance (may be negative)
  lifetimeEarned?: number;
}

/**
 * Idempotently append a ledger entry and move the denormalized balance.
 *
 * - Dedupe: a row already existing for [shop, sourceType, sourceId] is a no-op
 *   (returns applied:false) — this is what makes webhook retries safe.
 * - balance moves by `delta` (may go negative; display floors at 0 elsewhere).
 * - lifetimeEarned tracks EARN minus CLAWBACK (so a refunded earn doesn't inflate
 *   VIP status), floored at 0. REDEEM/EXPIRE/manual do not touch lifetime.
 * - VIP tier is recomputed from lifetimeEarned.
 */
export async function applyEntry(input: EntryInput): Promise<EntryResult> {
  const delta = Math.trunc(input.delta);
  if (!Number.isFinite(delta) || delta === 0) {
    return { applied: false };
  }

  return prisma.$transaction(async (tx) => {
    // 1. Idempotency guard on the natural key.
    const dup = await tx.pointsLedger.findUnique({
      where: {
        shop_sourceType_sourceId: {
          shop: input.shop,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
        },
      },
      select: { id: true },
    });
    if (dup) return { applied: false };

    // 2. Upsert the member.
    const customer = await tx.customer.upsert({
      where: {
        shop_shopifyGid: { shop: input.shop, shopifyGid: input.customerGid },
      },
      create: {
        shop: input.shop,
        shopifyGid: input.customerGid,
        email: input.customerEmail ?? null,
      },
      update: input.customerEmail ? { email: input.customerEmail } : {},
    });

    // 3. Append the immutable ledger row.
    await tx.pointsLedger.create({
      data: {
        shop: input.shop,
        customerId: customer.id,
        delta,
        reason: input.reason,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        webhookEventId: input.webhookEventId ?? null,
        orderGid: input.orderGid ?? null,
        meta: input.meta === undefined ? null : JSON.stringify(input.meta),
      },
    });

    // 4. Move balance + lifetime.
    const lifetimeDelta = input.reason.startsWith("EARN")
      ? delta // positive
      : input.reason.startsWith("CLAWBACK")
        ? delta // negative — reverse the earn so refunds don't game VIP
        : 0; // REDEEM / EXPIRE / ADJUST_MANUAL don't affect lifetime
    const newLifetime = Math.max(0, customer.lifetimeEarned + lifetimeDelta);

    // Recompute VIP tier from the shop's config.
    const cfg = await tx.shopConfig.findUnique({
      where: { shop: input.shop },
      select: { vipTiers: true },
    });
    const vip = computeVipTier(newLifetime, parseVipTiers(cfg?.vipTiers));

    const updated = await tx.customer.update({
      where: { id: customer.id },
      data: {
        balance: { increment: delta },
        lifetimeEarned: newLifetime,
        vipTier: vip?.name ?? null,
      },
      select: { balance: true, lifetimeEarned: true },
    });

    return {
      applied: true,
      customerId: customer.id,
      balance: updated.balance,
      lifetimeEarned: updated.lifetimeEarned,
    };
  });
}

/** Sum of clawbacks already recorded against an order (as a positive number). */
export async function clawedBackForOrder(
  shop: string,
  orderGid: string,
): Promise<number> {
  const rows = await prisma.pointsLedger.findMany({
    where: { shop, orderGid, reason: { startsWith: "CLAWBACK" } },
    select: { delta: true },
  });
  return rows.reduce((acc, r) => acc + Math.abs(r.delta), 0);
}

/** Points earned (positive) for an order — the cap for total clawback. */
export async function earnedForOrder(
  shop: string,
  orderGid: string,
): Promise<number> {
  const rows = await prisma.pointsLedger.findMany({
    where: { shop, orderGid, reason: "EARN_ORDER" },
    select: { delta: true },
  });
  return rows.reduce((acc, r) => acc + Math.max(0, r.delta), 0);
}

/** Type helper for callers that need the transaction client. */
export type Tx = Prisma.TransactionClient;
