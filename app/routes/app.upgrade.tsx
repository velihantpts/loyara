import { PRICE_MONTHLY, PRICE_ANNUAL, PRICE_ANNUAL_PER_MO, ANNUAL_BADGE } from "../pricing";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
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
  activeSubscription,
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
  // The active plan (if any) — so a Pro merchant can CHANGE billing period or
  // CANCEL here (App Store review 1.2.3), instead of being redirected away.
  const sub = await activeSubscription(billing, isTest);
  return json({ current: sub ? sub.plan : null });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const form = await request.formData();
  const isTest = await resolveBillingIsTest(admin, session.shop);

  // Downgrade to Free: cancel the active subscription (1.2.3 — no support ticket,
  // no reinstall). Re-fetch the sub id server-side; never trust the client.
  if (form.get("intent") === "cancel") {
    const sub = await activeSubscription(billing, isTest);
    if (sub) {
      try {
        await billing.cancel({ subscriptionId: sub.id, isTest, prorate: true });
      } catch {
        // Best-effort — if the cancel races another change, the reload reconciles.
      }
    }
    return redirect("/app/upgrade");
  }

  // Subscribe, or switch billing period (billing.request replaces any existing
  // subscription on Shopify's managed confirmation page).
  const plan = form.get("plan") === "annual" ? PRO_ANNUAL : PRO_MONTHLY;
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
  const submittingIntent = nav.formData?.get("intent");
  const { current } = useLoaderData<typeof loader>();

  return (
    <Page narrowWidth>
      <TitleBar title={current ? "Your plan" : "Upgrade to Pro"} />
      <BlockStack gap="400">
        <Text as="p" variant="bodyMd">
          {current ? (
            <b>
              Manage your plan below — switch billing period or cancel anytime.
              Nothing here needs a support ticket or a reinstall.
            </b>
          ) : (
            <>
              <b>
                Pro lets customers redeem points as store credit — applied in one
                tap at checkout, with no codes to copy and no popups.
              </b>{" "}
              It&rsquo;s the redemption flow shoppers actually finish. Plus one
              flat price, unlimited orders and no overage fees, ever. 14-day free
              trial, cancel anytime.
            </>
          )}
        </Text>

        {current ? (
          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingMd">
                  Your plan
                </Text>
                <Badge tone="success">{`Pro · ${current} · active`}</Badge>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                Change your billing period below, or downgrade to Free — your
                points program and storefront widget stay on the Free plan.
              </Text>
              <Form method="post">
                <input type="hidden" name="intent" value="cancel" />
                <Button
                  submit
                  variant="plain"
                  tone="critical"
                  loading={submitting && submittingIntent === "cancel"}
                  disabled={submitting}
                >
                  Cancel Pro (downgrade to Free)
                </Button>
              </Form>
            </BlockStack>
          </Card>
        ) : null}

        <Compare />

        <Card>
          <BlockStack gap="200">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h3" variant="headingMd">
                Annual
              </Text>
              <Badge tone="success">
                {current === "Annual" ? "Current plan" : ANNUAL_BADGE}
              </Badge>
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
                variant={!current ? "primary" : undefined}
                fullWidth
                loading={submitting && submittingPlan === "annual"}
                disabled={submitting || current === "Annual"}
              >
                {!current
                  ? "Start free trial"
                  : current === "Annual"
                    ? "Current plan"
                    : "Switch to Annual"}
              </Button>
            </Form>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h3" variant="headingMd">
                Monthly
              </Text>
              {current === "Monthly" ? (
                <Badge tone="success">Current plan</Badge>
              ) : null}
            </InlineStack>
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
                disabled={submitting || current === "Monthly"}
              >
                {!current
                  ? "Start free trial"
                  : current === "Monthly"
                    ? "Current plan"
                    : "Switch to Monthly"}
              </Button>
            </Form>
          </BlockStack>
        </Card>

        <TrustBlock />

        {!current ? (
          <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
            $0 due today. Your 14-day free trial starts now — cancel anytime in
            Settings before it ends.
          </Text>
        ) : null}
        <Text as="p" variant="bodyXs" tone="subdued" alignment="center">
          Billed securely through Shopify.
        </Text>
      </BlockStack>
    </Page>
  );
}
