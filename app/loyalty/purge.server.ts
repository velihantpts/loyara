// Delete every row we hold for a shop (app/uninstalled, shop/redact) or for a
// single customer (customers/redact). Behaviour must match the privacy policy.
//
// Keep this in sync with schema.prisma: add a deleteMany for each domain table.

import prisma from "../db.server";

export async function purgeShop(shop: string) {
  await prisma.$transaction([
    prisma.referral.deleteMany({ where: { shop } }),
    prisma.redemption.deleteMany({ where: { shop } }),
    prisma.pointsLedger.deleteMany({ where: { shop } }),
    prisma.customer.deleteMany({ where: { shop } }),
    prisma.shopConfig.deleteMany({ where: { shop } }),
    prisma.session.deleteMany({ where: { shop } }),
  ]);
}

/** GDPR customers/redact — delete a single member and their ledger/redemptions. */
export async function purgeCustomer(shop: string, customerGid: string) {
  const customer = await prisma.customer.findUnique({
    where: { shop_shopifyGid: { shop, shopifyGid: customerGid } },
    select: { id: true },
  });
  if (!customer) return;
  // PointsLedger + Redemption cascade on Customer delete (onDelete: Cascade).
  await prisma.$transaction([
    prisma.referral.deleteMany({
      where: { shop, OR: [{ referrerGid: customerGid }, { refereeGid: customerGid }] },
    }),
    prisma.customer.delete({ where: { id: customer.id } }),
  ]);
}
