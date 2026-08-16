#!/usr/bin/env node
// Measures the REAL shipped footprint of the storefront widget: the bytes of the
// <style> + <script> that actually load on a shopper's page (the {% schema %} and
// liquid config are NOT shipped). Prints raw + gzip. The dashboard's speed card
// reads a stored value; widget-size-test.ts re-runs this and fails if the stored
// number drifts — so the claim can never quietly become false.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const liquid = path.join(here, "..", "extensions", "loyara-widget", "blocks", "loyara.liquid");

export function measureWidget() {
  const src = fs.readFileSync(liquid, "utf8");
  // The bytes that actually load on the storefront = <style> + <script> content.
  const blocks = [...src.matchAll(/<style>([\s\S]*?)<\/style>/g), ...src.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const shipped = blocks.map((m) => m[1]).join("");
  const rawBytes = Buffer.byteLength(shipped, "utf8");
  const gzipBytes = zlib.gzipSync(Buffer.from(shipped, "utf8")).length;
  return { rawBytes, gzipBytes, rawKB: +(rawBytes / 1024).toFixed(1), gzipKB: +(gzipBytes / 1024).toFixed(1) };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("measure-widget.mjs")) {
  const m = measureWidget();
  console.log(`widget shipped CSS+JS: ${m.rawBytes} bytes (${m.rawKB} KB), gzipped ${m.gzipBytes} bytes (${m.gzipKB} KB)`);
}
