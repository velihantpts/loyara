import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  Text,
  TextField,
  Button,
  Banner,
  List,
  Box,
  Link,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate, hasProPlan, resolveBillingIsTest } from "../shopify.server";
import { ensureConfig } from "../loyalty/shop.server";
import { applyEntry } from "../loyalty/points.server";
import prisma from "../db.server";
import { parseVipTiers, computeVipTier } from "../loyalty/config";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const isTest = await resolveBillingIsTest(admin, session.shop);
  const [, hasPro] = await Promise.all([
    ensureConfig(session.shop),
    hasProPlan(billing, isTest),
  ]);
  return { hasPro };
};

const MAX_ROWS = 5000;
const BATCH = 40; // emails per GraphQL lookup

type GraphqlAdmin = {
  graphql: (
    query: string,
    opts?: { variables?: Record<string, unknown> },
  ) => Promise<{ json: () => Promise<unknown> }>;
};

// Minimal CSV line parser (handles quoted fields with commas).
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

// Resolve a batch of emails → { email(lowercased): customerGid }.
async function resolveBatch(
  admin: GraphqlAdmin,
  emails: string[],
): Promise<Record<string, string>> {
  const q = emails.map((e) => `email:"${e.replace(/"/g, "")}"`).join(" OR ");
  const resp = await admin.graphql(
    `#graphql
    query Resolve($q: String!) {
      customers(first: 100, query: $q) { edges { node { id email } } }
    }`,
    { variables: { q } },
  );
  const json = (await resp.json()) as {
    data?: { customers?: { edges?: { node?: { id?: string; email?: string } }[] } };
  };
  const map: Record<string, string> = {};
  for (const edge of json?.data?.customers?.edges ?? []) {
    const e = edge.node?.email?.toLowerCase();
    const id = edge.node?.id;
    if (e && id) map[e] = id;
  }
  return map;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const shop = session.shop;
  const isTest = await resolveBillingIsTest(admin, session.shop);
  if (!(await hasProPlan(billing, isTest)))
    return { ok: false as const, error: "Importing points is a Pro feature." };

  const form = await request.formData();
  const csv = String(form.get("csv") ?? "");
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { ok: false as const, error: "No rows found." };

  // Header + column auto-detection.
  const firstCells = parseCsvLine(lines[0]);
  const hasHeader = !firstCells.some((c) => c.includes("@"));
  let emailIdx = 0, pointsIdx = 1, lifetimeIdx = -1;
  if (hasHeader) {
    const h = firstCells.map((c) => c.toLowerCase());
    const find = (...keys: string[]) => h.findIndex((c) => keys.some((k) => c.includes(k)));
    emailIdx = Math.max(0, find("email", "e-mail"));
    const p = find("point", "balance"); pointsIdx = p >= 0 ? p : 1;
    lifetimeIdx = find("lifetime", "total earned", "earned");
  }
  const dataLines = (hasHeader ? lines.slice(1) : lines).slice(0, MAX_ROWS);

  // Parse rows.
  interface Row { email: string; points: number; lifetime: number | null; }
  const rows: Row[] = [];
  let skipped = 0;
  for (const line of dataLines) {
    const cols = parseCsvLine(line);
    const email = (cols[emailIdx] ?? "").toLowerCase();
    const points = Math.trunc(Number(cols[pointsIdx]));
    const lifetime = lifetimeIdx >= 0 ? Math.trunc(Number(cols[lifetimeIdx])) : null;
    if (!email.includes("@") || !Number.isFinite(points) || points <= 0) {
      skipped++;
      continue;
    }
    rows.push({ email, points, lifetime: Number.isFinite(lifetime as number) ? lifetime : null });
  }

  // Batch-resolve emails → GIDs.
  const uniqueEmails = Array.from(new Set(rows.map((r) => r.email)));
  const gidByEmail: Record<string, string> = {};
  for (let i = 0; i < uniqueEmails.length; i += BATCH) {
    const chunk = uniqueEmails.slice(i, i + BATCH);
    try {
      Object.assign(gidByEmail, await resolveBatch(admin, chunk));
    } catch (e) {
      console.warn("[migrate] batch resolve failed:", e);
    }
  }

  const vipTiers = parseVipTiers(
    (await prisma.shopConfig.findUnique({ where: { shop }, select: { vipTiers: true } }))?.vipTiers,
  );

  let imported = 0;
  const unmatched: string[] = [];
  for (const r of rows) {
    const gid = gidByEmail[r.email];
    if (!gid) { unmatched.push(r.email); continue; }
    const res = await applyEntry({
      shop,
      customerGid: gid,
      customerEmail: r.email,
      delta: r.points,
      reason: "EARN_MANUAL", // lifetime reflects import so VIP recomputes
      sourceType: "manual",
      sourceId: `import:${r.email}`,
      meta: { source: "csv_migration" },
    });
    if (res.applied) {
      imported++;
      // If the CSV carries a higher lifetime (e.g. a "lifetime earned" column),
      // bump it so a migrated member keeps their VIP tier — but NEVER lower an
      // existing member's lifetime (max against the post-applyEntry value).
      const current = res.lifetimeEarned ?? 0;
      if (r.lifetime && r.lifetime > current) {
        const vip = computeVipTier(r.lifetime, vipTiers);
        await prisma.customer.update({
          where: { shop_shopifyGid: { shop, shopifyGid: gid } },
          data: { lifetimeEarned: r.lifetime, vipTier: vip?.name ?? null },
        });
      }
    } else skipped++;
  }

  return {
    ok: true as const,
    imported,
    skipped,
    notFound: unmatched.length,
    unmatched: unmatched.slice(0, 200),
    total: dataLines.length,
  };
};

export default function Migrate() {
  const { hasPro } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [csv, setCsv] = useState("");
  const busy = fetcher.state !== "idle";
  const result = fetcher.data;

  return (
    <Page>
      <TitleBar title="Import points" />
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Switch from Smile, Rivo or BON in minutes
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Export your members from your old app and paste the CSV below;
              every balance moves with you. Nobody loses a point.
            </Text>
            <List>
              <List.Item>
                Paste your export <b>as-is</b>. Columns are auto-detected from the
                header row (email, points/balance, and lifetime/earned if present).
              </List.Item>
              <List.Item>
                A <code>lifetime</code> column is used to keep migrated members&rsquo;
                VIP tiers. Re-running the same import is safe (applied once per email).
              </List.Item>
              <List.Item>Up to {MAX_ROWS.toLocaleString()} rows per import.</List.Item>
            </List>
          </BlockStack>
        </Card>

        {!hasPro && (
          <Banner tone="warning">
            Importing points is a Pro feature (included in the 14-day free trial).{" "}
            <Link url="/app/upgrade">Start Pro</Link>
          </Banner>
        )}

        {result?.ok && (
          <Banner tone="success">
            Imported {result.imported} member(s). Skipped {result.skipped}
            {result.notFound > 0
              ? `, ${result.notFound} email(s) had no matching Shopify customer`
              : ""}
            .
          </Banner>
        )}
        {result && !result.ok && <Banner tone="critical">{result.error}</Banner>}

        {result?.ok && result.unmatched.length > 0 && (
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Unmatched emails ({result.notFound})
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                These weren&rsquo;t found as Shopify customers (no account yet).
                They&rsquo;ll match automatically once they sign up and you re-import.
              </Text>
              <Box background="bg-surface-secondary" borderRadius="200" padding="300">
                <Text as="p" variant="bodySm">
                  {result.unmatched.join(", ")}
                  {result.notFound > result.unmatched.length ? " …" : ""}
                </Text>
              </Box>
            </BlockStack>
          </Card>
        )}

        <Card>
          <BlockStack gap="300">
            <TextField
              label="Paste CSV"
              value={csv}
              onChange={setCsv}
              multiline={8}
              autoComplete="off"
              placeholder={"email,points,lifetime\njane@example.com,540,1200\njohn@example.com,120,120"}
            />
            <Button
              variant="primary"
              loading={busy}
              disabled={!hasPro || csv.trim().length === 0}
              onClick={() => fetcher.submit({ csv }, { method: "post" })}
            >
              Import points
            </Button>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
