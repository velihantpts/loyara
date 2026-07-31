import { PrismaClient } from "@prisma/client";

declare global {
  var prismaGlobal: PrismaClient;
}

// Pin SQLite to a single pooled connection. busy_timeout is a per-connection
// setting, so with Prisma's default pool the PRAGMA below would land on only one
// connection and the rest would still fail immediately with SQLITE_BUSY. One
// connection also matches SQLite's single-writer model for this single-tenant
// embedded app.
function makePrisma(): PrismaClient {
  const base = process.env.DATABASE_URL ?? "";
  const url =
    base.startsWith("file:") && !/[?&]connection_limit=/.test(base)
      ? base + (base.includes("?") ? "&" : "?") + "connection_limit=1"
      : base;
  return url
    ? new PrismaClient({ datasources: { db: { url } } })
    : new PrismaClient();
}

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = makePrisma();
  }
}

const prisma = global.prismaGlobal ?? makePrisma();

// SQLite tuning: WAL lets readers proceed during a write, and busy_timeout makes
// a writer wait for the single-writer lock instead of failing with SQLITE_BUSY —
// important under concurrent webhooks + dashboard loads. With connection_limit=1
// these reliably apply to the one connection. Best-effort on boot.
prisma.$executeRawUnsafe("PRAGMA journal_mode=WAL;").catch(() => {});
prisma.$executeRawUnsafe("PRAGMA busy_timeout=5000;").catch(() => {});

export default prisma;
