// Per-shop config helpers: ensure a ShopConfig row exists (seeded with default
// tiers on first touch) and keep the Pro mirror fresh.

import prisma from "../db.server";
import { DEFAULT_REDEEM_TIERS } from "./config";

/** Get the shop's config, creating it with sensible defaults on first call. */
export async function ensureConfig(shop: string) {
  return prisma.shopConfig.upsert({
    where: { shop },
    create: {
      shop,
      redeemTiers: JSON.stringify(DEFAULT_REDEEM_TIERS),
    },
    update: {},
  });
}

/** Mirror the Pro subscription state so webhook/proxy paths gate without a
 *  billing round-trip. Upserts so a subscription webhook can arrive before the
 *  merchant has ever opened the embedded app. */
export async function setPro(shop: string, isPro: boolean) {
  await prisma.shopConfig.upsert({
    where: { shop },
    create: {
      shop,
      isPro,
      redeemTiers: JSON.stringify(DEFAULT_REDEEM_TIERS),
    },
    update: { isPro },
  });
}

/** Once-only App Bridge review request at a peak-value moment. Returns true the
 *  single time the peak is first reached; the client then shows the prompt. */
export async function maybeRequestReview(
  shop: string,
  peak: boolean,
): Promise<boolean> {
  if (!peak) return false;
  const cfg = await prisma.shopConfig.findUnique({
    where: { shop },
    select: { reviewRequestedAt: true },
  });
  if (cfg?.reviewRequestedAt) return false;
  await prisma.shopConfig.update({
    where: { shop },
    data: { reviewRequestedAt: new Date() },
  });
  return true;
}
