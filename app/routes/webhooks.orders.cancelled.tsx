import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { clawbackCancel } from "../loyalty/clawback.server";

// Claw back whatever points remain when an order is cancelled (order-independent
// of any prior partial refunds — computes against what's already been clawed).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload, webhookId } = await authenticate.webhook(request);
  try {
    await clawbackCancel(shop, payload as Record<string, unknown>, webhookId);
  } catch (e) {
    console.warn(`[${topic}] cancel clawback failed for ${shop} — returning 500 for retry:`, e);
    return new Response(null, { status: 500 });
  }
  return new Response();
};
