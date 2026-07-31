import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { purgeShop } from "../loyalty/purge.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // The privacy policy promises we delete all store data on uninstall. Purge
  // every table (idempotent — safe if the webhook fires more than once).
  await purgeShop(shop);

  return new Response();
};
