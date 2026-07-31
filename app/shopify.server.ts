import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

// Pro billing. Free tier = points earn/redeem + basic widget, up to 200 orders/mo.
// Pro (monthly or annual) = UNLIMITED orders + every feature (VIP tiers, referrals,
// CSV migration, branding removal, expiry/birthday) — the anti-gating flat-price wedge.
// The plan NAMES are the listing "internal plan handle" — SIGNED 2026-07-30, IRREVERSIBLE.
export const PRO_MONTHLY = "Pro";
export const PRO_ANNUAL = "Pro annual";
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
      trialDays: 14,
      lineItems: [
        {
          amount: 19,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
    [PRO_ANNUAL]: {
      trialDays: 14,
      lineItems: [
        {
          amount: 190,
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
export async function hasProPlan(billing: Billing): Promise<boolean> {
  try {
    const c = await billing.check({ plans: PRO_PLANS, isTest: billingIsTest });
    return c.hasActivePayment;
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
): Promise<{ pro: boolean; errored: boolean }> {
  try {
    const c = await billing.check({ plans: PRO_PLANS, isTest: billingIsTest });
    return { pro: c.hasActivePayment, errored: false };
  } catch {
    return { pro: false, errored: true };
  }
}

export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
