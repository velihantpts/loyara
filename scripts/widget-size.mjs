// CI byte-budget gate for the storefront widget.
//
// The Loyara widget's headline performance claim (listing + GROWTH.md) is that it
// ships tiny — "<8KB, zero external scripts, zero layout shift". This gate makes
// that claim CI-enforceable: it measures the gzipped over-the-wire size of the
// shopper-facing payload (the inline <style> + <script> of the theme app embed)
// and fails the build if it ever exceeds the budget. If a feature pushes the
// widget over budget, this fails loudly instead of silently eroding the claim.
//
// Run: node scripts/widget-size.mjs   (add to CI before `shopify app deploy`)

import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WIDGET = join(
  __dirname,
  "..",
  "extensions",
  "loyara-widget",
  "blocks",
  "loyara.liquid",
);

// Budget for the gzipped shopper-facing payload. Current ~4.6KB; 8KB matches the
// public "<8KB" claim and leaves clear headroom.
const BUDGET_GZIP_BYTES = 8 * 1024;

function extractBlocks(src) {
  // Grab the inline <style>…</style> and <script>…</script> — that's what a
  // shopper actually downloads. Liquid tags inside are a rounding error on size.
  const blocks = [];
  const re = /<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi;
  let m;
  while ((m = re.exec(src)) !== null) blocks.push(m[0]);
  return blocks.join("\n");
}

const src = readFileSync(WIDGET, "utf8");
const payload = extractBlocks(src);
if (!payload) {
  console.error("[widget-size] FAIL: no <style>/<script> found in", WIDGET);
  process.exit(1);
}

const rawBytes = Buffer.byteLength(payload, "utf8");
const gzipBytes = gzipSync(payload, { level: 9 }).length;
const kb = (n) => (n / 1024).toFixed(2) + "KB";

console.log(
  `[widget-size] payload raw ${kb(rawBytes)} · gzipped ${kb(gzipBytes)} · budget ${kb(BUDGET_GZIP_BYTES)} gzip`,
);

if (gzipBytes > BUDGET_GZIP_BYTES) {
  console.error(
    `[widget-size] FAIL: gzipped payload ${kb(gzipBytes)} exceeds budget ${kb(BUDGET_GZIP_BYTES)}.`,
  );
  process.exit(1);
}
console.log("[widget-size] OK — within budget.");
