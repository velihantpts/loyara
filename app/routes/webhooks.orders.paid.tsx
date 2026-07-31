import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { earnFromOrder } from "../loyalty/earn.server";
import { attributeReferral } from "../loyalty/referral.server";

// Accrue loyalty points when an order is PAID (payment captured). Idempotent on
// the order GID, so Shopify's at-least-once retries can't double-award — which is
// exactly why we return 500 on failure: a transient DB lock/timeout should be
// RETRIED by Shopify (a no-op if the accrual had actually landed) rather than
// silently swallowed and the points lost forever.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload, webhookId } = await authenticate.webhook(request);
  try {
    await earnFromOrder(shop, payload as Record<string, unknown>, webhookId);
    await attributeReferral(shop, payload as Record<string, unknown>);
  } catch (e) {
    console.warn(`[${topic}] accrual failed for ${shop} — returning 500 for retry:`, e);
    return new Response(null, { status: 500 });
  }
  return new Response();
};
