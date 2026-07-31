import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { earnSignup } from "../loyalty/earn.server";

// Grant the signup bonus once when a customer account is created. Idempotent on
// the customer GID (one signup bonus per customer, ever).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload, webhookId } = await authenticate.webhook(request);
  try {
    const p = payload as {
      admin_graphql_api_id?: string;
      id?: number;
      email?: string | null;
    };
    const gid =
      p.admin_graphql_api_id ??
      (p.id ? `gid://shopify/Customer/${p.id}` : null);
    if (gid) await earnSignup(shop, gid, p.email ?? null, webhookId);
  } catch (e) {
    console.warn(`[${topic}] signup bonus failed for ${shop} — returning 500 for retry:`, e);
    return new Response(null, { status: 500 });
  }
  return new Response();
};
