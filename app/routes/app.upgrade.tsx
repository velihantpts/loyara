import { PRICE_MONTHLY, PRICE_ANNUAL, PRICE_ANNUAL_PER_MO, ANNUAL_BADGE } from "../pricing";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Box,
  Text,
  Button,
  Badge,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import {
  authenticate,
  hasProPlan,
  PRO_MONTHLY,
  PRO_ANNUAL,
  resolveBillingIsTest,
} from "../shopify.server";

const FEATURES: { label: string; free: boolean; pro: boolean }[] = [
  { label: "Points, rewards & storefront widget", free: true, pro: true },
  { label: "Redeem for automatic discount codes", free: true, pro: true },
  { label: "Redeem as store credit — one tap in checkout, no codes", free: false, pro: true },
  { label: "Unlimited orders — no tier or overage fees", free: false, pro: true },
  { label: "VIP tiers & referral program", free: false, pro: true },
  { label: "Birthday bonuses & points expiry", free: false, pro: true },
  { label: "CSV migration (Smile, Rivo, BON, Yotpo) & Klaviyo", free: false, pro: true },
  { label: "Remove “Powered by Loyara” branding", free: false, pro: true },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const isTest = await resolveBillingIsTest(admin, session.shop);
  if (await hasProPlan(billing, isTest)) throw redirect("/app");
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const form = await request.formData();
  const plan = form.get("plan") === "annual" ? PRO_ANNUAL : PRO_MONTHLY;
  const isTest = await resolveBillingIsTest(admin, session.shop);
  return billing.request({ plan, isTest });
};

function Cell({ on }: { on: boolean }) {
  return (
    <Box minWidth="54px">
      <Text
        as="span"
        alignment="center"
        tone={on ? "success" : "subdued"}
        fontWeight={on ? "semibold" : "regular"}
      >
        {on ? "✓" : "—"}
      </Text>
    </Box>
  );
}

function Compare() {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" wrap={false}>
          <Text as="h3" variant="headingSm">
            What&rsquo;s included
          </Text>
          <InlineStack gap="0" wrap={false}>
            <Box minWidth="54px">
              <Text as="span" variant="bodySm" tone="subdued" alignment="center">
                Free
              </Text>
            </Box>
            <Box minWidth="54px">
              <Text as="span" variant="bodySm" alignment="center" fontWeight="semibold">
                Pro
              </Text>
            </Box>
          </InlineStack>
        </InlineStack>
        {FEATURES.map((f) => (
          <InlineStack key={f.label} align="space-between" blockAlign="center" gap="200" wrap={false}>
            <Text as="span" variant="bodySm">
              {f.label}
            </Text>
            <InlineStack gap="0" wrap={false}>
              <Cell on={f.free} />
              <Cell on={f.pro} />
            </InlineStack>
          </InlineStack>
        ))}
      </BlockStack>
    </Card>
  );
}

function TrustBlock() {
  return (
    <Box background="bg-surface-secondary" borderRadius="300" padding="400">
      <BlockStack gap="150">
        <Text as="p" variant="bodySm">
          <b>Cancel in one click</b>, anytime — no lock-in.
        </Text>
        <Text as="p" variant="bodySm">
          <b>Your data stays inside Shopify.</b> We never sell or share it.
        </Text>
        <Text as="p" variant="bodySm">
          <b>A real person replies.</b> Email us and you&rsquo;ll hear back from
          the founder, not a queue.
        </Text>
      </BlockStack>
    </Box>
  );
}

export default function Upgrade() {
  const nav = useNavigation();
  const submitting = nav.state === "submitting";
  const submittingPlan = nav.formData?.get("plan");

  return (
    <Page narrowWidth>
      <TitleBar title="Upgrade to Pro" />
      <BlockStack gap="400">
        <Text as="p" variant="bodyMd">
          <b>
            Pro lets customers redeem points as store credit — applied in one tap
            at checkout, with no codes to copy and no popups.
          </b>{" "}
          It&rsquo;s the redemption flow shoppers actually finish. Plus one flat
          price, unlimited orders and no overage fees, ever. 14-day free trial,
          cancel anytime.
        </Text>

        <Compare />

        <Card>
          <BlockStack gap="200">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h3" variant="headingMd">
                Annual
              </Text>
              <Badge tone="success">{ANNUAL_BADGE}</Badge>
            </InlineStack>
            <Text as="p" variant="headingLg">
              {PRICE_ANNUAL}{" "}
              <Text as="span" variant="bodyMd" tone="subdued">
                / year
              </Text>
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              ~{PRICE_ANNUAL_PER_MO}/mo. Compare: Smile Growth $199/mo, Yotpo $199/mo + per-order
              fees.
            </Text>
            <Form method="post">
              <input type="hidden" name="plan" value="annual" />
              <Button
                submit
                variant="primary"
                fullWidth
                loading={submitting && submittingPlan === "annual"}
                disabled={submitting}
              >
                Start free trial
              </Button>
            </Form>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingMd">
              Monthly
            </Text>
            <Text as="p" variant="headingLg">
              {PRICE_MONTHLY}{" "}
              <Text as="span" variant="bodyMd" tone="subdued">
                / month
              </Text>
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Flat, unlimited orders. Cancel anytime.
            </Text>
            <Form method="post">
              <input type="hidden" name="plan" value="monthly" />
              <Button
                submit
                fullWidth
                loading={submitting && submittingPlan === "monthly"}
                disabled={submitting}
              >
                Start free trial
              </Button>
            </Form>
          </BlockStack>
        </Card>

        <TrustBlock />

        <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
          $0 due today. Your 14-day free trial starts now — cancel anytime in
          Settings before it ends.
        </Text>
        <Text as="p" variant="bodyXs" tone="subdued" alignment="center">
          Billed securely through Shopify.
        </Text>
      </BlockStack>
    </Page>
  );
}
