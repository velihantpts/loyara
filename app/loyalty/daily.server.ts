// Daily maintenance: inactivity-based points expiry + birthday bonuses.
// Driven by an external scheduler hitting /cron/daily?key=$CRON_SECRET.
//
// Retention nudges (expiring-soon, near-reward) are delivered ONLY as Klaviyo
// events, never as app-sent customer emails. Klaviyo owns the marketing-consent
// state and the unsubscribe/List-Unsubscribe machinery; sending our own nudge
// emails would be marketing mail with no consent check and no unsubscribe — a
// deliverability + compliance liability. Native nudges can return once we sync
// Shopify emailMarketingConsent and ship a real unsubscribe flow.

import prisma from "../db.server";
import { applyEntry } from "./points.server";
import { earnBirthday } from "./earn.server";
import { klaviyoEvent } from "./klaviyo.server";

const DAY_MS = 24 * 60 * 60 * 1000;
// Warn members this many days before their points expire. Only applies when the
// expiry window is longer than the warning lead time.
const EXPIRY_WARN_DAYS = 7;
const pad = (n: number) => String(n).padStart(2, "0");

export interface DailyResult {
  expiredMembers: number;
  birthdayGrants: number;
  expiringSoonWarned: number; // expiry warnings emitted as Klaviyo events
}

export async function runDaily(now: Date): Promise<DailyResult> {
  let expiredMembers = 0;
  let birthdayGrants = 0;
  let expiringSoonWarned = 0;

  // ── Expiry: points expire after N days of no EARN activity. Expire the whole
  //    balance in one EXPIRE entry (reason EXPIRE doesn't touch lifetime/VIP).
  //    Members inside the warning window get a one-time "expiring soon" Klaviyo
  //    event (once per earn cycle — a new EARN resets the warning). ──
  // Expiry itself runs for every qualifying shop; the expiring-soon WARNING is
  // gated on Klaviyo per-member below (that's the only compliant nudge channel).
  const expiryShops = await prisma.shopConfig.findMany({
    where: { pointsExpiryDays: { gt: 0 }, programActive: true, isPro: true },
    select: { shop: true, pointsExpiryDays: true, klaviyoApiKey: true },
  });
  const dayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  for (const cfg of expiryShops) {
    const cutoff = new Date(now.getTime() - cfg.pointsExpiryDays * DAY_MS);
    // Warn window opens EXPIRY_WARN_DAYS before the cutoff (skip if the whole
    // window is shorter than the lead time — nothing sensible to warn about).
    const warnCutoff =
      cfg.pointsExpiryDays > EXPIRY_WARN_DAYS
        ? new Date(now.getTime() - (cfg.pointsExpiryDays - EXPIRY_WARN_DAYS) * DAY_MS)
        : null;
    const customers = await prisma.customer.findMany({
      where: { shop: cfg.shop, balance: { gt: 0 } },
      select: {
        id: true,
        shopifyGid: true,
        email: true,
        balance: true,
        expiryWarnedFor: true,
      },
    });
    for (const c of customers) {
      const lastEarn = await prisma.pointsLedger.findFirst({
        where: { shop: cfg.shop, customerId: c.id, reason: { startsWith: "EARN" } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      if (!lastEarn) continue;
      if (lastEarn.createdAt < cutoff) {
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
        continue;
      }
      // Expiring soon: inside the warning window, has an email, and not already
      // warned for THIS earn cycle (keyed on the last-earn timestamp).
      const earnKey = lastEarn.createdAt.toISOString();
      if (
        warnCutoff &&
        lastEarn.createdAt < warnCutoff &&
        cfg.klaviyoApiKey &&
        c.email &&
        c.expiryWarnedFor !== earnKey
      ) {
        const daysLeft = Math.max(
          0,
          Math.ceil((lastEarn.createdAt.getTime() - cutoff.getTime()) / DAY_MS),
        );
        klaviyoEvent(
          cfg.klaviyoApiKey,
          "Loyalty Points Expiring Soon",
          c.email,
          { balance: c.balance, days_left: daysLeft },
          { loyalty_points: c.balance },
        );
        await prisma.customer.update({
          where: { id: c.id },
          data: { expiryWarnedFor: earnKey },
        });
        expiringSoonWarned++;
      }
    }
  }

  // ── Birthday grants: members whose birthday MM-DD is today. ──
  const mmdd = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const bdayShops = await prisma.shopConfig.findMany({
    where: { birthdayBonus: { gt: 0 }, programActive: true, isPro: true },
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

  return { expiredMembers, birthdayGrants, expiringSoonWarned };
}
