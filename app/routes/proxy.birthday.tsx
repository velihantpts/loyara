import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async (_: LoaderFunctionArgs) =>
  json({ error: "method_not_allowed" }, { status: 405 });

// App Proxy: POST /apps/loyalty/birthday  → /proxy/birthday
// Logged-in customer stores their birthday (MM-DD) to earn the birthday bonus.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) return json({ ok: false }, { status: 401 });
  const shop = session.shop;

  const url = new URL(request.url);
  const customerId = url.searchParams.get("logged_in_customer_id");
  if (!customerId) return json({ ok: false, error: "not_logged_in" }, { status: 401 });

  let birthday = "";
  try {
    birthday = String((await request.json())?.birthday ?? "");
  } catch {
    // ignore
  }
  if (!/^\d{2}-\d{2}$/.test(birthday))
    return json({ ok: false, error: "bad_format" }, { status: 400 });

  const gid = `gid://shopify/Customer/${customerId}`;
  await prisma.customer.upsert({
    where: { shop_shopifyGid: { shop, shopifyGid: gid } },
    create: { shop, shopifyGid: gid, birthday },
    update: { birthday },
  });
  return json({ ok: true });
};
