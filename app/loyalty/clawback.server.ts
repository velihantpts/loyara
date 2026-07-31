// Clawback side of the ledger. Refunds reverse points PROPORTIONALLY to the value
// refunded (excluding tax/shipping, to mirror the earn basis); cancels reverse the
// remainder. Both are capped so total clawback for an order can never exceed what
// was earned — the source of the nastiest 1-star reviews if you get it wrong.

import prisma from "../db.server";
import { applyEntry, clawedBackForOrder } from "./points.server";

interface RefundLineItem {
  subtotal?: number;
  subtotal_set?: { shop_money?: { amount?: string } };
}
interface RefundPayload {
  admin_graphql_api_id?: string; // gid://shopify/Refund/123
  id?: number;
  order_id?: number;
  refund_line_items?: RefundLineItem[];
}
interface CancelPayload {
  admin_graphql_api_id?: string; // gid://shopify/Order/123
  id?: number;
}

/** Look up the original earn for an order: how many points + on what basis. */
async function earnFor(shop: string, orderGid: string) {
  const entry = await prisma.pointsLedger.findFirst({
    where: { shop, orderGid, reason: "EARN_ORDER" },
    select: { delta: true, meta: true, customerId: true },
  });
  if (!entry) return null;
  let basis = 0;
  try {
    basis = JSON.parse(entry.meta ?? "{}")?.basis ?? 0;
  } catch {
    basis = 0;
  }
  const cust = await prisma.customer.findUnique({
    where: { id: entry.customerId },
    select: { shopifyGid: true, email: true },
  });
  if (!cust) return null;
  return { earned: entry.delta, basis, customerGid: cust.shopifyGid, email: cust.email };
}

/** Proportional clawback for a (possibly partial, possibly repeated) refund. */
export async function clawbackRefund(
  shop: string,
  payload: RefundPayload,
  webhookEventId?: string | null,
): Promise<void> {
  const refundGid =
    payload.admin_graphql_api_id ??
    (payload.id ? `gid://shopify/Refund/${payload.id}` : null);
  const orderGid = payload.order_id
    ? `gid://shopify/Order/${payload.order_id}`
    : null;
  if (!refundGid || !orderGid) return;

  const earn = await earnFor(shop, orderGid);
  if (!earn || earn.earned <= 0) return; // never earned here

  const refundedEligible = (payload.refund_line_items ?? []).reduce(
    (acc, li) =>
      acc +
      (typeof li.subtotal === "number"
        ? li.subtotal
        : parseFloat(li.subtotal_set?.shop_money?.amount ?? "0") || 0),
    0,
  );
  if (refundedEligible <= 0) return; // shipping-only / zero-amount refund → no clawback

  const fraction = earn.basis > 0 ? Math.min(1, refundedEligible / earn.basis) : 0;
  let clawback = Math.round(earn.earned * fraction);

  // Cap: never claw back more than remains of what was earned on this order.
  const already = await clawedBackForOrder(shop, orderGid);
  clawback = Math.min(clawback, earn.earned - already);
  if (clawback <= 0) return;

  await applyEntry({
    shop,
    customerGid: earn.customerGid,
    customerEmail: earn.email,
    delta: -clawback,
    reason: "CLAWBACK_REFUND",
    sourceType: "refund",
    sourceId: refundGid, // unique per refund → each partial refund claws once
    orderGid,
    webhookEventId,
    meta: { refundedEligible, basis: earn.basis },
  });
}

/** Full clawback of whatever earn remains when an order is cancelled. */
export async function clawbackCancel(
  shop: string,
  payload: CancelPayload,
  webhookEventId?: string | null,
): Promise<void> {
  const orderGid =
    payload.admin_graphql_api_id ??
    (payload.id ? `gid://shopify/Order/${payload.id}` : null);
  if (!orderGid) return;

  const earn = await earnFor(shop, orderGid);
  if (!earn || earn.earned <= 0) return;

  const already = await clawedBackForOrder(shop, orderGid);
  const remaining = earn.earned - already;
  if (remaining <= 0) return; // already fully clawed by prior refunds

  await applyEntry({
    shop,
    customerGid: earn.customerGid,
    customerEmail: earn.email,
    delta: -remaining,
    reason: "CLAWBACK_CANCEL",
    sourceType: "cancel",
    sourceId: orderGid, // one cancel clawback per order
    orderGid,
    webhookEventId,
    meta: { reason: "order_cancelled" },
  });
}
