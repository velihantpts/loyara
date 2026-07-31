import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// GDPR mandatory webhook. Loyara stores a per-customer record (email, points
// balance/ledger, optional birthday). We log the request with the data we hold so
// the merchant (the controller) can fulfil the subject request; Shopify only
// requires a 200 ack here.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const id = (payload as { customer?: { id?: number } }).customer?.id;
  if (id) {
    const customer = await prisma.customer.findUnique({
      where: { shop_shopifyGid: { shop, shopifyGid: `gid://shopify/Customer/${id}` } },
      select: { email: true, balance: true, lifetimeEarned: true, birthday: true, vipTier: true },
    });
    console.log(`[${topic}] ${shop} data for customer ${id}:`, customer ? JSON.stringify(customer) : "none stored");
  }
  return new Response();
};
