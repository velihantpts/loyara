import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getOrCreateReferral } from "../loyalty/referral.server";

export const loader = async (_: LoaderFunctionArgs) =>
  json({ error: "method_not_allowed" }, { status: 405 });

// App Proxy: POST /apps/loyalty/referral  → /proxy/referral
// Returns (creating on first call) the logged-in customer's shareable referral
// code. The code is a real Shopify discount the friend can use at checkout.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.public.appProxy(request);
  if (!session || !admin) return json({ ok: false }, { status: 401 });
  const shop = session.shop;

  const url = new URL(request.url);
  const customerId = url.searchParams.get("logged_in_customer_id");
  if (!customerId) return json({ ok: false, error: "not_logged_in" }, { status: 401 });

  const cfg = await prisma.shopConfig.findUnique({ where: { shop } });
  if (!cfg || !cfg.programActive || cfg.referralReward <= 0 || cfg.referralFriendDiscount <= 0)
    return json({ ok: false, error: "off" }, { status: 400 });

  const r = await getOrCreateReferral(
    shop,
    admin,
    `gid://shopify/Customer/${customerId}`,
    cfg.referralFriendDiscount,
  );
  if (!r) return json({ ok: false, error: "mint_failed" }, { status: 500 });

  return json({
    ok: true,
    code: r.code,
    reward: cfg.referralReward,
    friendDiscount: cfg.referralFriendDiscount,
  });
};
