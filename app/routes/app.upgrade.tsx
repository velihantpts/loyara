import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  List,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import {
  authenticate,
  hasProPlan,
  PRO_MONTHLY,
  PRO_ANNUAL,
  resolveBillingIsTest,
} from "../shopify.server";

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

export default function Upgrade() {
  const nav = useNavigation();
  const submitting = nav.state === "submitting";
  const submittingPlan = nav.formData?.get("plan");

  return (
    <Page narrowWidth>
      <TitleBar title="Upgrade to Pro" />
      <BlockStack gap="400">
        <Text as="p" variant="bodyMd">
          One flat price. Every feature. Unlimited orders. Your growth is never
          our payday: no order-count tiers, no overage fees, ever. 14-day free
          trial, cancel anytime.
        </Text>
        <List>
          <List.Item>Unlimited orders, no per-order or tier fees</List.Item>
          <List.Item>VIP tiers &amp; referral program</List.Item>
          <List.Item>Birthday bonuses &amp; points expiry</List.Item>
          <List.Item>CSV migration from Smile, Rivo, BON &amp; Yotpo</List.Item>
          <List.Item>Remove &ldquo;Powered by Loyara&rdquo; branding</List.Item>
        </List>

        <Card>
          <BlockStack gap="200">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h3" variant="headingMd">
                Annual
              </Text>
              <Badge tone="success">2 months free</Badge>
            </InlineStack>
            <Text as="p" variant="headingLg">
              $190{" "}
              <Text as="span" variant="bodyMd" tone="subdued">
                / year
              </Text>
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              ~$15.83/mo. Compare: Smile Growth $199/mo, Yotpo $199/mo + per-order
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
              $19{" "}
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

        <Text as="p" variant="bodySm" tone="subdued" alignment="center">
          $0 due today. Your 14-day free trial starts now, cancel anytime in
          Settings before it ends.
        </Text>
        <Text as="p" variant="bodyXs" tone="subdued" alignment="center">
          Billed securely through Shopify.
        </Text>
      </BlockStack>
    </Page>
  );
}
