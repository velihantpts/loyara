// Loyalty surface barrel. Re-exports ONLY client-safe modules (pure config/types).
// Server-only modules keep their `.server` suffix and are imported DIRECTLY by
// routes (loaders/actions), never through this barrel — a barrel that re-exported
// a `.server` module would defeat Remix's client-bundle stripping:
//   import { earnFromOrder } from "../loyalty/earn.server";
//   import { clawbackRefund, clawbackCancel } from "../loyalty/clawback.server";
//   import { redeem } from "../loyalty/redeem.server";
//   import { applyEntry } from "../loyalty/points.server";
//   import { purgeShop, purgeCustomer } from "../loyalty/purge.server";
//   import { displayBalance } from "../loyalty/balance.server";

export {
  DEFAULT_REDEEM_TIERS,
  DEFAULT_VIP_TIERS,
  ONBOARDING_STEPS,
  parseRedeemTiers,
  parseVipTiers,
  computeVipTier,
  vipMultiplier,
  type RedeemTier,
  type VipTier,
  type OnboardingStep,
} from "./config";
