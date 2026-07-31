// Daily maintenance: inactivity-based points expiry + birthday bonuses.
// Driven by an external scheduler hitting /cron/daily?key=$CRON_SECRET.

import prisma from "../db.server";
import { applyEntry } from "./points.server";
import { earnBirthday } from "./earn.server";

const DAY_MS = 24 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");

export interface DailyResult {
  expiredMembers: number;
  birthdayGrants: number;
}

export async function runDaily(now: Date): Promise<DailyResult> {
  let expiredMembers = 0;
  let birthdayGrants = 0;

  // ── Expiry: points expire after N days of no EARN activity. Expire the whole
  //    balance in one EXPIRE entry (reason EXPIRE doesn't touch lifetime/VIP). ──
  const expiryShops = await prisma.shopConfig.findMany({
    where: { pointsExpiryDays: { gt: 0 }, programActive: true },
    select: { shop: true, pointsExpiryDays: true },
  });
  const dayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  for (const cfg of expiryShops) {
    const cutoff = new Date(now.getTime() - cfg.pointsExpiryDays * DAY_MS);
    const customers = await prisma.customer.findMany({
      where: { shop: cfg.shop, balance: { gt: 0 } },
      select: { id: true, shopifyGid: true, balance: true },
    });
    for (const c of customers) {
      const lastEarn = await prisma.pointsLedger.findFirst({
        where: { shop: cfg.shop, customerId: c.id, reason: { startsWith: "EARN" } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      if (lastEarn && lastEarn.createdAt < cutoff) {
        const res = await applyEntry({
          shop: cfg.shop,
          customerGid: c.shopifyGid,
          delta: -c.balance,
          reason: "EXPIRE",
          sourceType: "expire",
          sourceId: `expire:${c.id}:${dayKey}`,
          meta: { expiredAfterDays: cfg.pointsExpiryDays },
        });
        if (res.applied) expiredMembers++;
      }
    }
  }

  // ── Birthday grants: members whose birthday MM-DD is today. ──
  const mmdd = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const bdayShops = await prisma.shopConfig.findMany({
    where: { birthdayBonus: { gt: 0 }, programActive: true },
    select: { shop: true },
  });
  for (const cfg of bdayShops) {
    const customers = await prisma.customer.findMany({
      where: { shop: cfg.shop, birthday: mmdd },
      select: { shopifyGid: true },
    });
    for (const c of customers) {
      await earnBirthday(cfg.shop, c.shopifyGid, now.getFullYear());
      birthdayGrants++;
    }
  }

  return { expiredMembers, birthdayGrants };
}
