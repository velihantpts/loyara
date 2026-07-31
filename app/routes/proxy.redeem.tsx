import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { redeem } from "../loyalty/redeem.server";

// App Proxy: POST /apps/loyalty/redeem  → /proxy/redeem
// Authoritative redemption. Must be logged in (signed logged_in_customer_id).
// Body: { tierIndex: number, idempotencyKey: string }.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.public.appProxy(request);
  if (!session || !admin) return json({ ok: false, error: "unauthorized" }, { status: 401 });
  const shop = session.shop;

  const url = new URL(request.url);
  const customerId = url.searchParams.get("logged_in_customer_id");
  if (!customerId)
    return json({ ok: false, error: "not_logged_in" }, { status: 401 });

  let tierIndex = -1;
  let idempotencyKey = "";
  try {
    const body = await request.json();
    tierIndex = Math.trunc(Number(body?.tierIndex));
    idempotencyKey = String(body?.idempotencyKey ?? "");
  } catch {
    // fall through to validation below
  }
  if (!Number.isFinite(tierIndex) || tierIndex < 0 || !idempotencyKey)
    return json({ ok: false, error: "bad_request" }, { status: 400 });

  const result = await redeem({
    shop,
    admin,
    customerGid: `gid://shopify/Customer/${customerId}`,
    tierIndex,
    idempotencyKey,
  });

  return json(result, { status: result.ok ? 200 : 400 });
};
