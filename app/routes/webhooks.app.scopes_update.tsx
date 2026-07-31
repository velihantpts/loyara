import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  // Never throw out of a webhook — a 500 makes Shopify mark the delivery failed
  // and retry-storm us. updateMany is a no-op (not a throw) if the session row
  // isn't found, and the try/catch guards a malformed payload.
  try {
    const current = (payload as { current?: string[] })?.current;
    if (session && Array.isArray(current)) {
      await prisma.session.updateMany({
        where: { id: session.id },
        data: { scope: current.join(",") },
      });
    }
  } catch (e) {
    console.error("scopes_update handler failed:", e);
  }
  return new Response();
};
