// Regression test for the dev/App-Review-store billing resolution (review 1.2.2).
// Bundled with esbuild + run with node, like engine-test.ts (no test framework).
//
// Why: a reviewer's Pro subscription on a dev store is a TEST charge. The app must
// resolve isTest from shop.plan.partnerDevelopment and thread it into billing.check
// so the charge is seen. This asserts that logic directly so it can't regress.
//
// Env is forced to a production-like shape BEFORE importing shopify.server so the
// module-level `billingIsTest` is false (otherwise it short-circuits to true and
// we'd never exercise the partnerDevelopment path). Dummy Shopify creds satisfy
// the module's prod env guard; no network is used (admin/billing are mocked).
process.env.NODE_ENV = "production";
delete process.env.BILLING_TEST;
process.env.SHOPIFY_API_KEY ||= "test_key";
process.env.SHOPIFY_API_SECRET ||= "test_secret";
process.env.SHOPIFY_APP_URL ||= "https://example.com";
process.env.DATABASE_URL ||= "file:./scripts/.billingtest.db";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail ? "— " + detail : ""}`); }
}

// A mock admin GraphQL client returning a given partnerDevelopment value.
const mkAdmin = (partnerDevelopment: boolean) => ({
  graphql: async () => ({ json: async () => ({ data: { shop: { plan: { partnerDevelopment } } } }) }),
});
const throwAdmin = { graphql: async () => { throw new Error("graphql should not be called (cached or n/a)"); } };

async function main() {
  const { resolveBillingIsTest, hasProPlan } = await import("../app/shopify.server");

  // 1. Dev / App-Review store (partnerDevelopment: true) -> isTest true.
  check("dev store -> isTest true", (await resolveBillingIsTest(mkAdmin(true), "dev1.myshopify.com")) === true);

  // 2. Real merchant store (partnerDevelopment: false) -> isTest false.
  check("real store -> isTest false", (await resolveBillingIsTest(mkAdmin(false), "real1.myshopify.com")) === false);

  // 3. Cached per shop: a second call for the same shop must not hit GraphQL again.
  check("dev result cached (no 2nd graphql)", (await resolveBillingIsTest(throwAdmin, "dev1.myshopify.com")) === true);

  // 4. On a GraphQL error, default to REAL billing (never hand out free Pro).
  check("graphql error -> isTest false (safe default)", (await resolveBillingIsTest(throwAdmin, "err1.myshopify.com")) === false);

  // 5. hasProPlan threads isTest straight into billing.check (request/check parity).
  let seen: boolean | undefined;
  const billing = { check: async ({ isTest }: { isTest: boolean }) => { seen = isTest; return { hasActivePayment: true }; } } as any;
  const proTest = await hasProPlan(billing, true);
  check("hasProPlan(isTest=true) forwards isTest true", proTest === true && seen === true, `seen=${seen}`);
  await hasProPlan(billing, false);
  check("hasProPlan(isTest=false) forwards isTest false", seen === false, `seen=${seen}`);

  // 6. A billing API error degrades to false, never throws (can't 500 a page).
  const boomBilling = { check: async () => { throw new Error("billing down"); } } as any;
  check("hasProPlan swallows billing error -> false", (await hasProPlan(boomBilling, true)) === false);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
