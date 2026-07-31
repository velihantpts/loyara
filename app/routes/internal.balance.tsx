import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { displayBalance } from "../loyalty/balance.server";

// Ops/test-only read endpoint, guarded by CRON_SECRET. Lets the browserless e2e
// regression suite (_factory/scripts/e2e.mjs) verify a member's points over HTTP
// without SSH or a signed App Proxy request.
//   GET /internal/balance?key=$CRON_SECRET&shop=<shop.myshopify.com>&customerId=<numeric id>
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (
    !process.env.CRON_SECRET ||
    url.searchParams.get("key") !== process.env.CRON_SECRET
  ) {
    return json({ error: "unauthorized" }, { status: 401 });
  }
  const shop = url.searchParams.get("shop");
  const customerId = url.searchParams.get("customerId");
  if (!shop || !customerId)
    return json({ error: "shop and customerId required" }, { status: 400 });

  const customer = await prisma.customer.findUnique({
    where: {
      shop_shopifyGid: {
        shop,
        shopifyGid: `gid://shopify/Customer/${customerId}`,
      },
    },
    select: { balance: true, lifetimeEarned: true, vipTier: true },
  });

  return json({
    found: Boolean(customer),
    balance: displayBalance(customer?.balance ?? 0),
    lifetimeEarned: customer?.lifetimeEarned ?? 0,
    vipTier: customer?.vipTier ?? null,
  });
};
