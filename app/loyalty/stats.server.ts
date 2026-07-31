// Program stats for the admin dashboard + monthly summary.

import prisma from "../db.server";

export interface ProgramStats {
  members: number;
  pointsIssued: number; // lifetime EARN total
  pointsRedeemed: number; // lifetime REDEEM total (positive number)
  pointsClawedBack: number; // lifetime CLAWBACK total (positive number)
  outstanding: number; // sum of positive balances = current liability
}

export async function programStats(shop: string): Promise<ProgramStats> {
  const [members, earn, redeem, clawback, liability] = await Promise.all([
    prisma.customer.count({ where: { shop } }),
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
    prisma.customer.aggregate({
      _sum: { balance: true },
      where: { shop, balance: { gt: 0 } },
    }),
  ]);

  return {
    members,
    pointsIssued: earn._sum.delta ?? 0,
    pointsRedeemed: Math.abs(redeem._sum.delta ?? 0),
    pointsClawedBack: Math.abs(clawback._sum.delta ?? 0),
    outstanding: liability._sum.balance ?? 0,
  };
}
