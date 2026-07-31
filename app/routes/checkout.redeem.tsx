import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate, unauthenticated } from "../shopify.server";
import { redeem } from "../loyalty/redeem.server";

// Clean 405 for GET/HEAD probes.
export const loader = async (_: LoaderFunctionArgs) =>
  json({ error: "method_not_allowed" }, { status: 405 });

// Checkout UI extension redemption. Authenticated by the extension's Shopify
// session token — `dest` = shop, `sub` = the logged-in customer id (both
// server-verified, so a buyer can't redeem as someone else). Reuses the exact
// same redeem() flow as the storefront widget: idempotent, race-safe debit,
// compensation on mint failure. In discount mode the extension applies the
// returned code to the checkout; in store-credit mode the credit is issued to
// the buyer's account.
//   POST /checkout/redeem  body: { tierIndex, idempotencyKey }
export const action = async ({ request }: ActionFunctionArgs) => {
  const { sessionToken, cors } = await authenticate.public.checkout(request);
  const shop = String(sessionToken.dest || "").replace(/^https?:\/\//, "");
  const customerId = String(sessionToken.sub || "");
  if (!shop || !customerId || customerId === "0")
    return cors(json({ ok: false, error: "not_logged_in" }, { status: 401 }));

  let tierIndex = -1;
  let idempotencyKey = "";
  try {
    const body = await request.json();
    tierIndex = Math.trunc(Number(body?.tierIndex));
    idempotencyKey = String(body?.idempotencyKey ?? "");
  } catch {
    // fall through to validation
  }
  if (!Number.isFinite(tierIndex) || tierIndex < 0 || !idempotencyKey)
    return cors(json({ ok: false, error: "bad_request" }, { status: 400 }));

  // Offline admin client for the shop — needed to mint the discount / issue credit.
  // Throws if the shop has no offline session (uninstalled / mid-reinstall);
  // return a clean 503 rather than an uncaught 500. This runs BEFORE any debit.
  const adminCtx = await unauthenticated.admin(shop).catch((e: unknown) => {
    console.warn("[checkout.redeem] no offline session for", shop, e);
    return null;
  });
  if (!adminCtx)
    return cors(json({ ok: false, error: "unavailable" }, { status: 503 }));
  const { admin } = adminCtx;

  const result = await redeem({
    shop,
    admin,
    customerGid: `gid://shopify/Customer/${customerId}`,
    tierIndex,
    idempotencyKey,
  });

  return cors(json(result, { status: result.ok ? 200 : 400 }));
};
