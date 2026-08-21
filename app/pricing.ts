// PRICING: THE one place to change Loyara price. Billing (shopify.server) and
// the UI derive from this — a price change is a single edit here. Client-safe.
export const PRICING = { monthly: 9, annual: 54, trialDays: 14 };
const annualPerMo = PRICING.annual / 12;
export const MONTHS_FREE = 12 - PRICING.annual / PRICING.monthly;
export const PRICE_MONTHLY = `$${PRICING.monthly}`;
export const PRICE_ANNUAL = `$${PRICING.annual}`;
export const PRICE_ANNUAL_PER_MO = `$${Number.isInteger(annualPerMo) ? annualPerMo : annualPerMo.toFixed(2)}`;
export const ANNUAL_BADGE = `Best value · ${MONTHS_FREE} months free`;
