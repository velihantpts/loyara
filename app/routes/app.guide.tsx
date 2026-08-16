import { useState } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Box,
  Text,
  Button,
  Badge,
  Link,
  List,
  Divider,
  Collapsible,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { BRAND, SUPPORT_EMAIL } from "../config";

/* ────────────────────────────────────────────────────────────────
 * PER-APP CONTENT — the GUIDE object is the only part to rewrite
 * when cloning to a new app. The renderer below stays identical.
 * ──────────────────────────────────────────────────────────────── */
type CTA = { label: string; url: string; external?: boolean };
type Step = { title: string; body: React.ReactNode; cta?: CTA };
type Feature = { title: string; body: React.ReactNode; plan?: "Free" | "Pro" };
type Faq = { q: string; a: React.ReactNode };
type Reference = { label: string; url: string };

const GUIDE: {
  intro: React.ReactNode;
  badge?: { tone: "info" | "success" | "attention"; text: string };
  steps: Step[];
  features: Feature[];
  faqs: Faq[];
  support: { email: string; note: React.ReactNode };
  references: Reference[];
  referencesNote?: React.ReactNode;
} = {
  intro: (
    <>
      {BRAND} turns one-time buyers into repeat customers with a
      points-and-rewards program that lives right on your storefront.
      Here&rsquo;s how to launch it in a few minutes.
    </>
  ),
  badge: { tone: "info", text: "Points & rewards" },
  steps: [
    {
      title: "Set your earn rate and rewards",
      body: (
        <>
          Choose your points earn rate — how many points a customer gets for each
          unit of currency they spend — and what they can redeem points for.
        </>
      ),
      cta: { label: "Open Program", url: "/app/settings" },
    },
    {
      title: "Add the widget to your theme",
      body: (
        <>
          In <b>Online Store → Themes → Customize</b>, open <b>App embeds</b>,
          enable the {BRAND} widget and <b>Save</b>. Customers can then see and
          redeem their points on your storefront.
        </>
      ),
    },
    {
      title: "Bring existing points across",
      body: (
        <>
          Switching from Smile, Rivo or BON? Import every balance so nobody loses
          a point.
        </>
      ),
      cta: { label: "Import points", url: "/app/migrate" },
    },
    {
      title: "Watch it grow",
      body: (
        <>
          Once your first members start earning, your dashboard shows members,
          points issued and redeemed, and program health.
        </>
      ),
      cta: { label: "Open the Dashboard", url: "/app" },
    },
  ],
  features: [
    {
      title: "Points & rewards",
      body: "Customers earn points on orders and redeem them for the rewards you set.",
      plan: "Free",
    },
    {
      title: "Storefront widget",
      body: "A points-and-rewards launcher your customers use directly on your store.",
      plan: "Free",
    },
    {
      title: "VIP tiers",
      body: "Reward your best customers with tiers that unlock better earn rates and perks.",
      plan: "Pro",
    },
    {
      title: "Referrals & birthday bonuses",
      body: "Grow through referrals and win loyalty with automatic birthday rewards.",
      plan: "Pro",
    },
    {
      title: "CSV migration & Klaviyo",
      body: "Import balances from other apps and sync loyalty data to Klaviyo.",
      plan: "Pro",
    },
  ],
  faqs: [
    {
      q: "What happens if I pause the program?",
      a: "Members stop earning new points while it's paused, but every existing balance is kept. Resume any time in Program and earning continues.",
    },
    {
      q: "Is there an order limit on the free plan?",
      a: "The free plan includes points, redemptions and the storefront widget. Pro is $19/mo flat — unlimited orders with no overage fees ever, plus VIP tiers, referrals and more — with a 14-day free trial.",
    },
    {
      q: "Will importing points create duplicates?",
      a: "No. Import matches each customer and brings their balance across once, so nobody ends up with double points.",
    },
    {
      q: "How do customers redeem points?",
      a: "Through the Loyara widget on your storefront: they open it, see their balance, and redeem points for the rewards you've set up.",
    },
  ],
  support: {
    email: SUPPORT_EMAIL,
    note: (
      <>
        Setting up rewards or migrating from another app? Email us — we usually
        reply within one business day.
      </>
    ),
  },
  references: [
    {
      label: "Using theme app blocks (Shopify Help)",
      url: "https://help.shopify.com/en/manual/online-store/themes/theme-structure/extend/apps",
    },
  ],
};

/* ────────────────────────────────────────────────────────────────
 * RENDERER — generic. Keep identical across apps.
 * ──────────────────────────────────────────────────────────────── */
function StepRow({ n, step }: { n: number; step: Step }) {
  return (
    <InlineStack gap="300" blockAlign="start" wrap={false}>
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 26,
          height: 26,
          borderRadius: "50%",
          background: "#008060",
          color: "#fff",
          fontSize: 13,
          fontWeight: 600,
          flexShrink: 0,
          marginTop: 2,
        }}
      >
        {n}
      </span>
      <BlockStack gap="150">
        <Text as="h3" variant="headingSm">
          {step.title}
        </Text>
        <Text as="p" variant="bodyMd" tone="subdued">
          {step.body}
        </Text>
        {step.cta ? (
          <Box>
            <Button
              url={step.cta.url}
              target={step.cta.external ? "_blank" : undefined}
              variant="secondary"
            >
              {step.cta.label}
            </Button>
          </Box>
        ) : null}
      </BlockStack>
    </InlineStack>
  );
}

function FaqItem({ item, index }: { item: Faq; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <BlockStack gap="200">
      <Button
        variant="plain"
        textAlign="left"
        fullWidth
        disclosure={open ? "up" : "down"}
        onClick={() => setOpen((o) => !o)}
        ariaExpanded={open}
        ariaControls={`faq-${index}`}
      >
        {item.q}
      </Button>
      <Collapsible
        id={`faq-${index}`}
        open={open}
        transition={{ duration: "150ms", timingFunction: "ease-in-out" }}
      >
        <Box paddingBlockEnd="200">
          <Text as="p" variant="bodyMd" tone="subdued">
            {item.a}
          </Text>
        </Box>
      </Collapsible>
      <Divider />
    </BlockStack>
  );
}

export default function GuidePage() {
  return (
    <Page>
      <TitleBar title="Guide" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Getting started
                  </Text>
                  {GUIDE.badge ? (
                    <Badge tone={GUIDE.badge.tone}>{GUIDE.badge.text}</Badge>
                  ) : null}
                </InlineStack>
                <Text as="p" variant="bodyMd">
                  {GUIDE.intro}
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Quick start
                </Text>
                <BlockStack gap="400">
                  {GUIDE.steps.map((s, i) => (
                    <StepRow key={i} n={i + 1} step={s} />
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  What&rsquo;s included
                </Text>
                <BlockStack gap="300">
                  {GUIDE.features.map((f, i) => (
                    <Box key={i}>
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="h3" variant="headingSm">
                          {f.title}
                        </Text>
                        {f.plan ? (
                          <Badge tone={f.plan === "Pro" ? "success" : undefined}>
                            {f.plan}
                          </Badge>
                        ) : null}
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {f.body}
                      </Text>
                    </Box>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Common questions
                </Text>
                <BlockStack gap="200">
                  {GUIDE.faqs.map((q, i) => (
                    <FaqItem key={i} item={q} index={i} />
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Need a hand?
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  {GUIDE.support.note}
                </Text>
                <Box>
                  <Button url={`mailto:${GUIDE.support.email}`} variant="primary">
                    Email support
                  </Button>
                </Box>
              </BlockStack>
            </Card>

            {GUIDE.references.length > 0 ? (
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    References
                  </Text>
                  <List>
                    {GUIDE.references.map((r, i) => (
                      <List.Item key={i}>
                        <Link url={r.url} target="_blank" removeUnderline>
                          {r.label}
                        </Link>
                      </List.Item>
                    ))}
                  </List>
                  {GUIDE.referencesNote ? (
                    <Text as="p" variant="bodyXs" tone="subdued">
                      {GUIDE.referencesNote}
                    </Text>
                  ) : null}
                </BlockStack>
              </Card>
            ) : null}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
