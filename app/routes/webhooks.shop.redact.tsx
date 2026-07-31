import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { purgeShop } from "../loyalty/purge.server";

// GDPR mandatory webhook: the shop was deleted / uninstalled ~48h ago. Remove
// ALL data we hold for this shop.
//
// Guard against a reinstall race: this redact is queued at uninstall and
// delivered ~48h later. If the merchant reinstalled in that window, uninstall
// had already purged everything and a fresh offline Session now exists — purging
// again would wipe their newly re-onboarded data and log them out. So skip when
// an active session is present (the shop is live again).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const reinstalled = await prisma.session.findFirst({
    where: { shop },
    select: { id: true },
  });
  if (reinstalled) {
    console.log(`Skipping redact for ${shop} — reinstalled since uninstall`);
    return new Response();
  }

  await purgeShop(shop);
  return new Response();
};
