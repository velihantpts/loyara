// Correctness suite for Judge.me review points: idempotent per review id, capped
// per customer, off when disabled. Real ledger, esbuild + node (engine-test style).

import prisma from "../app/db.server";
import { earnReview, REVIEW_EARN_CAP } from "../app/loyalty/earn.server";

const shop = "review.test";
const gid = "gid://shopify/Customer/999";
const REWARD = 50;

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
async function balance(): Promise<number> {
  const c = await prisma.customer.findUnique({
    where: { shop_shopifyGid: { shop, shopifyGid: gid } },
    select: { balance: true },
  });
  return c?.balance ?? 0;
}

async function main() {
  await prisma.shopConfig.create({
    data: { shop, programActive: true, reviewBonus: REWARD },
  });

  const o1 = await earnReview(shop, gid, "a@b.com", "r1");
  check("first published review awards", o1 === "awarded", o1);
  check("balance +reward", (await balance()) === REWARD);

  const dup = await earnReview(shop, gid, "a@b.com", "r1"); // same review id
  check("same review id never double-awards", dup === "duplicate", dup);
  check("balance unchanged after duplicate", (await balance()) === REWARD);

  // Fill up to the cap (already 1 award). Reviews r2..r{CAP} award.
  for (let i = 2; i <= REVIEW_EARN_CAP; i++) {
    const o = await earnReview(shop, gid, "a@b.com", `r${i}`);
    check(`review r${i} awards (under cap)`, o === "awarded", o);
  }
  const over = await earnReview(shop, gid, "a@b.com", "rOver");
  check("beyond per-customer cap → capped", over === "capped", over);
  check(
    "balance capped at CAP*reward",
    (await balance()) === REVIEW_EARN_CAP * REWARD,
    String(await balance()),
  );

  await prisma.shopConfig.update({ where: { shop }, data: { reviewBonus: 0 } });
  const off = await earnReview(shop, gid, "a@b.com", "rOff");
  check("reviewBonus 0 → off (no award)", off === "off", off);

  await prisma.shopConfig.update({
    where: { shop },
    data: { reviewBonus: REWARD, programActive: false },
  });
  const paused = await earnReview(shop, gid, "a@b.com", "rPaused");
  check("paused program → off", paused === "off", paused);

  console.log(`\n${fail ? `✗ ${fail} failed` : `✓ all ${pass} passed`}`);
  if (fail) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
