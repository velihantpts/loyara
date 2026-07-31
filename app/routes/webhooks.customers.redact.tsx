import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { purgeCustomer } from "../loyalty/purge.server";

// GDPR mandatory webhook. Loyara stores a per-customer points balance + ledger
// keyed by customer GID, so a redact request must delete that member's data.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const p = payload as { customer?: { id?: number } };
  const id = p.customer?.id;
  if (id) await purgeCustomer(shop, `gid://shopify/Customer/${id}`);

  return new Response();
};
