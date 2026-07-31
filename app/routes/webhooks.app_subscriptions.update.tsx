import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { setPro } from "../loyalty/shop.server";

// Statuses that mean the subscription is truly gone. FROZEN (a recoverable
// payment-retry state) and any unknown/malformed status are deliberately NOT
// here — we don't drop a paying merchant from Pro over a transient blip; an
// unfreeze re-fires ACTIVE and the dashboard reconciles against billing anyway.
const TERMINAL = new Set(["CANCELLED", "EXPIRED", "DECLINED"]);

// Keep the Pro mirror on ShopConfig fresh so the monitoring webhook + cron can
// gate without a billing API round-trip, even if the merchant never opens the app.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const status = (payload as { app_subscription?: { status?: string } })
    ?.app_subscription?.status;
  if (status === "ACTIVE") await setPro(shop, true);
  else if (status && TERMINAL.has(status)) await setPro(shop, false);
  // else: unknown/missing status → no-op (don't flip on a malformed payload)

  return new Response();
};
