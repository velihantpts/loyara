#!/usr/bin/env node
// Fail-fast env validator. Run in CI or before boot to catch a misconfigured
// production deploy (the #1 way these apps break: SHOPIFY_API_KEY missing in
// prod => App Bridge can't load and the embedded app shows a blank frame).
//
// Usage: node scripts/check-env.mjs   (or: npm run check-env)

const isProd = process.env.NODE_ENV === "production";

// Always required (dev + prod): the DB must be reachable to store sessions.
const ALWAYS = ["DATABASE_URL"];

// Required in production. In local dev the Shopify CLI injects these.
const PROD_ONLY = [
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_APP_URL",
  "SCOPES",
];

// Optional, but warn so you notice a silently-disabled feature.
const OPTIONAL = ["RESEND_API_KEY", "EMAIL_FROM", "CRON_SECRET"];

const required = [...ALWAYS, ...(isProd ? PROD_ONLY : [])];
const missing = required.filter((k) => !process.env[k]);
const missingOptional = OPTIONAL.filter((k) => !process.env[k]);

// Loud guard: TEST billing in production means merchants get Pro for free.
if (isProd && process.env.BILLING_TEST === "1") {
  console.error(
    "✗ BILLING_TEST=1 in production — this creates TEST charges (no revenue). Unset it.",
  );
  process.exit(1);
}

if (missingOptional.length) {
  console.warn(
    `⚠ Optional env not set (feature disabled): ${missingOptional.join(", ")}`,
  );
}

if (missing.length) {
  console.error(`✗ Missing required env: ${missing.join(", ")}`);
  process.exit(1);
}

console.log(`✓ Env OK (${isProd ? "production" : "development"})`);
