// Headless correctness suite for the loyalty ledger engine. Runs the REAL engine
// functions against a real SQLite DB. Bundled with esbuild + run with node.
// Targets the "5 riskiest things": double-accrual, refund/cancel clawback,
// double-spend, redeem compensation, VIP integrity.

import prisma from "../app/db.server";
import { ensureConfig } from "../app/loyalty/shop.server";
import { earnFromOrder, earnSignup } from "../app/loyalty/earn.server";
import { clawbackRefund, clawbackCancel } from "../app/loyalty/clawback.server";
import { redeem } from "../app/loyalty/redeem.server";
import { attributeReferral } from "../app/loyalty/referral.server";
import { runDaily } from "../app/loyalty/daily.server";

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

async function balanceOf(shop: string, gid: string): Promise<number> {
  const c = await prisma.customer.findUnique({
    where: { shop_shopifyGid: { shop, shopifyGid: gid } },
    select: { balance: true },
  });
  return c?.balance ?? 0;
}
async function lifetimeOf(shop: string, gid: string): Promise<number> {
  const c = await prisma.customer.findUnique({
    where: { shop_shopifyGid: { shop, shopifyGid: gid } },
    select: { lifetimeEarned: true },
  });
  return c?.lifetimeEarned ?? 0;
}

const CUST = "gid://shopify/Customer/1";
const order = (id: number, subtotal: string, opts: { test?: boolean; noCustomer?: boolean } = {}) => ({
  admin_graphql_api_id: `gid://shopify/Order/${id}`,
  id,
  test: opts.test ?? false,
  current_subtotal_price: subtotal,
  customer: opts.noCustomer
    ? null
    : { admin_graphql_api_id: CUST, id: 1, email: "a@b.com" },
});
const refund = (rid: number, orderId: number, eligible: number) => ({
  admin_graphql_api_id: `gid://shopify/Refund/${rid}`,
  id: rid,
  order_id: orderId,
  refund_line_items: [{ subtotal: eligible }],
});

const okAdmin = {
  graphql: async () => ({
    json: async () => ({
      data: {
        discountCodeBasicCreate: {
          codeDiscountNode: { id: "gid://shopify/DiscountCodeNode/1" },
          userErrors: [],
        },
      },
    }),
  }),
};
const failAdmin = {
  graphql: async () => ({
    json: async () => ({
      data: {
        discountCodeBasicCreate: {
          codeDiscountNode: null,
          userErrors: [{ message: "boom" }],
        },
      },
    }),
  }),
};

async function main() {
  // Reset: the suite uses fixed shop/order IDs, so wipe prior runs' data (the
  // engine is idempotent, so a dirty DB would make fixed-ID re-earns no-op).
  await prisma.pointsLedger.deleteMany({});
  await prisma.redemption.deleteMany({});
  await prisma.referral.deleteMany({});
  await prisma.customer.deleteMany({});
  await prisma.shopConfig.deleteMany({});

  // 1. Idempotent accrual
  {
    const shop = "t1.myshopify.com";
    await ensureConfig(shop);
    await earnFromOrder(shop, order(1001, "100.00"), "evt-1");
    await earnFromOrder(shop, order(1001, "100.00"), "evt-1-retry"); // duplicate
    check("accrual idempotent (100 pts once)", (await balanceOf(shop, CUST)) === 100, `got ${await balanceOf(shop, CUST)}`);
  }

  // 2. Signup idempotent
  {
    const shop = "t2.myshopify.com";
    await ensureConfig(shop);
    await prisma.shopConfig.update({ where: { shop }, data: { signupBonus: 50 } });
    await earnSignup(shop, CUST, "a@b.com");
    await earnSignup(shop, CUST, "a@b.com");
    check("signup bonus once (50)", (await balanceOf(shop, CUST)) === 50, `got ${await balanceOf(shop, CUST)}`);
  }

  // 3. Proportional partial refunds, capped
  {
    const shop = "t3.myshopify.com";
    await ensureConfig(shop);
    await earnFromOrder(shop, order(1, "100.00"), "e");
    await clawbackRefund(shop, refund(10, 1, 40)); // -40
    check("partial refund 40 → balance 60", (await balanceOf(shop, CUST)) === 60, `got ${await balanceOf(shop, CUST)}`);
    await clawbackRefund(shop, refund(11, 1, 60)); // -60
    check("second refund 60 → balance 0", (await balanceOf(shop, CUST)) === 0, `got ${await balanceOf(shop, CUST)}`);
    await clawbackRefund(shop, refund(12, 1, 50)); // over-cap, should be no-op
    check("over-cap refund capped (still 0)", (await balanceOf(shop, CUST)) === 0, `got ${await balanceOf(shop, CUST)}`);
    // idempotent refund
    await clawbackRefund(shop, refund(10, 1, 40)); // duplicate refund id
    check("duplicate refund id idempotent", (await balanceOf(shop, CUST)) === 0, `got ${await balanceOf(shop, CUST)}`);
  }

  // 4. Cancel after partial refund → clawback remaining only, never below earned
  {
    const shop = "t4.myshopify.com";
    await ensureConfig(shop);
    await earnFromOrder(shop, order(2, "100.00"), "e");
    await clawbackRefund(shop, refund(20, 2, 30)); // -30 → 70
    await clawbackCancel(shop, { admin_graphql_api_id: "gid://shopify/Order/2", id: 2 }); // -70 → 0
    check("cancel after refund → balance 0 (not -100)", (await balanceOf(shop, CUST)) === 0, `got ${await balanceOf(shop, CUST)}`);
    await clawbackCancel(shop, { admin_graphql_api_id: "gid://shopify/Order/2", id: 2 }); // idempotent
    check("cancel idempotent", (await balanceOf(shop, CUST)) === 0, `got ${await balanceOf(shop, CUST)}`);
  }

  // 5. Redeem race / double-spend
  {
    const shop = "t5.myshopify.com";
    await ensureConfig(shop);
    await prisma.shopConfig.update({ where: { shop }, data: { redeemTiers: JSON.stringify([{ points: 100, value: 10, type: "fixed" }]) } });
    await earnFromOrder(shop, order(3, "100.00"), "e"); // 100 pts
    const [r1, r2] = await Promise.all([
      redeem({ shop, admin: okAdmin as any, customerGid: CUST, tierIndex: 0, idempotencyKey: "k1" }),
      redeem({ shop, admin: okAdmin as any, customerGid: CUST, tierIndex: 0, idempotencyKey: "k2" }),
    ]);
    const successes = [r1, r2].filter((r) => r.ok).length;
    check("double-spend: exactly one redeem succeeds", successes === 1, `got ${successes} successes`);
    check("double-spend: balance never negative (==0)", (await balanceOf(shop, CUST)) === 0, `got ${await balanceOf(shop, CUST)}`);
  }

  // 6. Redeem idempotent on key
  {
    const shop = "t6.myshopify.com";
    await ensureConfig(shop);
    await prisma.shopConfig.update({ where: { shop }, data: { redeemTiers: JSON.stringify([{ points: 100, value: 10, type: "fixed" }]) } });
    await earnFromOrder(shop, order(4, "200.00"), "e"); // 200 pts
    const a = await redeem({ shop, admin: okAdmin as any, customerGid: CUST, tierIndex: 0, idempotencyKey: "same" });
    const b = await redeem({ shop, admin: okAdmin as any, customerGid: CUST, tierIndex: 0, idempotencyKey: "same" });
    check("redeem idempotent: same code returned", a.ok && b.ok && (a as any).code === (b as any).code);
    check("redeem idempotent: charged once (balance 100)", (await balanceOf(shop, CUST)) === 100, `got ${await balanceOf(shop, CUST)}`);
  }

  // 7. Redeem mint failure → compensation
  {
    const shop = "t7.myshopify.com";
    await ensureConfig(shop);
    await prisma.shopConfig.update({ where: { shop }, data: { redeemTiers: JSON.stringify([{ points: 100, value: 10, type: "fixed" }]) } });
    await earnFromOrder(shop, order(5, "100.00"), "e"); // 100
    const r = await redeem({ shop, admin: failAdmin as any, customerGid: CUST, tierIndex: 0, idempotencyKey: "mf" });
    check("mint failure returns !ok", !r.ok);
    check("mint failure compensated (balance restored to 100)", (await balanceOf(shop, CUST)) === 100, `got ${await balanceOf(shop, CUST)}`);
  }

  // 8. VIP multiplier + lifetime integrity on clawback
  {
    const shop = "t8.myshopify.com";
    await ensureConfig(shop);
    await prisma.shopConfig.update({
      where: { shop },
      data: { vipTiers: JSON.stringify([{ name: "Gold", threshold: 100, multiplier: 2 }]) },
    });
    await earnFromOrder(shop, order(6, "100.00"), "e"); // 100 pts, lifetime 100 → reaches Gold
    check("VIP reached at threshold", (await lifetimeOf(shop, CUST)) === 100);
    await earnFromOrder(shop, order(7, "100.00"), "e2"); // now Gold: 100*2 = 200
    check("VIP multiplier applies (2nd order = 200)", (await balanceOf(shop, CUST)) === 300, `got ${await balanceOf(shop, CUST)}`);
    // Refund the second order fully → clawback 200, lifetime should drop
    await clawbackRefund(shop, refund(70, 7, 100));
    check("clawback reduces lifetime (no VIP gaming)", (await lifetimeOf(shop, CUST)) === 100, `got ${await lifetimeOf(shop, CUST)}`);
  }

  // 9. Guard rails: test order + guest order → no accrual
  {
    const shop = "t9.myshopify.com";
    await ensureConfig(shop);
    await earnFromOrder(shop, order(8, "100.00", { test: true }), "e");
    check("test order → no accrual", (await balanceOf(shop, CUST)) === 0);
    await earnFromOrder(shop, order(9, "100.00", { noCustomer: true }), "e");
    check("guest order → no accrual", (await prisma.customer.count({ where: { shop } })) === 0);
  }

  // 10. Referral attribution
  {
    const shop = "t10.myshopify.com";
    await ensureConfig(shop);
    await prisma.shopConfig.update({ where: { shop }, data: { referralReward: 25 } });
    const REFERRER = "gid://shopify/Customer/2";
    await prisma.referral.create({ data: { shop, code: "REF-T10", referrerGid: REFERRER } });
    await attributeReferral(shop, {
      customer: { admin_graphql_api_id: CUST, email: "a@b.com" },
      discount_codes: [{ code: "REF-T10" }],
    });
    check("referral: referee earns 25", (await balanceOf(shop, CUST)) === 25, `got ${await balanceOf(shop, CUST)}`);
    check("referral: referrer earns 25", (await balanceOf(shop, REFERRER)) === 25, `got ${await balanceOf(shop, REFERRER)}`);
    await attributeReferral(shop, { customer: { admin_graphql_api_id: CUST }, discount_codes: [{ code: "REF-T10" }] });
    check("referral idempotent (referee still 25)", (await balanceOf(shop, CUST)) === 25, `got ${await balanceOf(shop, CUST)}`);
    await attributeReferral(shop, { customer: { admin_graphql_api_id: REFERRER }, discount_codes: [{ code: "REF-T10" }] });
    check("no self-referral", (await balanceOf(shop, REFERRER)) === 25, `got ${await balanceOf(shop, REFERRER)}`);
  }

  // 11. Expiry — inactive balance expires
  {
    const shop = "t11.myshopify.com";
    await ensureConfig(shop);
    await prisma.shopConfig.update({ where: { shop }, data: { pointsExpiryDays: 30 } });
    await earnFromOrder(shop, order(30, "100.00"), "e");
    await runDaily(new Date(Date.now() + 40 * 24 * 60 * 60 * 1000)); // 40 days later
    check("expiry: inactive balance → 0", (await balanceOf(shop, CUST)) === 0, `got ${await balanceOf(shop, CUST)}`);
  }

  // 12. Expiry — recent balance survives
  {
    const shop = "t12.myshopify.com";
    await ensureConfig(shop);
    await prisma.shopConfig.update({ where: { shop }, data: { pointsExpiryDays: 30 } });
    await earnFromOrder(shop, order(31, "50.00"), "e");
    await runDaily(new Date()); // today → within window
    check("expiry: recent balance survives (50)", (await balanceOf(shop, CUST)) === 50, `got ${await balanceOf(shop, CUST)}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
