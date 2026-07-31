import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { displayBalance } from "../loyalty/balance.server";
import { parseRedeemTiers, parseVipTiers, computeVipTier } from "../loyalty/config";

// App Proxy: GET /apps/loyalty/state → /proxy/state
// The storefront widget's authoritative read: balance, earn rules, VIP progress,
// next-reward progress, referral availability. Signed by authenticate.public.appProxy.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) return json({ ok: false }, { status: 401 });
  const shop = session.shop;

  const url = new URL(request.url);
  const customerId = url.searchParams.get("logged_in_customer_id");

  const config = await prisma.shopConfig.findUnique({ where: { shop } });
  const tiers = parseRedeemTiers(config?.redeemTiers);
  const vipTiers = parseVipTiers(config?.vipTiers);
  // Branding removal is Pro-only — free (or downgraded) shops always show it.
  const branded = !((config?.brandingRemoved ?? false) && (config?.isPro ?? false));
  const active = config?.programActive ?? false;
  const currency = config?.currency ?? "USD";
  const referralEnabled =
    (config?.referralReward ?? 0) > 0 && (config?.referralFriendDiscount ?? 0) > 0;

  const earn = {
    pointsPerDollar: config?.pointsPerDollar ?? 0,
    signupBonus: config?.signupBonus ?? 0,
    birthdayBonus: config?.birthdayBonus ?? 0,
    referralReward: config?.referralReward ?? 0,
  };
  const publicTiers = tiers.map((t) => ({ points: t.points, value: t.value, type: t.type }));

  if (!customerId) {
    return json({
      ok: true,
      loggedIn: false,
      active,
      branded,
      currency,
      earn,
      tiers: publicTiers,
      referralEnabled,
    });
  }

  const customerGid = `gid://shopify/Customer/${customerId}`;
  const customer = await prisma.customer.findUnique({
    where: { shop_shopifyGid: { shop, shopifyGid: customerGid } },
    select: { balance: true, lifetimeEarned: true, birthday: true },
  });
  const balance = displayBalance(customer?.balance ?? 0);
  const lifetime = customer?.lifetimeEarned ?? 0;

  // VIP: current tier + progress to the next.
  const current = computeVipTier(lifetime, vipTiers);
  const next = vipTiers.find((t) => t.threshold > lifetime) ?? null;
  const vip = {
    current: current?.name ?? null,
    next: next ? { name: next.name, threshold: next.threshold } : null,
    toNext: next ? Math.max(0, next.threshold - lifetime) : 0,
  };

  // Next reward the member can't quite afford yet (cheapest unaffordable tier).
  const nextTier = publicTiers.find((t) => t.points > balance) ?? null;
  const nextReward = nextTier
    ? { points: nextTier.points, remaining: nextTier.points - balance }
    : null;

  return json({
    ok: true,
    loggedIn: true,
    active,
    branded,
    currency,
    earn,
    balance,
    tiers: publicTiers,
    vip,
    nextReward,
    referralEnabled,
    birthdayKnown: Boolean(customer?.birthday),
  });
};
