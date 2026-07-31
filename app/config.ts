// ── THE ONE PLACE BRAND/DOMAIN STRINGS LIVE ──────────────────────────────────
// Import these constants everywhere instead of hard-coding brand text, so a new
// app is a config edit, not a grep. (Loyara is the first NON-compliance factory
// app: no regulation/deadline strings — the domain is loyalty/points/rewards.)

/** Short brand, e.g. "Loyara". Used in UI titles, email "from", copy. */
export const BRAND = "Loyara";

/** Full App Store listing name. */
export const APP_NAME = "Loyara: Loyalty & Rewards";

/** Production domain (no scheme). */
export const DOMAIN = "loyara.velihantoptas.com";

/** App Store handle (the apps.shopify.com/<handle> slug). */
export const APP_STORE_HANDLE = "loyara";

/** Support / contact email. */
export const SUPPORT_EMAIL = "velihan.dev@gmail.com";

/** One-line positioning, used in the landing hero + email footer. */
export const TAGLINE =
  "Loyalty points & rewards. One flat price, unlimited orders.";

// Derived — do not edit.
export const APP_STORE_URL = `https://apps.shopify.com/${APP_STORE_HANDLE}`;
export const ORIGIN = `https://${DOMAIN}`;
export const CANONICAL = `${ORIGIN}/`;
