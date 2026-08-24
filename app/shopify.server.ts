import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { PRICING } from "./pricing";

// Pro billing. Free tier = points earn/redeem + storefront widget (feature-gated,
// no order-count limit enforced). Pro (monthly or annual) = every feature (VIP tiers,
// referrals, CSV migration, branding removal, expiry/birthday, Klaviyo), billed at a
// flat price regardless of order volume — the anti-gating flat-price wedge.
// The plan NAMES must equal the App Store "Internal plan handle", which the
// pricing form forces to a lowercase slug — so these are lowercase to match the
// created public plans exactly (case-sensitive billing match). IRREVERSIBLE once
// the public plans are created.
export const PRO_MONTHLY = "pro";
export const PRO_ANNUAL = "pro-annual";
export const PRO_PLANS: (typeof PRO_MONTHLY | typeof PRO_ANNUAL)[] = [
  PRO_MONTHLY,
  PRO_ANNUAL,
];

// Test billing only when explicitly opted in, or in local development. Do NOT
// key this off `NODE_ENV !== "production"` alone — a prod deploy that loses
// NODE_ENV would then create TEST charges (merchants get Pro, zero revenue).
// Misconfigured/unset env now defaults to REAL billing.
export const billingIsTest =
  process.env.BILLING_TEST === "1" || process.env.NODE_ENV === "development";

// Fail fast on a misconfigured production deploy instead of booting an app that
// serves broken embedding and verifies OAuth/webhook HMAC against an empty
// secret. In dev the Shopify CLI injects these, so only guard production.
if (process.env.NODE_ENV === "production") {
  const missing = [
    "SHOPIFY_API_KEY",
    "SHOPIFY_API_SECRET",
    "SHOPIFY_APP_URL",
    "DATABASE_URL",
  ].filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}`,
    );
  }
}

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing: {
    [PRO_MONTHLY]: {
      trialDays: PRICING.trialDays,
      lineItems: [
        {
          amount: PRICING.monthly,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
    [PRO_ANNUAL]: {
      trialDays: PRICING.trialDays,
      lineItems: [
        {
          amount: PRICING.annual,
          currencyCode: "USD",
          interval: BillingInterval.Annual,
        },
      ],
    },
  },
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;

// Single source of truth for "does this shop have an active Pro subscription".
// Swallows transient Billing API errors → false so a billing hiccup can never
// 500 a page; every route that gates on Pro must use this, not an inline check.
type Billing = Awaited<ReturnType<typeof shopify.authenticate.admin>>["billing"];

// Check for an active Pro payment across BOTH billing environments. A subscription
// is either a TEST charge (dev / App-Review stores) or a REAL charge (live stores),
// never both — so if the primary (store-type-resolved) isTest finds nothing, we
// re-check the other environment. This can only DETECT a sub we'd otherwise miss
// when the store type was misclassified; it can NEVER invent a false Pro (a real
// store has no test charge, a dev store has no real charge). Review 1.2.2 requires
// exactly this: a reviewer's approved TEST plan must be seen even if partnerDevelopment
// didn't flag their store. Returns the check that found the payment, else the primary.
async function checkProAnyEnv(billing: Billing, isTest: boolean) {
  const primary = await billing.check({ plans: PRO_PLANS, isTest });
  if (primary.hasActivePayment) return primary;
  const other = await billing.check({ plans: PRO_PLANS, isTest: !isTest });
  return other.hasActivePayment ? other : primary;
}

export async function hasProPlan(
  billing: Billing,
  isTest: boolean = billingIsTest,
): Promise<boolean> {
  try {
    return (await checkProAnyEnv(billing, isTest)).hasActivePayment;
  } catch {
    return false;
  }
}

// Like hasProPlan but reports whether the billing check ERRORED, so callers doing
// destructive writes (e.g. the settings action) can fall back to the DB isPro
// mirror instead of wrongly treating a paying merchant as free and wiping their
// Pro-only config.
export async function checkProPlan(
  billing: Billing,
  isTest: boolean = billingIsTest,
): Promise<{ pro: boolean; errored: boolean }> {
  try {
    const c = await checkProAnyEnv(billing, isTest);
    return { pro: c.hasActivePayment, errored: false };
  } catch {
    return { pro: false, errored: true };
  }
}

// The active subscription's id + duration, so the Upgrade/Plans page can let a
// merchant CHANGE billing period (Monthly↔Annual) or CANCEL (downgrade to Free)
// without contacting support or reinstalling (App Store review requirement
// 1.2.3). Uses checkProAnyEnv so the sub is found regardless of the test/real env.
export async function activeSubscription(
  billing: Billing,
  isTest: boolean = billingIsTest,
): Promise<{ id: string; plan: "Monthly" | "Annual"; name: string } | null> {
  try {
    const c = await checkProAnyEnv(billing, isTest);
    if (!c.hasActivePayment) return null;
    const sub = c.appSubscriptions?.[0];
    if (!sub?.id) return null;
    const plan = sub.name === PRO_ANNUAL ? "Annual" : "Monthly";
    return { id: sub.id, plan, name: sub.name };
  } catch {
    return null;
  }
}

// On a Shopify development / App-Review store, recurring charges are ALWAYS test
// charges — so a reviewer picking Pro creates a TEST subscription. If we then
// billing.check with isTest:false we can't see it and the app wrongly shows Free
// (this paused Loyara's review, requirement 1.2.3). Resolve isTest from the store
// type: partner-development stores → test, real merchant stores → real. The SAME
// value must be used for billing.request AND billing.check. Cached per shop (a
// store's dev-status never changes) to avoid a GraphQL round-trip on every
// Pro-gated page load.
const devStoreIsTest = new Map<string, boolean>();
type AdminGraphqlClient = { graphql: (query: string) => Promise<Response> };
export async function resolveBillingIsTest(
  admin: AdminGraphqlClient,
  shop: string,
): Promise<boolean> {
  if (billingIsTest) return true; // local dev / BILLING_TEST=1 forces test
  const cached = devStoreIsTest.get(shop);
  if (cached !== undefined) return cached;
  try {
    const resp = await admin.graphql(
      `#graphql
      query StorePlanForBilling { shop { plan { partnerDevelopment displayName } } }`,
    );
    const body = (await resp.json()) as {
      data?: {
        shop?: { plan?: { partnerDevelopment?: boolean; displayName?: string } };
      };
    };
    const plan = body?.data?.shop?.plan;
    // Same non-production detection as isDevStore (they share devStoreIsTest, so
    // the two must agree): partnerDevelopment OR a dev/preview/partner/staff/
    // trial/sandbox plan name — partnerDevelopment alone under-detects review
    // stores (billing 1.2.2 root cause).
    const isTest =
      Boolean(plan?.partnerDevelopment) ||
      /develop|partner|staff|trial|sandbox|preview/i.test(plan?.displayName ?? "");
    devStoreIsTest.set(shop, isTest);
    return isTest;
  } catch {
    // On error default to REAL billing — never silently hand out free Pro.
    return false;
  }
}

// Is this a Shopify development / App-Review store? Same signal as
// resolveBillingIsTest (shop.plan.partnerDevelopment) but for contexts that have
// no admin client to hand — e.g. webhook handlers — so it opens an offline admin
// session itself. Used so that TEST orders (all a reviewer can place on a dev
// store) still accrue points during review, while real stores keep skipping the
// merchant's own Bogus-Gateway test orders. Shares the per-shop cache.
export async function isDevStore(shop: string): Promise<boolean> {
  if (billingIsTest) return true; // local dev / BILLING_TEST=1
  const cached = devStoreIsTest.get(shop);
  if (cached !== undefined) return cached;
  try {
    const { admin } = await shopify.unauthenticated.admin(shop);
    const resp = await admin.graphql(
      `#graphql
      query StorePlanIsDev { shop { plan { partnerDevelopment displayName } } }`,
    );
    const body = (await resp.json()) as {
      data?: {
        shop?: { plan?: { partnerDevelopment?: boolean; displayName?: string } };
      };
    };
    const plan = body?.data?.shop?.plan;
    // A reviewer can ONLY place TEST orders, so those must accrue during review —
    // but `partnerDevelopment` alone is unreliable (a Shopify App-Review store is
    // not always flagged, the same failure mode that made billing 1.2.2 recur).
    // So ALSO treat a non-production plan name (Developer Preview / Partner /
    // Staff / Trial / Sandbox / Plus Partner Sandbox) as a dev store. A real paid
    // store ("Basic"/"Shopify"/"Advanced"/"Shopify Plus") stays false and keeps
    // skipping the merchant's own Bogus-Gateway test orders.
    const dev =
      Boolean(plan?.partnerDevelopment) ||
      /develop|partner|staff|trial|sandbox|preview/i.test(plan?.displayName ?? "");
    devStoreIsTest.set(shop, dev);
    return dev;
  } catch {
    // Review-safety: if we cannot CONFIRM the store type, accrue the test order
    // rather than silently award nothing — a failed probe must never fail review.
    // Not cached: a real store's own rare test order during an outage accrues once
    // (trivially adjustable), and the next order re-probes for the real answer.
    return true;
  }
}

export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
