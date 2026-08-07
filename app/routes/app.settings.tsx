import { useState, useCallback, useEffect, useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  TextField,
  Select,
  Checkbox,
  Button,
  Text,
  Box,
  Banner,
  Divider,
} from "@shopify/polaris";
import { TitleBar, useAppBridge, SaveBar } from "@shopify/app-bridge-react";
import {
  authenticate,
  hasProPlan,
  checkProPlan,
  resolveBillingIsTest,
} from "../shopify.server";
import { ensureConfig } from "../loyalty/shop.server";
import prisma from "../db.server";
import {
  parseRedeemTiers,
  parseVipTiers,
  parseRedemptionMode,
  type RedeemTier,
  type VipTier,
} from "../loyalty/config";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const isTest = await resolveBillingIsTest(admin, session.shop);
  const [config, hasPro] = await Promise.all([
    ensureConfig(session.shop),
    hasProPlan(billing, isTest),
  ]);
  return {
    hasPro,
    settings: {
      programActive: config.programActive,
      pointsPerDollar: config.pointsPerDollar,
      signupBonus: config.signupBonus,
      birthdayBonus: config.birthdayBonus,
      pointsExpiryDays: config.pointsExpiryDays,
      referralReward: config.referralReward,
      referralFriendDiscount: config.referralFriendDiscount,
      emailNotifications: config.emailNotifications,
      nudgeEmails: config.nudgeEmails,
      klaviyoApiKey: config.klaviyoApiKey ?? "",
      brandingRemoved: config.brandingRemoved,
      redemptionMode: parseRedemptionMode(config.redemptionMode),
      redeemTiers: parseRedeemTiers(config.redeemTiers),
      vipTiers: parseVipTiers(config.vipTiers),
    },
  };
};

interface Payload {
  programActive: boolean;
  pointsPerDollar: number;
  signupBonus: number;
  birthdayBonus: number;
  pointsExpiryDays: number;
  referralReward: number;
  referralFriendDiscount: number;
  emailNotifications: boolean;
  nudgeEmails: boolean;
  klaviyoApiKey: string;
  brandingRemoved: boolean;
  redemptionMode: string;
  redeemTiers: RedeemTier[];
  vipTiers: VipTier[];
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const shop = session.shop;

  const form = await request.formData();
  let p: Payload;
  try {
    p = JSON.parse(String(form.get("payload"))) as Payload;
  } catch {
    return { ok: false, error: "Invalid form data" };
  }

  // Never treat a transient billing-API error as "not Pro" — that would let this
  // action wipe a paying merchant's Pro-only config. On error, fall back to the
  // DB isPro mirror.
  const isTest = await resolveBillingIsTest(admin, shop);
  const { pro, errored } = await checkProPlan(billing, isTest);
  const mirror = await prisma.shopConfig.findUnique({
    where: { shop },
    select: { isPro: true },
  });
  const hasPro = errored ? (mirror?.isPro ?? false) : pro;

  const clampInt = (v: unknown, min = 0) =>
    Math.max(min, Math.trunc(Number(v) || 0));

  const redeemTiers = (Array.isArray(p.redeemTiers) ? p.redeemTiers : [])
    .map((t) => {
      const type = t.type === "percent" ? ("percent" as const) : ("fixed" as const);
      // Percent discounts cap at 100 — a value above that fails at mint time and
      // silently breaks every redemption of the tier.
      const max = type === "percent" ? 100 : Number.MAX_SAFE_INTEGER;
      return {
        points: clampInt(t.points, 1),
        value: Math.min(max, clampInt(t.value, 1)),
        type,
      };
    })
    .filter((t) => t.points > 0 && t.value > 0);

  const vipTiers = (Array.isArray(p.vipTiers) ? p.vipTiers : [])
    .map((t) => ({
      name: String(t.name ?? "").slice(0, 40),
      threshold: clampInt(t.threshold, 0),
      multiplier: Math.max(1, Number(t.multiplier) || 1),
    }))
    .filter((t) => t.name.length > 0);

  await prisma.shopConfig.update({
    where: { shop },
    data: {
      programActive: Boolean(p.programActive),
      pointsPerDollar: clampInt(p.pointsPerDollar, 0),
      signupBonus: clampInt(p.signupBonus, 0),
      // Pro-gated features silently ignored on the free plan.
      birthdayBonus: hasPro ? clampInt(p.birthdayBonus, 0) : 0,
      pointsExpiryDays: hasPro ? clampInt(p.pointsExpiryDays, 0) : 0,
      referralReward: hasPro ? clampInt(p.referralReward, 0) : 0,
      referralFriendDiscount: hasPro ? clampInt(p.referralFriendDiscount, 0) : 0,
      emailNotifications: hasPro ? Boolean(p.emailNotifications) : false,
      nudgeEmails: hasPro ? Boolean(p.nudgeEmails) : false,
      klaviyoApiKey: hasPro ? (String(p.klaviyoApiKey ?? "").trim() || null) : null,
      brandingRemoved: hasPro ? Boolean(p.brandingRemoved) : false,
      // Store-credit fulfilment is Pro-only; free/downgraded shops stay on codes.
      redemptionMode: hasPro ? parseRedemptionMode(p.redemptionMode) : "discount",
      redeemTiers: JSON.stringify(redeemTiers),
      vipTiers: JSON.stringify(hasPro ? vipTiers : []),
      onboardedAt: new Date(),
    },
  });

  return { ok: true };
};

export default function Settings() {
  const { hasPro, settings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const saving = fetcher.state !== "idle";

  const [programActive, setProgramActive] = useState(settings.programActive);
  const [pointsPerDollar, setPPD] = useState(String(settings.pointsPerDollar));
  const [signupBonus, setSignup] = useState(String(settings.signupBonus));
  const [birthdayBonus, setBirthday] = useState(String(settings.birthdayBonus));
  const [expiry, setExpiry] = useState(String(settings.pointsExpiryDays));
  const [referralReward, setReferral] = useState(String(settings.referralReward));
  const [friendDiscount, setFriendDiscount] = useState(
    String(settings.referralFriendDiscount),
  );
  const [emailNotifications, setEmailNotif] = useState(
    settings.emailNotifications,
  );
  const [nudgeEmails, setNudge] = useState(settings.nudgeEmails);
  const [klaviyoApiKey, setKlaviyo] = useState(settings.klaviyoApiKey);
  const [redemptionMode, setRedemptionMode] = useState<string>(
    settings.redemptionMode,
  );
  const [brandingRemoved, setBranding] = useState(settings.brandingRemoved);
  const [redeemTiers, setRedeem] = useState<RedeemTier[]>(
    settings.redeemTiers.length
      ? settings.redeemTiers
      : [{ points: 500, value: 5, type: "fixed" }],
  );
  const [vipTiers, setVip] = useState<VipTier[]>(settings.vipTiers);

  // Contextual save bar: a snapshot of every editable value drives the dirty
  // check + Discard. `baseline` is the last-saved (or loaded) state; the bar
  // shows whenever the form diverges from it.
  const currentValues = {
    programActive,
    pointsPerDollar,
    signupBonus,
    birthdayBonus,
    expiry,
    referralReward,
    friendDiscount,
    emailNotifications,
    nudgeEmails,
    klaviyoApiKey,
    redemptionMode,
    brandingRemoved,
    redeemTiers,
    vipTiers,
  };
  type Values = typeof currentValues;
  const [baseline, setBaseline] = useState<Values>(currentValues);
  const dirty = JSON.stringify(currentValues) !== JSON.stringify(baseline);
  // Keep the latest snapshot reachable from the save-success effect without
  // re-arming it on every keystroke.
  const cvRef = useRef<Values>(currentValues);
  cvRef.current = currentValues;

  const applyValues = useCallback((v: Values) => {
    setProgramActive(v.programActive);
    setPPD(v.pointsPerDollar);
    setSignup(v.signupBonus);
    setBirthday(v.birthdayBonus);
    setExpiry(v.expiry);
    setReferral(v.referralReward);
    setFriendDiscount(v.friendDiscount);
    setEmailNotif(v.emailNotifications);
    setNudge(v.nudgeEmails);
    setKlaviyo(v.klaviyoApiKey);
    setRedemptionMode(v.redemptionMode);
    setBranding(v.brandingRemoved);
    setRedeem(v.redeemTiers);
    setVip(v.vipTiers);
  }, []);
  const discard = useCallback(
    () => applyValues(baseline),
    [applyValues, baseline],
  );

  const save = useCallback(() => {
    const payload: Payload = {
      programActive,
      pointsPerDollar: Number(pointsPerDollar) || 0,
      signupBonus: Number(signupBonus) || 0,
      birthdayBonus: Number(birthdayBonus) || 0,
      pointsExpiryDays: Number(expiry) || 0,
      referralReward: Number(referralReward) || 0,
      referralFriendDiscount: Number(friendDiscount) || 0,
      emailNotifications,
      nudgeEmails,
      klaviyoApiKey,
      brandingRemoved,
      redemptionMode,
      redeemTiers,
      vipTiers,
    };
    fetcher.submit(
      { payload: JSON.stringify(payload) },
      { method: "post" },
    );
  }, [
    programActive,
    pointsPerDollar,
    signupBonus,
    birthdayBonus,
    expiry,
    referralReward,
    friendDiscount,
    emailNotifications,
    nudgeEmails,
    klaviyoApiKey,
    brandingRemoved,
    redemptionMode,
    redeemTiers,
    vipTiers,
    fetcher,
  ]);

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show("Settings saved");
      // The saved values become the new baseline → the save bar auto-hides.
      setBaseline(cvRef.current);
    }
  }, [fetcher.data, shopify]);

  const updateRedeem = (i: number, patch: Partial<RedeemTier>) =>
    setRedeem((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const updateVip = (i: number, patch: Partial<VipTier>) =>
    setVip((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Page>
      <TitleBar title="Settings" />
      <SaveBar id="loyara-settings-save-bar" open={dirty || saving}>
        {/* App Bridge styles these buttons; variant/loading are custom element
            attributes App Bridge reads, so they're spread past button's typing. */}
        <button
          {...({ variant: "primary", ...(saving ? { loading: "" } : {}) } as any)}
          onClick={save}
        >
          Save
        </button>
        <button onClick={discard} disabled={saving}>
          Discard
        </button>
      </SaveBar>
      <BlockStack gap="500">
        {!hasPro && (
          <Banner tone="info">
            You&rsquo;re on the free plan. Birthday bonuses, referrals, VIP tiers
            and branding removal are Pro features;{" "}
            <Button variant="plain" url="/app/upgrade">
              upgrade for $19/mo flat
            </Button>
            .
          </Banner>
        )}

        {/* Earning */}
        <Card>
          <BlockStack gap="400">
            <Text as="h3" variant="headingMd">
              Earning
            </Text>
            <Checkbox
              label="Program active"
              checked={programActive}
              onChange={setProgramActive}
              helpText="When off, no points are earned or redeemed."
            />
            <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
              <TextField
                label="Points earned per $1 spent"
                type="number"
                autoComplete="off"
                value={pointsPerDollar}
                onChange={setPPD}
                min={0}
              />
              <TextField
                label="Signup bonus (points)"
                type="number"
                autoComplete="off"
                value={signupBonus}
                onChange={setSignup}
                min={0}
              />
              <TextField
                label="Birthday bonus (points)"
                type="number"
                autoComplete="off"
                value={birthdayBonus}
                onChange={setBirthday}
                min={0}
                disabled={!hasPro}
                helpText={hasPro ? undefined : "Pro"}
              />
              <TextField
                label="Points expire after (days, 0 = never)"
                type="number"
                autoComplete="off"
                value={expiry}
                onChange={setExpiry}
                min={0}
                disabled={!hasPro}
                helpText={hasPro ? undefined : "Pro"}
              />
            </InlineGrid>
          </BlockStack>
        </Card>

        {/* Rewards */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h3" variant="headingMd">
                Rewards (redemption tiers)
              </Text>
              <Button
                onClick={() =>
                  setRedeem((r) => [...r, { points: 1000, value: 10, type: "fixed" }])
                }
              >
                Add reward
              </Button>
            </InlineStack>
            <Select
              label="Reward delivery"
              options={[
                { label: "Discount code (works on any plan)", value: "discount" },
                { label: "Store credit (Pro)", value: "store_credit" },
              ]}
              value={redemptionMode}
              onChange={setRedemptionMode}
              disabled={!hasPro}
              helpText={
                hasPro
                  ? "Store credit applies value straight to the customer's account at checkout, with no code to enter. Only fixed-amount tiers can be issued as store credit (percentage tiers still mint a code)."
                  : "Pro only; free plans deliver rewards as discount codes."
              }
            />
            {redeemTiers.map((t, i) => (
              <Box key={i}>
                <InlineGrid columns={{ xs: 1, sm: 4 }} gap="300">
                  <TextField
                    label="Points"
                    type="number"
                    autoComplete="off"
                    value={String(t.points)}
                    onChange={(v) => updateRedeem(i, { points: Number(v) || 0 })}
                    min={1}
                  />
                  <TextField
                    label="Discount value"
                    type="number"
                    autoComplete="off"
                    value={String(t.value)}
                    onChange={(v) => updateRedeem(i, { value: Number(v) || 0 })}
                    min={1}
                  />
                  <Select
                    label="Type"
                    options={[
                      { label: "Fixed amount ($)", value: "fixed" },
                      { label: "Percentage (%)", value: "percent" },
                    ]}
                    value={t.type}
                    onChange={(v) =>
                      updateRedeem(i, { type: v as "fixed" | "percent" })
                    }
                  />
                  <Box paddingBlockStart="600">
                    <Button
                      tone="critical"
                      variant="tertiary"
                      onClick={() =>
                        setRedeem((r) => r.filter((_, j) => j !== i))
                      }
                    >
                      Remove
                    </Button>
                  </Box>
                </InlineGrid>
              </Box>
            ))}
          </BlockStack>
        </Card>

        {/* VIP + referrals (Pro) */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h3" variant="headingMd">
                VIP tiers &amp; referrals
              </Text>
              <Button
                disabled={!hasPro}
                onClick={() =>
                  setVip((r) => [...r, { name: "Silver", threshold: 1000, multiplier: 2 }])
                }
              >
                Add VIP tier
              </Button>
            </InlineStack>
            <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
              <TextField
                label="Referral reward (points to both sides, 0 = off)"
                type="number"
                autoComplete="off"
                value={referralReward}
                onChange={setReferral}
                min={0}
                disabled={!hasPro}
              />
              <TextField
                label="Friend's discount ($ off their first order)"
                type="number"
                autoComplete="off"
                value={friendDiscount}
                onChange={setFriendDiscount}
                min={0}
                disabled={!hasPro}
                helpText="Both must be set for referrals to run."
              />
            </InlineGrid>
            {vipTiers.map((t, i) => (
              <Box key={i}>
                <InlineGrid columns={{ xs: 1, sm: 4 }} gap="300">
                  <TextField
                    label="Tier name"
                    autoComplete="off"
                    value={t.name}
                    onChange={(v) => updateVip(i, { name: v })}
                    disabled={!hasPro}
                  />
                  <TextField
                    label="Unlock at (lifetime points)"
                    type="number"
                    autoComplete="off"
                    value={String(t.threshold)}
                    onChange={(v) => updateVip(i, { threshold: Number(v) || 0 })}
                    min={0}
                    disabled={!hasPro}
                  />
                  <TextField
                    label="Earn multiplier"
                    type="number"
                    autoComplete="off"
                    value={String(t.multiplier)}
                    onChange={(v) => updateVip(i, { multiplier: Number(v) || 1 })}
                    min={1}
                    disabled={!hasPro}
                  />
                  <Box paddingBlockStart="600">
                    <Button
                      tone="critical"
                      variant="tertiary"
                      disabled={!hasPro}
                      onClick={() => setVip((r) => r.filter((_, j) => j !== i))}
                    >
                      Remove
                    </Button>
                  </Box>
                </InlineGrid>
              </Box>
            ))}
            <Divider />
            <Checkbox
              label="Email customers their redemption codes"
              checked={emailNotifications}
              onChange={setEmailNotif}
              disabled={!hasPro}
              helpText={
                hasPro
                  ? "Sends the reward code to the customer so it's never lost."
                  : "Pro"
              }
            />
            <TextField
              label="Klaviyo private API key (integration)"
              autoComplete="off"
              value={klaviyoApiKey}
              onChange={setKlaviyo}
              disabled={!hasPro}
              helpText={
                hasPro
                  ? "Syncs points-earned, reward-redeemed & referral events + a loyalty_points profile property to Klaviyo for retention flows. Paste a private key (pk_…)."
                  : "Pro"
              }
            />
            <Checkbox
              label="Remove &ldquo;Powered by Loyara&rdquo; from the widget"
              checked={brandingRemoved}
              onChange={setBranding}
              disabled={!hasPro}
              helpText={hasPro ? undefined : "Pro"}
            />
          </BlockStack>
        </Card>

      </BlockStack>
    </Page>
  );
}
