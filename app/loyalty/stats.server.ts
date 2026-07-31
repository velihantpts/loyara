// Program stats for the admin dashboard + monthly summary.

import prisma from "../db.server";

export interface ProgramStats {
  members: number;
  activeMembers: number; // members with a positive balance right now
  redeemingMembers: number; // distinct members who have ever redeemed
  pointsIssued: number; // lifetime EARN total
  pointsRedeemed: number; // lifetime REDEEM total (positive number)
  pointsClawedBack: number; // lifetime CLAWBACK total (positive number)
  pointsExpired: number; // lifetime EXPIRE total (positive number)
  outstanding: number; // sum of positive balances = current liability
  avgBalance: number; // mean balance among active members (0 if none)
  redemptionRate: number; // pointsRedeemed / pointsIssued, 0..1 (0 if none issued)
}

export async function programStats(shop: string): Promise<ProgramStats> {
  const [
    members,
    activeMembers,
    redeemers,
    earn,
    redeem,
    clawback,
    expire,
    liability,
  ] = await Promise.all([
    prisma.customer.count({ where: { shop } }),
    // Active = holds spendable points now. Covered by @@index([shop, balance]).
    prisma.customer.count({ where: { shop, balance: { gt: 0 } } }),
    // Distinct members who ever redeemed — engagement, not just points moved.
    // Filter by [shop, reason] via @@index([shop, reason, delta]), group in memory.
    prisma.pointsLedger.groupBy({
      by: ["customerId"],
      where: { shop, reason: "REDEEM" },
    }),
    prisma.pointsLedger.aggregate({
      _sum: { delta: true },
      where: { shop, reason: { startsWith: "EARN" } },
    }),
    prisma.pointsLedger.aggregate({
      _sum: { delta: true },
      where: { shop, reason: "REDEEM" },
    }),
    prisma.pointsLedger.aggregate({
      _sum: { delta: true },
      where: { shop, reason: { startsWith: "CLAWBACK" } },
    }),
    prisma.pointsLedger.aggregate({
      _sum: { delta: true },
      where: { shop, reason: "EXPIRE" },
    }),
    prisma.customer.aggregate({
      _sum: { balance: true },
      where: { shop, balance: { gt: 0 } },
    }),
  ]);

  const pointsIssued = earn._sum.delta ?? 0;
  const pointsRedeemed = Math.abs(redeem._sum.delta ?? 0);
  const outstanding = liability._sum.balance ?? 0;

  return {
    members,
    activeMembers,
    redeemingMembers: redeemers.length,
    pointsIssued,
    pointsRedeemed,
    pointsClawedBack: Math.abs(clawback._sum.delta ?? 0),
    pointsExpired: Math.abs(expire._sum.delta ?? 0),
    outstanding,
    avgBalance: activeMembers > 0 ? Math.round(outstanding / activeMembers) : 0,
    redemptionRate: pointsIssued > 0 ? pointsRedeemed / pointsIssued : 0,
  };
}
