#!/usr/bin/env node
// DRY test runner for a factory app. Canonical copy lives in _factory AND is
// vendored into each app's scripts/ (so CI, which checks out only the app repo,
// can run it) — keep the copies in sync. Run from an app dir (or pass one):
//   node scripts/run-app-tests.mjs        (vendored, e.g. via `npm test`)
//   node _factory/scripts/run-app-tests.mjs <appDir>
// It discovers scripts/*-test.ts, bundles each with the app's esbuild, gives
// engine tests a throwaway SQLite DB (prisma db push), runs them with node, and
// exits non-zero if any fail. No test framework, matching engine-test.ts's style.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const appDir = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const scriptsDir = path.join(appDir, "scripts");
const run = (cmd, env) =>
  execSync(cmd, { cwd: appDir, stdio: "inherit", env: { ...process.env, ...env } });

if (!fs.existsSync(scriptsDir)) { console.log("no scripts/ dir — nothing to test"); process.exit(0); }
const tests = fs.readdirSync(scriptsDir).filter((f) => /-test\.ts$/.test(f)).sort();
if (!tests.length) { console.log("no *-test.ts files — nothing to test"); process.exit(0); }

let failed = 0;
for (const t of tests) {
  const name = t.replace(/\.ts$/, "");
  const out = path.join("scripts", `.${name}.cjs`);
  const needsDb = /engine/.test(name); // ledger tests hit a real SQLite DB
  const dbFile = path.join(scriptsDir, `.${name}.db`);
  const dbUrl = `file:${dbFile}`;
  console.log(`\n=== ${name} ===`);
  try {
    execSync(
      `npx esbuild scripts/${t} --bundle --platform=node --format=cjs --external:@prisma/client --external:.prisma --outfile=${out}`,
      { cwd: appDir, stdio: "pipe" },
    );
    const env = { DATABASE_URL: dbUrl };
    if (needsDb) {
      try { fs.rmSync(dbFile, { force: true }); } catch {}
      execSync(`npx prisma db push --skip-generate`, { cwd: appDir, stdio: "pipe", env: { ...process.env, ...env } });
    }
    run(`node ${out}`, env);
  } catch (e) {
    failed++;
    // node exits non-zero on failing assertions; its output already streamed.
    if (e.status === undefined) console.error(e.message);
  } finally {
    try { fs.rmSync(path.join(appDir, out), { force: true }); } catch {}
    try { fs.rmSync(dbFile, { force: true }); } catch {}
  }
}

console.log(`\n${failed ? `✗ ${failed} test file(s) failed` : "✓ all test files passed"}`);
process.exit(failed ? 1 : 0);
