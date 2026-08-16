// Guards the speed card's honesty: re-measures the widget's shipped CSS+JS and
// asserts the stored WIDGET_SIZE still matches within tolerance. If the widget
// grows and nobody re-runs measure-widget.mjs, this FAILS — so the dashboard can
// never advertise a size the widget no longer has. No fake numbers.

import fs from "node:fs";
import zlib from "node:zlib";
import { WIDGET_SIZE } from "../app/lib/widget-size";

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

// cwd is the app dir when run via npm test.
const src = fs.readFileSync(
  "extensions/loyara-widget/blocks/loyara.liquid",
  "utf8",
);
const blocks = [
  ...src.matchAll(/<style>([\s\S]*?)<\/style>/g),
  ...src.matchAll(/<script>([\s\S]*?)<\/script>/g),
];
const shipped = blocks.map((m) => m[1]).join("");
const rawKB = +(Buffer.byteLength(shipped, "utf8") / 1024).toFixed(1);
const gzipKB = +(zlib.gzipSync(Buffer.from(shipped, "utf8")).length / 1024).toFixed(1);

const TOL = 0.3; // KB
check(
  `stored rawKB (${WIDGET_SIZE.rawKB}) matches measured (${rawKB})`,
  Math.abs(WIDGET_SIZE.rawKB - rawKB) <= TOL,
  "re-run: node scripts/measure-widget.mjs and update app/lib/widget-size.ts",
);
check(
  `stored gzipKB (${WIDGET_SIZE.gzipKB}) matches measured (${gzipKB})`,
  Math.abs(WIDGET_SIZE.gzipKB - gzipKB) <= TOL,
  "re-run: node scripts/measure-widget.mjs and update app/lib/widget-size.ts",
);
check("widget stays small (gzip < 20 KB)", gzipKB < 20);

console.log(`\n${fail ? `✗ ${fail} failed` : `✓ all ${pass} passed`}`);
if (fail) process.exit(1);
