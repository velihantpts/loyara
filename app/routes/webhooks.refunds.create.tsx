import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { clawbackRefund } from "../loyalty/clawback.server";

// Proportionally claw back points when an order is refunded. Idempotent on the
// refund GID (each partial refund claws exactly once), capped at points earned.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload, webhookId } = await authenticate.webhook(request);
  try {
    await clawbackRefund(shop, payload as Record<string, unknown>, webhookId);
  } catch (e) {
    console.warn(`[${topic}] clawback failed for ${shop} — returning 500 for retry:`, e);
    return new Response(null, { status: 500 });
  }
  return new Response();
};
