import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Card,
  DataTable,
  Text,
  BlockStack,
  Box,
  EmptyState,
  Button,
  Modal,
  TextField,
  InlineStack,
  useBreakpoints,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { randomUUID } from "node:crypto";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { displayBalance } from "../loyalty/balance.server";
import { applyEntry } from "../loyalty/points.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const customers = await prisma.customer.findMany({
    where: { shop: session.shop },
    orderBy: { balance: "desc" },
    take: 100,
  });
  return {
    members: customers.map((c) => ({
      gid: c.shopifyGid,
      label: c.email ?? c.shopifyGid.replace("gid://shopify/Customer/", "#"),
      balance: displayBalance(c.balance),
      lifetime: c.lifetimeEarned,
      vip: c.vipTier ?? "—",
    })),
  };
};

// Manual points adjustment (goodwill credit / correction). Goes through the same
// applyEntry ledger primitive as everything else, with a unique sourceId so each
// adjustment is its own immutable, audited entry (never deduped). ADJUST_MANUAL
// moves the balance but not lifetimeEarned, so it can't quietly inflate VIP tier.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const customerGid = String(form.get("customerGid") ?? "");
  const delta = Math.trunc(Number(form.get("delta")));
  const note = String(form.get("note") ?? "").slice(0, 200);

  if (!customerGid.startsWith("gid://") || !Number.isFinite(delta) || delta === 0) {
    return { ok: false, error: "Enter a non-zero number of points." };
  }

  await applyEntry({
    shop: session.shop,
    customerGid,
    delta,
    reason: "ADJUST_MANUAL",
    sourceType: "manual",
    sourceId: `manual-${randomUUID()}`,
    meta: { note, source: "admin-members" },
  });
  return { ok: true, error: null as string | null };
};

type Member = {
  gid: string;
  label: string;
  balance: number;
  lifetime: number;
  vip: string;
};

export default function Members() {
  const { members } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const nf = new Intl.NumberFormat("en-US");

  const { smDown } = useBreakpoints();
  const [active, setActive] = useState<Member | null>(null);
  const [delta, setDelta] = useState("");
  const [note, setNote] = useState("");
  const saving = fetcher.state !== "idle";

  const openAdjust = (m: Member) => {
    setActive(m);
    setDelta("");
    setNote("");
  };

  // Close + toast once the adjustment lands (loader auto-revalidates the table).
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) {
      shopify.toast.show("Points adjusted");
      setActive(null);
      setDelta("");
      setNote("");
    } else if (fetcher.data.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.state, fetcher.data, shopify]);

  const save = () => {
    if (!active) return;
    fetcher.submit({ customerGid: active.gid, delta, note }, { method: "POST" });
  };

  return (
    <Page>
      <TitleBar title="Members" />
      <Card padding="0">
        {members.length === 0 ? (
          <Box>
            <EmptyState
              heading="No members yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                Members appear here as customers earn points. Add the widget to
                your theme and set your earn rate in Settings to get started.
              </p>
            </EmptyState>
          </Box>
        ) : (
          <BlockStack>
            {smDown ? (
              // Mobile: a 5-column table overflows a 375px admin, so stack each
              // member into a row that fits and keeps the Adjust action reachable.
              <BlockStack gap="0">
                {members.map((m) => (
                  <Box
                    key={m.gid}
                    padding="300"
                    borderBlockEndWidth="025"
                    borderColor="border"
                  >
                    <InlineStack
                      align="space-between"
                      blockAlign="center"
                      gap="300"
                      wrap={false}
                    >
                      <BlockStack gap="050">
                        <Text as="span" variant="bodyMd" truncate>
                          {m.label}
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {nf.format(m.balance)} pts · lifetime{" "}
                          {nf.format(m.lifetime)}
                          {m.vip !== "—" ? ` · ${m.vip}` : ""}
                        </Text>
                      </BlockStack>
                      <Button variant="plain" onClick={() => openAdjust(m)}>
                        Adjust
                      </Button>
                    </InlineStack>
                  </Box>
                ))}
              </BlockStack>
            ) : (
              <DataTable
                columnContentTypes={["text", "numeric", "numeric", "text", "text"]}
                headings={["Customer", "Points", "Lifetime", "VIP tier", ""]}
                rows={members.map((m) => [
                  <span
                    key={m.gid}
                    title={m.label}
                    style={{
                      display: "inline-block",
                      maxWidth: 240,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      verticalAlign: "bottom",
                    }}
                  >
                    {m.label}
                  </span>,
                  nf.format(m.balance),
                  nf.format(m.lifetime),
                  m.vip,
                  <Button
                    key={`adj-${m.gid}`}
                    variant="plain"
                    onClick={() => openAdjust(m)}
                  >
                    Adjust
                  </Button>,
                ])}
              />
            )}
            <Box padding="300">
              <Text as="p" variant="bodyXs" tone="subdued">
                Showing up to 100 members by balance.
              </Text>
            </Box>
          </BlockStack>
        )}
      </Card>

      {active ? (
        <Modal
          open
          onClose={() => setActive(null)}
          title={`Adjust points — ${active.label}`}
          primaryAction={{
            content: "Save adjustment",
            onAction: save,
            loading: saving,
            disabled: saving || delta.trim() === "",
          }}
          secondaryActions={[
            { content: "Cancel", onAction: () => setActive(null) },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              <Text as="p" variant="bodySm" tone="subdued">
                Current balance: {nf.format(active.balance)} points. Enter a
                positive number to add points, or a negative number to remove
                them.
              </Text>
              <TextField
                label="Points adjustment"
                type="number"
                value={delta}
                onChange={setDelta}
                autoComplete="off"
                placeholder="e.g. 100 or -50"
              />
              <TextField
                label="Note (optional)"
                value={note}
                onChange={setNote}
                autoComplete="off"
                maxLength={200}
                helpText="Saved to the ledger for your records."
              />
            </BlockStack>
          </Modal.Section>
        </Modal>
      ) : null}
    </Page>
  );
}
