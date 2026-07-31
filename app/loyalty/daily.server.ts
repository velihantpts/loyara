// Daily maintenance: inactivity-based points expiry + birthday bonuses.
// Driven by an external scheduler hitting /cron/daily?key=$CRON_SECRET.

import prisma from "../db.server";
import { applyEntry } from "./points.server";
import { earnBirthday } from "./earn.server";
import { klaviyoEvent } from "./klaviyo.server";
import { parseRedeemTiers, type RedeemTier } from "./config";
import { sendEmail } from "../lib/core/email.server";
import { BRAND } from "../config";

const DAY_MS = 24 * 60 * 60 * 1000;
// Warn members this many days before their points expire. Only applies when the
// expiry window is longer than the warning lead time.
const EXPIRY_WARN_DAYS = 7;
// "You're close to a reward" fires once a member reaches this fraction of the
// cheapest reward they can't yet afford.
const NEAR_REWARD_FRACTION = 0.8;
const pad = (n: number) => String(n).padStart(2, "0");

export interface DailyResult {
  expiredMembers: number;
  birthdayGrants: number;
  expiringSoonWarned: number; // expiry warnings via Klaviyo OR native email
  nearRewardNudged: number; // native "close to a reward" emails
}

export async function runDaily(now: Date): Promise<DailyResult> {
  let expiredMembers = 0;
  let birthdayGrants = 0;
  let expiringSoonWarned = 0;
  let nearRewardNudged = 0;
  // Cap: at most one native nudge email per member per run (a member eligible for
  // both an expiry warning and a near-reward nudge gets only the expiry one).
  const nudgedThisRun = new Set<string>();

  // ── Expiry: points expire after N days of no EARN activity. Expire the whole
  //    balance in one EXPIRE entry (reason EXPIRE doesn't touch lifetime/VIP).
  //    Members inside the warning window get a one-time "expiring soon" Klaviyo
  //    event (once per earn cycle — a new EARN resets the warning). ──
  const expiryShops = await prisma.shopConfig.findMany({
    where: { pointsExpiryDays: { gt: 0 }, programActive: true, isPro: true },
    select: {
      shop: true,
      pointsExpiryDays: true,
      klaviyoApiKey: true,
      nudgeEmails: true,
    },
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
      // warned for THIS earn cycle (keyed on the last-earn timestamp). Klaviyo
      // shops get an event; non-Klaviyo shops with nudges on get a native email.
      const earnKey = lastEarn.createdAt.toISOString();
      if (
        warnCutoff &&
        lastEarn.createdAt < warnCutoff &&
        c.email &&
        c.expiryWarnedFor !== earnKey
      ) {
        const daysLeft = Math.max(
          0,
          Math.ceil((lastEarn.createdAt.getTime() - cutoff.getTime()) / DAY_MS),
        );
        let sent = false;
        if (cfg.klaviyoApiKey) {
          klaviyoEvent(
            cfg.klaviyoApiKey,
            "Loyalty Points Expiring Soon",
            c.email,
            { balance: c.balance, days_left: daysLeft },
            { loyalty_points: c.balance },
          );
          sent = true;
        } else if (cfg.nudgeEmails) {
          sent = await sendEmail({
            to: c.email,
            subject: `Your ${BRAND} points are expiring soon`,
            html: expiryEmailHtml(cfg.shop, c.balance, daysLeft),
          });
          if (sent) nudgedThisRun.add(c.id);
        }
        if (sent) {
          await prisma.customer.update({
            where: { id: c.id },
            data: { expiryWarnedFor: earnKey },
          });
          expiringSoonWarned++;
        }
      }
    }
  }

  // ── Near-reward nudge: native retention email for non-Klaviyo shops. For each
  //    active member within NEAR_REWARD_FRACTION of the cheapest reward they
  //    can't yet afford, send once per target tier (nudgedRewardFor guards it). ──
  const nudgeShops = await prisma.shopConfig.findMany({
    where: {
      nudgeEmails: true,
      isPro: true,
      programActive: true,
      klaviyoApiKey: null,
    },
    select: { shop: true, redeemTiers: true, currency: true, redemptionMode: true },
  });
  for (const cfg of nudgeShops) {
    const tiers = parseRedeemTiers(cfg.redeemTiers); // sorted ascending by points
    if (tiers.length === 0) continue;
    const members = await prisma.customer.findMany({
      where: { shop: cfg.shop, balance: { gt: 0 }, email: { not: null } },
      select: { id: true, balance: true, email: true, nudgedRewardFor: true },
    });
    for (const m of members) {
      if (nudgedThisRun.has(m.id)) continue; // one nudge per member per run
      // Cheapest reward they can't quite afford yet.
      const target = tiers.find((t) => t.points > m.balance);
      if (!target) continue; // can already afford everything
      if (m.balance < NEAR_REWARD_FRACTION * target.points) continue; // not close yet
      if (m.nudgedRewardFor === target.points) continue; // already nudged for this tier
      const ok = await sendEmail({
        to: m.email as string,
        subject: `You're almost there — ${target.points - m.balance} points to go`,
        html: nearRewardEmailHtml(
          cfg.shop,
          m.balance,
          target,
          cfg.currency ?? "USD",
          cfg.redemptionMode,
        ),
      });
      if (ok) {
        await prisma.customer.update({
          where: { id: m.id },
          data: { nudgedRewardFor: target.points },
        });
        nudgedThisRun.add(m.id);
        nearRewardNudged++;
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

  return { expiredMembers, birthdayGrants, expiringSoonWarned, nearRewardNudged };
}

// ── Native nudge email templates (used only for non-Klaviyo shops with nudges on).

function money(v: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(v);
  } catch {
    return `${v} ${currency}`;
  }
}

function rewardLabel(t: RedeemTier, currency: string, mode: string): string {
  const amount = money(t.value, currency);
  if (mode === "store_credit" && t.type !== "percent") return `${amount} store credit`;
  return t.type === "percent" ? `${t.value}% off` : `${amount} off`;
}

function shell(inner: string): string {
  return `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a">${inner}<p style="font-size:12px;color:#999;margin-top:20px">— ${BRAND}</p></div>`;
}

function accountBtn(shop: string, label: string): string {
  return `<p><a href="https://${shop}/account" style="display:inline-block;padding:10px 18px;background:#1a1a1a;color:#fff;border-radius:8px;text-decoration:none">${label}</a></p>`;
}

function expiryEmailHtml(shop: string, balance: number, daysLeft: number): string {
  const nf = new Intl.NumberFormat();
  const when = daysLeft <= 1 ? "in the next day" : `in about ${daysLeft} days`;
  return shell(
    `<h2>Your points are expiring soon ⏳</h2>
     <p>You have <b>${nf.format(balance)}</b> points that will expire ${when} if unused. Place an order or redeem a reward to keep them.</p>
     ${accountBtn(shop, "Redeem your points")}`,
  );
}

function nearRewardEmailHtml(
  shop: string,
  balance: number,
  target: RedeemTier,
  currency: string,
  mode: string,
): string {
  const nf = new Intl.NumberFormat();
  const remaining = target.points - balance;
  return shell(
    `<h2>You're almost to your next reward 🎉</h2>
     <p>You have <b>${nf.format(balance)}</b> points — just <b>${nf.format(remaining)}</b> more unlocks <b>${rewardLabel(target, currency, mode)}</b> (${nf.format(target.points)} points).</p>
     ${accountBtn(shop, "See your rewards")}`,
  );
}
