// Loyalty program config — CLIENT-SAFE (pure types + helpers, no server imports).
// ShopConfig stores tier arrays as JSON strings; these helpers parse/serialize and
// compute derived values. Imported by both admin routes and server modules.

/** A redemption tier: spend `points` to get a discount of `value` (fixed $ or %). */
export interface RedeemTier {
  points: number;
  value: number;
  type: "fixed" | "percent";
}

/** A VIP tier unlocked at `threshold` lifetime points; `multiplier` boosts earn. */
export interface VipTier {
  name: string;
  threshold: number; // lifetimeEarned needed to reach this tier
  multiplier: number; // earn multiplier while in this tier (1 = none)
}

/** Sensible defaults so the program works the instant it's installed. */
export const DEFAULT_REDEEM_TIERS: RedeemTier[] = [
  { points: 500, value: 5, type: "fixed" },
  { points: 1000, value: 10, type: "fixed" },
  { points: 2000, value: 25, type: "fixed" },
];

export const DEFAULT_VIP_TIERS: VipTier[] = [];

// ── JSON (de)serialization — never throw on bad data, fall back to []. ────────

export function parseRedeemTiers(json: string | null | undefined): RedeemTier[] {
  const arr = safeParseArray(json);
  return arr
    .filter(
      (t): t is RedeemTier =>
        typeof t?.points === "number" &&
        typeof t?.value === "number" &&
        (t?.type === "fixed" || t?.type === "percent"),
    )
    .sort((a, b) => a.points - b.points);
}

export function parseVipTiers(json: string | null | undefined): VipTier[] {
  const arr = safeParseArray(json);
  return arr
    .filter(
      (t): t is VipTier =>
        typeof t?.name === "string" &&
        typeof t?.threshold === "number" &&
        typeof t?.multiplier === "number",
    )
    .sort((a, b) => a.threshold - b.threshold);
}

function safeParseArray(json: string | null | undefined): any[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** The VIP tier a member with `lifetimeEarned` points currently sits in (or null). */
export function computeVipTier(
  lifetimeEarned: number,
  tiers: VipTier[],
): VipTier | null {
  let current: VipTier | null = null;
  for (const t of tiers) {
    if (lifetimeEarned >= t.threshold) current = t;
    else break; // tiers are sorted ascending
  }
  return current;
}

/** Earn multiplier for a member at a given lifetime level (1 if no VIP tier). */
export function vipMultiplier(lifetimeEarned: number, tiers: VipTier[]): number {
  const t = computeVipTier(lifetimeEarned, tiers);
  return t ? t.multiplier : 1;
}

/** Admin onboarding checklist steps. */
export interface OnboardingStep {
  key: string;
  label: string;
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  { key: "earn", label: "Set your points earn rate" },
  { key: "rewards", label: "Configure redemption rewards" },
  { key: "widget", label: "Add the Loyara widget to your theme" },
  { key: "migrate", label: "Import existing points (optional)" },
];
