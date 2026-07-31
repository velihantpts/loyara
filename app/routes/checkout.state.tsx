import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { displayBalance } from "../loyalty/balance.server";
import { parseRedeemTiers, parseRedemptionMode } from "../loyalty/config";

// Checkout UI extension read endpoint. Authenticated by the extension's Shopify
// session token (server-verified) — `dest` is the shop, `sub` is the logged-in
// customer id. Returns the member's balance + the redeem tiers they can afford,
// so the extension can offer in-checkout redemption without a round-trip to the
// storefront widget. CORS is handled by the checkout auth helper.
//   GET /checkout/state
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { sessionToken, cors } = await authenticate.public.checkout(request);
  const shop = String(sessionToken.dest || "").replace(/^https?:\/\//, "");
  const customerId = String(sessionToken.sub || "");

  const config = await prisma.shopConfig.findUnique({ where: { shop } });
  const active = config?.programActive ?? false;
  const currency = config?.currency ?? "USD";
  // Store credit is Pro-only — a free/downgraded shop always delivers codes.
  const redemptionMode =
    (config?.isPro ?? false) ? parseRedemptionMode(config?.redemptionMode) : "discount";
  const tiers = parseRedeemTiers(config?.redeemTiers).map((t, i) => ({
    index: i,
    points: t.points,
    value: t.value,
    type: t.type,
  }));

  // Guest checkout (no authenticated customer) — nothing to redeem.
  if (!customerId || customerId === "0") {
    return cors(json({ ok: true, active, loggedIn: false, currency, redemptionMode }));
  }

  const customer = await prisma.customer.findUnique({
    where: {
      shop_shopifyGid: { shop, shopifyGid: `gid://shopify/Customer/${customerId}` },
    },
    select: { balance: true },
  });
  const balance = displayBalance(customer?.balance ?? 0);

  return cors(
    json({
      ok: true,
      active,
      loggedIn: true,
      currency,
      redemptionMode,
      balance,
      // Only the tiers the member can actually afford right now.
      tiers: tiers.filter((t) => balance >= t.points),
    }),
  );
};
