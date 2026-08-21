import { useEffect } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Text,
  Card,
  Button,
  BlockStack,
  InlineStack,
  Badge,
  Box,
  InlineGrid,
  ProgressBar,
  Banner,
  Link,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate, hasProPlan, resolveBillingIsTest } from "../shopify.server";
import prisma from "../db.server";
import { ensureConfig, setPro, maybeRequestReview } from "../loyalty/shop.server";
import { programStats, retentionCohorts } from "../loyalty/stats.server";
import { parseRedeemTiers } from "../loyalty/config";
import { WIDGET_SIZE } from "../lib/widget-size";
import { requestReviewOnce } from "../lib/core/review";
import { BRAND } from "../config";

// The theme app extension's uid (extensions/loyara-widget/shopify.extension.toml)
// + block file name — used for the "add widget" theme-editor deep link.
const WIDGET_EXTENSION_UUID = "4b82198e-5b8c-4cd6-9596-a5ab04bcf133";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const shop = session.shop;
  const isTest = await resolveBillingIsTest(admin, shop);

  const [config, hasPro, stats] = await Promise.all([
    ensureConfig(shop),
    hasProPlan(billing, isTest),
    programStats(shop),
  ]);
  // Only write when the mirror actually changed (avoid a write per page load).
  if (config.isPro !== hasPro) await setPro(shop, hasPro);

  // Lazily cache the shop currency (for widget labels) and, for Pro, the contact
  // email (for the monthly summary) — one GraphQL call, only when missing.
  if (!config.currency || (hasPro && !config.email)) {
    try {
      const r = await admin.graphql(`#graphql
        query { shop { currencyCode email } }`);
      const j = (await r.json()) as {
        data?: { shop?: { currencyCode?: string; email?: string } };
      };
      const currency = j?.data?.shop?.currencyCode ?? config.currency;
      const email = hasPro ? (j?.data?.shop?.email ?? config.email) : config.email;
      await prisma.shopConfig.update({
        where: { shop },
        data: { currency, email },
      });
    } catch {
      // best-effort
    }
  }

  const rewards = parseRedeemTiers(config.redeemTiers);
  // Actionable retention cohorts (only worth computing once there are members).
  const cheapestReward = rewards.length
    ? Math.min(...rewards.map((r) => r.points))
    : null;
  const cohorts =
    stats.members > 0
      ? await retentionCohorts(shop, config.pointsExpiryDays, cheapestReward)
      : { nearReward: 0, expiringSoon: 0, expiringPoints: 0 };

  // Peak-value moment → once-only review prompt (first time we cross 5 members
  // AND at least one reward has been redeemed).
  const peak = stats.members >= 5 && stats.pointsRedeemed > 0;
  const askReview = await maybeRequestReview(shop, peak);

  return {
    shop,
    hasPro,
    stats,
    rewardCount: rewards.length,
    onboarded: config.onboardedAt != null,
    cohorts,
    programActive: config.programActive,
    pointsPerDollar: config.pointsPerDollar,
    currency: config.currency ?? "USD",
    askReview,
  };
};

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Box background="bg-surface-secondary" borderRadius="300" padding="400">
      <BlockStack gap="100">
        <Text as="span" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <Text as="span" variant="headingLg">
          {value}
        </Text>
        {hint ? (
          <Text as="span" variant="bodyXs" tone="subdued">
            {hint}
          </Text>
        ) : null}
      </BlockStack>
    </Box>
  );
}

// Signature hero gauge — the same ring DNA as the compliance apps' ScoreRing, so
// the portfolio reads as one product family. Shows the program's headline health
// number (redemption rate) instead of a wall of settings.
function Gauge({ value, caption }: { value: number; caption: string }) {
  const r = 46;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const offset = circ * (1 - pct / 100);
  return (
    <svg
      width="112"
      height="112"
      viewBox="0 0 112 112"
      role="img"
      aria-label={`${caption}: ${pct}%`}
      style={{ flexShrink: 0 }}
    >
      <circle
        cx="56"
        cy="56"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.12"
        strokeWidth="10"
      />
      <circle
        cx="56"
        cy="56"
        r={r}
        fill="none"
        stroke="var(--p-color-text-success, #008060)"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform="rotate(-90 56 56)"
      />
      <text
        x="56"
        y="52"
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="26"
        fontWeight="600"
        fill="currentColor"
      >
        {pct}%
      </text>
      <text
        x="56"
        y="74"
        textAnchor="middle"
        fontSize="10"
        fill="currentColor"
        fillOpacity="0.6"
      >
        {caption}
      </text>
    </svg>
  );
}

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const shopify = useAppBridge();

  useEffect(() => {
    if (data.askReview) void requestReviewOnce(shopify);
  }, [data.askReview, shopify]);

  const nf = new Intl.NumberFormat("en-US");
  // Show the merchant's real currency ("€1", "£1") instead of the developer
  // phrase "per unit spent" / a hardcoded "$". config.currency is cached on load.
  const money1 = (() => {
    try {
      return new Intl.NumberFormat("en", {
        style: "currency",
        currency: data.currency,
        currencyDisplay: "narrowSymbol",
        maximumFractionDigits: 0,
      }).format(1);
    } catch {
      return `${data.currency} 1`;
    }
  })();
  const onboardingDone =
    (data.onboarded ? 1 : 0) + (data.stats.members > 0 ? 1 : 0);

  return (
    <Page>
      <TitleBar title={BRAND} />
      <BlockStack gap="500">
        {!data.programActive && (
          <Banner tone="warning" title="Your loyalty program is paused">
            <Text as="p" variant="bodyMd">
              Members aren&rsquo;t earning points while it&rsquo;s paused.{" "}
              <Link url="/app/settings">Resume it in Program</Link>.
            </Text>
          </Banner>
        )}
        <Card>
          <InlineStack
            align="space-between"
            blockAlign="center"
            wrap={false}
            gap="400"
          >
            <BlockStack gap="300">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h2" variant="headingLg">
                  Your loyalty program
                </Text>
                <Badge tone={data.programActive ? "success" : "warning"}>
                  {data.programActive ? "Active" : "Paused"}
                </Badge>
              </InlineStack>
              <Text as="p" variant="bodyMd" tone="subdued">
                Members earn {data.pointsPerDollar} point
                {data.pointsPerDollar === 1 ? "" : "s"} per {money1} spent,
                redeemable for {data.rewardCount} reward
                {data.rewardCount === 1 ? "" : "s"}.
              </Text>
              {data.stats.members > 0 && (
                <Text as="p" variant="bodySm" tone="subdued">
                  {nf.format(data.stats.members)} member
                  {data.stats.members === 1 ? "" : "s"} ·{" "}
                  {nf.format(data.stats.outstanding)} unredeemed points
                </Text>
              )}
            </BlockStack>
            {data.stats.members > 0 && (
              <Gauge
                value={data.stats.redemptionRate * 100}
                caption="redeemed"
              />
            )}
          </InlineStack>
        </Card>

        {/* Hide the metric grids until the first member earns — a wall of zeros
            is a poor first impression; lead new stores with setup instead. */}
        {data.stats.members > 0 && (
          <>
        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="300">
          <Stat
            label="Members"
            value={nf.format(data.stats.members)}
            hint="Customers enrolled in your program"
          />
          <Stat
            label="Points issued"
            value={nf.format(data.stats.pointsIssued)}
            hint="Total points ever earned"
          />
          <Stat
            label="Points redeemed"
            value={nf.format(data.stats.pointsRedeemed)}
            hint="Points customers have cashed in for rewards"
          />
          <Stat
            label="Unredeemed points"
            value={nf.format(data.stats.outstanding)}
            hint="Still owed to customers — your liability"
          />
        </InlineGrid>

        {/* Program health — the anti-churn view: is the program actually being
            used? All computed from the ledger, no extra order queries. */}
        <Card>
          <BlockStack gap="400">
            <Text as="h3" variant="headingMd">
              Program health
            </Text>
            <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="300">
              <Stat
                label="Active members"
                value={`${nf.format(data.stats.activeMembers)} of ${nf.format(data.stats.members)}`}
                hint="Hold a spendable balance right now"
              />
              <Stat
                label="Members who redeemed"
                value={nf.format(data.stats.redeemingMembers)}
                hint="Have claimed at least one reward"
              />
              <Stat
                label="Redemption rate"
                value={`${Math.round(data.stats.redemptionRate * 100)}%`}
                hint="Points redeemed vs issued"
              />
              <Stat
                label="Avg active balance"
                value={nf.format(data.stats.avgBalance)}
                hint="Mean points per active member"
              />
            </InlineGrid>
            <Text as="p" variant="bodySm" tone="subdued">
              Redemption rate is points spent vs issued; a healthy program keeps
              it moving, because points customers actually redeem are what bring
              them back.
              {data.stats.pointsExpired > 0
                ? ` ${nf.format(data.stats.pointsExpired)} points have expired so far.`
                : ""}
            </Text>
          </BlockStack>
        </Card>

        {/* Actionable retention cohorts — the return hook rivals lead with. */}
        {(data.cohorts.nearReward > 0 || data.cohorts.expiringSoon > 0) && (
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                Bring them back
              </Text>
              <BlockStack gap="200">
                {data.cohorts.nearReward > 0 && (
                  <InlineStack gap="200" blockAlign="center" wrap={false}>
                    <Badge tone="attention">
                      {nf.format(data.cohorts.nearReward)}
                    </Badge>
                    <Text as="span" variant="bodyMd">
                      member{data.cohorts.nearReward === 1 ? " is" : "s are"} close
                      to their next reward — one more order could get them there.
                    </Text>
                  </InlineStack>
                )}
                {data.cohorts.expiringSoon > 0 && (
                  <InlineStack gap="200" blockAlign="center" wrap={false}>
                    <Badge tone="warning">
                      {nf.format(data.cohorts.expiringSoon)}
                    </Badge>
                    <Text as="span" variant="bodyMd">
                      member{data.cohorts.expiringSoon === 1 ? " has" : "s have"}{" "}
                      {nf.format(data.cohorts.expiringPoints)} points expiring
                      within 7 days.
                    </Text>
                  </InlineStack>
                )}
              </BlockStack>
              <Text as="p" variant="bodySm" tone="subdued">
                {data.hasPro
                  ? "Pro sends these members an automatic Klaviyo nudge before it's too late."
                  : "Pro can nudge these members automatically (via Klaviyo) before it's too late — turning at-risk points into repeat orders."}
              </Text>
            </BlockStack>
          </Card>
        )}
          </>
        )}

        {/* Getting started — live progress derived from real state (settings
            saved, first member earned). Hides once you're set up AND live. */}
        {!(data.onboarded && data.stats.members > 0) && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingMd">
                  Get set up
                </Text>
                <Badge tone={onboardingDone > 0 ? "attention" : "new"}>
                  {`${onboardingDone} of 2 done`}
                </Badge>
              </InlineStack>
              <ProgressBar
                progress={(onboardingDone / 2) * 100}
                size="small"
                tone="primary"
              />

              <Box background="bg-surface-secondary" borderRadius="300" padding="400">
                <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone={data.onboarded ? "success" : "new"}>
                      {data.onboarded ? "Done" : "Step 1"}
                    </Badge>
                    <Text
                      as="span"
                      variant="bodyMd"
                      tone={data.onboarded ? "subdued" : undefined}
                    >
                      Set your earn rate and rewards
                    </Text>
                  </InlineStack>
                  {!data.onboarded && (
                    <Button url="/app/settings" variant="primary">
                      Open Program
                    </Button>
                  )}
                </InlineStack>
              </Box>

              <Box background="bg-surface-secondary" borderRadius="300" padding="400">
                <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone={data.stats.members > 0 ? "success" : "new"}>
                      {data.stats.members > 0 ? "Done" : "Step 2"}
                    </Badge>
                    <Text
                      as="span"
                      variant="bodyMd"
                      tone={data.stats.members > 0 ? "subdued" : undefined}
                    >
                      Go live — add the widget so customers see and redeem their
                      points
                    </Text>
                  </InlineStack>
                  {data.stats.members === 0 && (
                    <Button
                      url={`https://${data.shop}/admin/themes/current/editor?context=apps&activateAppId=${WIDGET_EXTENSION_UUID}/loyara`}
                      target="_top"
                      variant={data.onboarded ? "primary" : "secondary"}
                    >
                      Add the widget
                    </Button>
                  )}
                </InlineStack>
              </Box>

              <InlineStack gap="400" wrap>
                <Button variant="plain" url="/app/migrate">
                  Import points from another app
                </Button>
                <Button variant="plain" url="/app/guide">
                  2-minute setup guide
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        {/* Pro */}
        <Card>
          <InlineStack align="space-between" blockAlign="center" wrap={false}>
            <BlockStack gap="100">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h3" variant="headingSm">
                  Loyara Pro
                </Text>
                <Badge tone={data.hasPro ? "success" : "new"}>
                  {data.hasPro ? "Active" : "Free plan"}
                </Badge>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                {data.hasPro
                  ? "You're on Pro: unlimited orders, VIP tiers, referrals, CSV migration and branding removal, one flat price, no overage fees."
                  : "Free includes points, redemptions and the storefront widget. Pro is $9/mo flat: unlimited orders, VIP tiers, referrals, birthday bonuses, CSV migration and Klaviyo, with no overage fees ever. 14-day free trial."}
              </Text>
              {!data.hasPro && data.stats.members >= 50 ? (
                <Text as="p" variant="bodySm">
                  At {nf.format(data.stats.members)} members, Smile&rsquo;s Growth
                  plan would run ~$199/mo — Loyara stays <b>$9 flat</b>, no matter
                  how big you grow.
                </Text>
              ) : null}
            </BlockStack>
            {!data.hasPro && (
              <Button url="/app/upgrade" variant="primary">
                Upgrade
              </Button>
            )}
          </InlineStack>
        </Card>

        {/* Storefront speed — REAL measured footprint (app/lib/widget-size.ts,
            guarded by widget-size-test) + the merchant's own PageSpeed link. */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h3" variant="headingMd">
                Storefront speed
              </Text>
              <Badge tone="success">Lightweight</Badge>
            </InlineStack>
            <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
              <Stat
                label="Over the wire"
                value={`${WIDGET_SIZE.gzipKB} KB`}
                hint="gzipped CSS + JS the widget loads"
              />
              <Stat
                label="Uncompressed"
                value={`${WIDGET_SIZE.rawKB} KB`}
                hint="raw source size"
              />
              <Stat
                label="Layout shift (CLS)"
                value="0"
                hint="fixed-position — never pushes your content"
              />
            </InlineGrid>
            <Text as="p" variant="bodySm" tone="subdued">
              No external frameworks or CDN — the widget is inline CSS + JS, so it
              barely touches your page speed. Measured from the shipped code, not
              a marketing number.
            </Text>
            <Box>
              <Button
                url={`https://pagespeed.web.dev/analysis?url=https://${data.shop}`}
                target="_blank"
                variant="secondary"
              >
                Check your store on PageSpeed Insights
              </Button>
            </Box>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
