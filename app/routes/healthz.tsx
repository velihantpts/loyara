import { json } from "@remix-run/node";
import prisma from "../db.server";

// Liveness/readiness probe for the platform (Coolify healthcheck, uptime pings).
// Checks the two things that actually break a deploy: the DB is openable, and
// SHOPIFY_API_KEY is present (missing key => App Bridge can't load => blank
// embedded frame). Returns 200 {ok:true} or 503 with the failed checks — no
// secrets, safe to expose. GET /healthz
export const loader = async () => {
  const checks: Record<string, boolean> = {
    db: false,
    apiKey: Boolean(process.env.SHOPIFY_API_KEY),
  };

  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    checks.db = true;
  } catch {
    checks.db = false;
  }

  const ok = Object.values(checks).every(Boolean);
  return json({ ok, checks }, { status: ok ? 200 : 503 });
};
