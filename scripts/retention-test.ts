// Headless correctness suite for retentionCohorts (dashboard "Bring them back"
// cohorts). Runs the REAL function against a real SQLite DB, esbuild + node —
// same style as engine-test.ts. Locks the two windows that are easy to get
// off-by-one: near-reward (25% below the cheapest tier) and expiring-soon (last
// EARN inside the warn window, before the expiry cutoff).

import prisma from "../app/db.server";
import { retentionCohorts } from "../app/loyalty/stats.server";

const DAY = 24 * 60 * 60 * 1000;
let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${detail ? "— " + detail : ""}`);
  }
}

async function customer(shop: string, gid: string, balance: number) {
  return prisma.customer.create({
    data: { shop, shopifyGid: gid, balance, lifetimeEarned: Math.max(balance, 0) },
  });
}
async function earn(shop: string, customerId: string, delta: number, daysAgo: number) {
  return prisma.pointsLedger.create({
    data: {
      shop,
      customerId,
      delta,
      reason: "EARN",
      sourceType: "order",
      sourceId: `o-${customerId}-${daysAgo}`,
      createdAt: new Date(Date.now() - daysAgo * DAY),
    },
  });
}

async function main() {
  // ── near-reward: cheapest tier costs 500; expiry disabled (0) ───────────────
  const nShop = "near.test";
  await customer(nShop, "gid://shopify/Customer/A", 400); // 375 <= 400 < 500 → near
  await customer(nShop, "gid://shopify/Customer/B", 300); // < 375 → not near
  await customer(nShop, "gid://shopify/Customer/C", 500); // can afford → not near
  await customer(nShop, "gid://shopify/Customer/D", 0); // empty → not near
  const near = await retentionCohorts(nShop, 0, 500);
  check("near-reward counts only balances in [375, 500)", near.nearReward === 1, `got ${near.nearReward}`);
  check("expiry disabled → no expiring", near.expiringSoon === 0);

  // near-reward off when no reward tier configured
  const nearNull = await retentionCohorts(nShop, 0, null);
  check("no cheapest tier → nearReward 0", nearNull.nearReward === 0);

  // ── expiring-soon: expiry 30d, warn window = last earn in [now-30d, now-23d) ─
  const eShop = "expire.test";
  const e = await customer(eShop, "gid://shopify/Customer/E", 200);
  const f = await customer(eShop, "gid://shopify/Customer/F", 150);
  const g = await customer(eShop, "gid://shopify/Customer/G", 100);
  const h = await customer(eShop, "gid://shopify/Customer/H", 100);
  const i = await customer(eShop, "gid://shopify/Customer/I", 0);
  await earn(eShop, e.id, 200, 25); // 23 <= 25 < 30 → expiring soon
  await earn(eShop, f.id, 150, 25); // expiring soon
  await earn(eShop, g.id, 100, 10); // recent → not expiring
  await earn(eShop, h.id, 100, 35); // past cutoff (already expired) → not counted
  await earn(eShop, i.id, 200, 25); // in window but balance 0 → not counted
  const exp = await retentionCohorts(eShop, 30, null);
  check("expiring-soon counts last-earn in warn window with balance>0", exp.expiringSoon === 2, `got ${exp.expiringSoon}`);
  check("expiring points sums those balances", exp.expiringPoints === 350, `got ${exp.expiringPoints}`);
  check("recent/expired/zero-balance excluded", exp.expiringSoon === 2);

  // expiry <= warn days → feature off (no window)
  const expOff = await retentionCohorts(eShop, 5, null);
  check("expiry <= 7d → expiring disabled", expOff.expiringSoon === 0 && expOff.expiringPoints === 0);

  console.log(`\n${fail ? `✗ ${fail} failed` : `✓ all ${pass} passed`}`);
  if (fail) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
