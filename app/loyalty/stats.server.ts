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

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRY_WARN_DAYS = 7;

export interface RetentionCohorts {
  nearReward: number; // members within 25% below their cheapest reward
  expiringSoon: number; // members whose points expire within EXPIRY_WARN_DAYS
  expiringPoints: number; // total points at risk in that window
}

// The actionable "bring them back" cohorts, computed the same way the daily
// Klaviyo nudges are (inactivity-based expiry off the last EARN; near-reward off
// the cheapest tier) — but surfaced on the dashboard so the value is visible
// even without Klaviyo. Cheap: one count + (only when expiry is on) one groupBy.
export async function retentionCohorts(
  shop: string,
  pointsExpiryDays: number,
  cheapestRewardCost: number | null,
): Promise<RetentionCohorts> {
  let nearReward = 0;
  if (cheapestRewardCost && cheapestRewardCost > 0) {
    nearReward = await prisma.customer.count({
      where: {
        shop,
        balance: {
          gte: Math.ceil(cheapestRewardCost * 0.75),
          lt: cheapestRewardCost,
        },
      },
    });
  }

  let expiringSoon = 0;
  let expiringPoints = 0;
  if (pointsExpiryDays > EXPIRY_WARN_DAYS) {
    const now = Date.now();
    const cutoff = new Date(now - pointsExpiryDays * DAY_MS);
    const warnCutoff = new Date(now - (pointsExpiryDays - EXPIRY_WARN_DAYS) * DAY_MS);
    // Points expire pointsExpiryDays after the last EARN. "Expiring soon" = that
    // last earn is past the warn threshold but not yet past the expiry cutoff.
    const lastEarns = await prisma.pointsLedger.groupBy({
      by: ["customerId"],
      where: { shop, reason: { startsWith: "EARN" } },
      _max: { createdAt: true },
    });
    const soonIds = lastEarns
      .filter(
        (r) =>
          r._max.createdAt &&
          r._max.createdAt >= cutoff &&
          r._max.createdAt < warnCutoff,
      )
      .map((r) => r.customerId);
    if (soonIds.length > 0) {
      const soon = await prisma.customer.findMany({
        where: { shop, id: { in: soonIds }, balance: { gt: 0 } },
        select: { balance: true },
      });
      expiringSoon = soon.length;
      expiringPoints = soon.reduce((s, c) => s + c.balance, 0);
    }
  }

  return { nearReward, expiringSoon, expiringPoints };
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
