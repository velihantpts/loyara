// Monthly summary cron. For every Pro shop it (1) reconciles the isPro mirror
// against live billing (so a churned shop stops receiving paid artifacts even if
// the cancel webhook was dropped), and (2) emails a program summary: points
// issued, redeemed and the outstanding liability.

import prisma from "../../db.server";
import { unauthenticated } from "../../shopify.server";
import { sendEmail } from "./email.server";
import { programStats } from "../../loyalty/stats.server";
import { BRAND } from "../../config";

export interface MonthlyReportResult {
  shops: number;
  emailed: number;
  reconciled: number;
}

function summaryHtml(shop: string, s: Awaited<ReturnType<typeof programStats>>): string {
  const nf = new Intl.NumberFormat("en-US");
  const row = (label: string, value: number) =>
    `<tr><td style="padding:6px;border-bottom:1px solid #eee">${label}</td><td style="padding:6px;border-bottom:1px solid #eee;text-align:right"><b>${nf.format(value)}</b></td></tr>`;
  return `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
    <h2 style="margin-bottom:4px">${BRAND}: your loyalty program this month</h2>
    <p style="color:#555;margin-top:0">Store: <b>${shop}</b></p>
    <table style="width:100%;border-collapse:collapse;margin-top:12px">
      ${row("Members", s.members)}
      ${row("Active members (holding points)", s.activeMembers)}
      ${row("Members who redeemed", s.redeemingMembers)}
      ${row("Points issued (lifetime)", s.pointsIssued)}
      ${row("Points redeemed (lifetime)", s.pointsRedeemed)}
      ${row("Redemption rate (%)", Math.round(s.redemptionRate * 100))}
      ${row("Outstanding points (liability)", s.outstanding)}
    </table>
    <p style="font-size:12px;color:#777;margin-top:16px">Redemption rate is points redeemed vs issued; the higher it is, the more your program is bringing customers back. Outstanding points are your current liability. ${BRAND}</p>
  </div>`;
}

export async function runMonthlyReport(): Promise<MonthlyReportResult> {
  const shops = await prisma.shopConfig.findMany({ where: { isPro: true } });
  let emailed = 0;
  let reconciled = 0;

  for (const s of shops) {
    try {
      const { admin } = await unauthenticated.admin(s.shop);

      // Reconcile against live billing before delivering any paid artifact.
      const subResp = await admin.graphql(`#graphql
        query { currentAppInstallation { activeSubscriptions { status } } }`);
      const subJson = (await subResp.json()) as {
        data?: {
          currentAppInstallation?: {
            activeSubscriptions?: { status?: string }[];
          };
        };
      };
      const active =
        subJson?.data?.currentAppInstallation?.activeSubscriptions?.some(
          (x) => x.status === "ACTIVE",
        ) ?? false;
      if (!active) {
        await prisma.shopConfig.update({
          where: { shop: s.shop },
          data: { isPro: false },
        });
        reconciled++;
        continue;
      }

      if (s.email) {
        const stats = await programStats(s.shop);
        const ok = await sendEmail({
          to: s.email,
          subject: `${BRAND}: your loyalty program summary`,
          html: summaryHtml(s.shop, stats),
        });
        if (ok) emailed++;
      }
    } catch (e) {
      console.warn("[cron] shop failed:", s.shop, e);
    }
  }

  return { shops: shops.length, emailed, reconciled };
}
