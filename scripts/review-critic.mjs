#!/usr/bin/env node
// Static "will an App Store reviewer reject this?" critic for the app factory.
//
// It encodes the review requirements that actually paused/blocked our apps so the
// SAME class of bug can never ship again. Reviewers test on Shopify development /
// App-Review stores, where EVERYTHING is a TEST transaction:
//   - 1.2.2 Billing: a reviewer's Pro subscription is a TEST charge. If the app
//     runs billing.check / billing.require / billing.request with a hard-coded
//     isTest:false (e.g. the bare `billingIsTest` env flag in production), it
//     never sees the charge and shows Free -> rejected.
//   - 2.1.4 Sync: on a dev store every order is a Bogus-Gateway TEST order. If
//     accrual bails on `payload.test` with no dev-store escape, nothing syncs and
//     the reviewer sees "0 points / No members yet" -> rejected.
//
// The correct pattern (see any app's shopify.server.ts): resolveBillingIsTest(
// admin, shop) / isDevStore(shop) reading shop.plan.partnerDevelopment, threaded
// into every billing call and the order-accrual guard.
//
// Usage:  node _factory/scripts/review-critic.mjs [appDir ...]
// With no args it scans the four known apps. Exits 1 if any HIGH finding.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", ".."); // ventures/shopify-apps

const DEFAULT_APPS = ["ai-act-ready", "ppwr-ready", "empco-ready", "loyara"];

function walk(dir, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "build") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(e.name)) acc.push(full);
  }
  return acc;
}

// Report a match's line number for a regex hit inside a file's text.
function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

function critique(appDir) {
  const findings = [];
  const add = (sev, rule, file, line, msg) =>
    findings.push({ sev, rule, file: path.relative(appDir, file), line, msg });

  const appRoot = path.join(appDir, "app");
  if (!fs.existsSync(appRoot)) return { findings, skipped: true };
  const files = walk(appRoot);
  const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } };

  const serverFile = path.join(appRoot, "shopify.server.ts");
  const serverSrc = read(serverFile);
  const hasBilling = /billing\s*:\s*\{/.test(serverSrc) || /PRO_PLANS/.test(serverSrc);
  const hasResolveHelper = /export\s+async\s+function\s+resolveBillingIsTest/.test(serverSrc);
  const hasDevStoreHelper = /export\s+async\s+function\s+isDevStore/.test(serverSrc);

  // Rule B0: an app that gates a Pro plan must define resolveBillingIsTest.
  if (hasBilling && !hasResolveHelper) {
    add("HIGH", "billing-helper-missing", serverFile, 1,
      "App has billing/PRO_PLANS but no resolveBillingIsTest() helper — a reviewer's TEST Pro charge on a dev store will never be seen (req 1.2.2).");
  }

  // ── Config-level checks (shopify.app*.toml + shopify.server.ts) ──
  // Read every shopify.app*.toml (config-link apps have >1); check the union.
  const tomls = fs.readdirSync(appDir).filter((f) => /^shopify\.app.*\.toml$/.test(f));
  const tomlSrc = tomls.map((f) => read(path.join(appDir, f))).join("\n");
  const tomlRef = tomls[0] ? path.join(appDir, tomls[0]) : serverFile;

  // Rule G1: the three mandatory GDPR/compliance webhooks must be subscribed —
  // App Store rejects apps that don't handle them.
  for (const topic of ["customers/data_request", "customers/redact", "shop/redact"]) {
    if (tomlSrc && !tomlSrc.includes(topic)) {
      add("HIGH", "gdpr-webhook-missing", tomlRef, 1,
        `Mandatory compliance webhook '${topic}' is not subscribed in any shopify.app*.toml — required for App Store approval.`);
    }
  }
  // Rule G2: and the handler route must exist for each mandatory topic.
  const gdprRoutes = {
    "customers/data_request": "webhooks.customers.data_request.tsx",
    "customers/redact": "webhooks.customers.redact.tsx",
    "shop/redact": "webhooks.shop.redact.tsx",
  };
  for (const [topic, route] of Object.entries(gdprRoutes)) {
    if (!fs.existsSync(path.join(appRoot, "routes", route))) {
      add("HIGH", "gdpr-handler-missing", path.join(appRoot, "routes", route), 1,
        `No handler for mandatory compliance webhook '${topic}' (expected app/routes/${route}).`);
    }
  }

  // Rule E1: an embedded app must use session-token (token-exchange) auth — a
  // Built-for-Shopify / embedded requirement the automated checks look for.
  if (/embedded\s*=\s*true/.test(tomlSrc) && !/unstable_newEmbeddedAuthStrategy/.test(serverSrc)) {
    add("MEDIUM", "embedded-no-session-token-auth", serverFile, 1,
      "Embedded app but shopify.server does not enable unstable_newEmbeddedAuthStrategy (session-token/token-exchange auth) — expected for embedded/Built-for-Shopify checks.");
  }

  // Rule E2: fail-fast prod env guard so a misconfigured deploy doesn't verify
  // OAuth/webhook HMAC against an empty secret.
  if (!(/NODE_ENV\s*===\s*["']production["']/.test(serverSrc) && /SHOPIFY_API_SECRET/.test(serverSrc))) {
    add("MEDIUM", "no-prod-env-guard", serverFile, 1,
      "No production env guard in shopify.server (throw on missing SHOPIFY_API_SECRET etc.) — a misconfigured prod deploy would verify HMAC against an empty secret.");
  }

  // Rule PCD: reading protected customer data (customers/orders) requires Partner
  // Dashboard PCD approval — a reviewer-facing gate that can't be checked in code.
  const scopeLine = (tomlSrc.match(/scopes\s*=\s*["']([^"']*)["']/) || [])[1] || "";
  if (/read_customers|read_orders|write_customers/.test(scopeLine)) {
    add("MEDIUM", "pcd-approval-reminder", tomlRef, 1,
      `Scopes request protected customer data (${scopeLine.match(/(read_customers|read_orders|write_customers)/g)?.join(", ")}) — confirm Protected Customer Data access is approved in the Partner Dashboard before submitting.`);
  }

  for (const f of files) {
    const src = read(f);
    const isRoute = /[\\/]routes[\\/]/.test(f);

    // Rule B1: a billing call using the bare env flag instead of a resolved value.
    // Matches: billing.check({... isTest: billingIsTest ...}) and request/require.
    const bareEnv = /billing\.(check|require|request)\s*\(\s*\{[^}]*isTest\s*:\s*billingIsTest/gs;
    for (const m of src.matchAll(bareEnv)) {
      add("HIGH", "billing-isTest-bare-env", f, lineOf(src, m.index),
        `billing.${m[1]} uses isTest:billingIsTest (env-only) — on a dev/review store this is false, so the reviewer's TEST charge is invisible. Use resolveBillingIsTest(admin, shop) (req 1.2.2).`);
    }

    // Rule B2: a billing check/require in a route that never resolves isTest at all.
    if (isRoute && /billing\.(check|require)\s*\(/.test(src) &&
        !/resolveBillingIsTest/.test(src)) {
      const m = src.match(/billing\.(check|require)\s*\(/);
      add("MEDIUM", "billing-isTest-unresolved", f, lineOf(src, m.index),
        `Route calls billing.${m[1]} but never calls resolveBillingIsTest — confirm the dev-store isTest is threaded through (req 1.2.2).`);
    }

    // Rule S1: an order-accrual test guard with no dev-store escape.
    // Matches `if (payload.test) return` / `if (x.test && ...) return` where the
    // same statement does not also mention accrueTestOrders / isDevStore.
    const testGuard = /if\s*\(\s*[a-zA-Z_.]*\.test\b[^)]*\)\s*return[^\n]*/g;
    for (const m of src.matchAll(testGuard)) {
      const stmt = m[0];
      if (!/accrueTestOrders|isDevStore|devStore/.test(stmt)) {
        add("HIGH", "test-order-no-devstore-escape", f, lineOf(src, m.index),
          `A '.test' guard returns with no dev-store escape — on a dev/review store every order is a TEST order, so this skips the reviewer's order and nothing syncs (req 2.1.4). Gate on accrueTestOrders/isDevStore.`);
      }
    }

    // Rule L1: never log a secret VALUE. Flags only when the secret is actually
    // EVALUATED into the log — read from env (`process.env.RESEND_API_KEY`),
    // interpolated (`${apiSecretKey}`), or passed as a bare argument — NOT when
    // its NAME merely appears in a string literal ("no RESEND_API_KEY set").
    const ENV_SEC = "RESEND_API_KEY|SHOPIFY_API_SECRET|CRON_SECRET|CLIENT_SECRET|API_SECRET|PRIVATE_KEY";
    const VAR_SEC = "apiSecretKey|apiSecret|clientSecret|privateKey|accessToken";
    const secretLog = new RegExp(
      `console\\.\\w+\\((?:` +
        `[^)]*process\\.env\\.(?:${ENV_SEC})` +          // process.env.SECRET logged
        `|[^)]*\\$\\{[^}]*\\b(?:${VAR_SEC})\\b` +         // ${secretVar} interpolated
        `|\\s*(?:${VAR_SEC})\\s*[),]` +                    // bare secretVar argument
      `)`,
      "g",
    );
    for (const m of src.matchAll(secretLog)) {
      add("HIGH", "secret-in-log", f, lineOf(src, m.index),
        `console.* appears to log a secret VALUE — remove it; secrets must never reach logs.`);
    }
  }

  return { findings, hasBilling, hasResolveHelper, hasDevStoreHelper };
}

// This file is the canonical copy in _factory AND is vendored into each app's
// scripts/ (so CI, which checks out only the single app repo, can run it). Keep
// the copies in sync. Resolution:
//   - explicit args -> resolve against the caller's CWD.
//   - no args, vendored inside an app (../app/shopify.server.ts exists) -> scan
//     that app (this is what `npm run preflight` uses via `review-critic.mjs .`).
//   - no args, the _factory copy -> scan the whole known portfolio.
const argv = process.argv.slice(2);
const selfApp = path.resolve(__dirname, "..");
const vendored = fs.existsSync(path.join(selfApp, "app", "shopify.server.ts"));
let apps;
if (argv.length) apps = argv.map((a) => (path.isAbsolute(a) ? a : path.resolve(process.cwd(), a)));
else if (vendored) apps = [selfApp];
else apps = DEFAULT_APPS.map((a) => path.join(ROOT, a));

let totalHigh = 0, totalMed = 0;
const bar = "─".repeat(72);
console.log(`\nReview-critic — App Store review gotchas (billing 1.2.2, sync 2.1.4,\nGDPR webhooks, embedded auth, env guard, secret-in-log, PCD)\n${bar}`);

for (const appDir of apps) {
  const name = path.basename(appDir);
  const { findings, skipped } = critique(appDir);
  if (skipped) { console.log(`\n${name}: (no app/ dir — skipped)`); continue; }
  const high = findings.filter((f) => f.sev === "HIGH");
  const med = findings.filter((f) => f.sev === "MEDIUM");
  totalHigh += high.length; totalMed += med.length;
  if (!findings.length) { console.log(`\n✓ ${name}: clean`); continue; }
  console.log(`\n${high.length ? "✗" : "!"} ${name}: ${high.length} HIGH, ${med.length} MEDIUM`);
  for (const f of findings.sort((a, b) => (a.sev < b.sev ? 1 : -1))) {
    console.log(`   [${f.sev}] ${f.rule}  ${f.file}:${f.line}`);
    console.log(`      ${f.msg}`);
  }
}

console.log(`\n${bar}\nTotal: ${totalHigh} HIGH, ${totalMed} MEDIUM`);
if (totalHigh > 0) {
  console.log("HIGH findings would likely get the app rejected in review. Fix before submitting.\n");
  process.exit(1);
}
console.log("No blocking findings.\n");
