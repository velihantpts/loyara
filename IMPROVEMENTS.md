# Loyara — review backlog (3-agent audit, 2026-07-30)

Source: parallel code-quality, performance, and category-best reviews. Engine correctness
verified by `scripts/engine-test.ts` (19/19). `tsc` + `npm run build` green.

## ✅ Fixed (2026-07-30, correctness/security hardening)
- Billing-API error no longer wipes Pro config on settings save — `checkProPlan` + DB isPro mirror fallback.
- Webhooks (orders/paid, refunds/create, orders/cancelled, customers/create) return **500 on transient error** so Shopify retries (idempotent ledger makes retry a no-op). Was: swallow + 200 = lost accrual.
- Redeem: idempotency key **bound to the requesting customer** (no cross-customer replay/leak); concurrent same-key race re-reads the winner instead of 500; stronger client key (crypto.getRandomValues); widget **reuses one key per redeem intent**.
- CSV migrate: **email quoted** in search query (injection fix); import uses `EARN_MANUAL` so **lifetimeEarned + VIP tier survive migration** ("nobody loses a point").
- Settings: **percent tier value capped at 100** (was silently breaking every redemption); toast moved to `useEffect` (was re-firing on every render).
- Dropped dead `mirrorBalance` + the unused `write_customers` scope (fewer scopes = less review friction; widget reads via App Proxy).
- Added covering `@@index([shop, reason, delta])` for dashboard aggregates.
- Onboarding: theme-editor **deep link** to activate the widget (activation is the key metric).

## ✅ TRUTH GAP — now functional (built 2026-07-30)
- [x] **Referral program** — `referral.server.ts`: get-or-create code + minted friend discount; attribution from order `discount_codes` on orders/paid; EARN_REFERRAL to both sides (idempotent, no self-referral). Proxy `/apps/loyalty/referral` + widget share UI. Tested.
- [x] **Birthday bonus** — `/cron/daily` grants; `Customer.birthday` captured via `/apps/loyalty/birthday` + widget month/day picker.
- [x] **Points expiry** — `daily.server.ts` inactivity-based expiry → EXPIRE entries. Tested (expires after N inactive days; recent survives).

## ✅ Category-best P1 — built 2026-07-30
- [x] Widget overhaul: ways-to-earn list, VIP status + progress, "N pts to next reward" bar, logged-out sell state, referral + birthday sections.
- [x] Redeem UX: `/discount/{code}` auto-apply link + Copy button; inline messages (no `alert()`).
- [x] Customer **redemption-code email** (Resend) gated by `emailNotifications` toggle. (reward-available + expiry-warning emails still TODO.)
- [x] Migration: proper CSV parser + header/column auto-detect (email/points/lifetime), batched GraphQL lookups (~40/call), lifetime import (keeps VIP), unmatched-emails list.
- [x] Widget a11y: Escape + outside-click close, close button/focus; currency-aware labels.

## 🟠 Still open (P1/P2)
- [ ] **Manual points adjust** + member detail page + email search (top support action; `ADJUST_MANUAL` ready). (S/M)
- [ ] reward-available + expiry-warning customer emails. (M)
- [ ] Schedule the **`/cron/daily`** job in Coolify (alongside `/cron/monthly-report`) at deploy.

## 🟡 Perf (mostly future-proofing; current scale fine)
- [ ] Thread `cfg`/customer through `applyEntry` to drop 2 redundant reads per webhook.
- [ ] Move clawback cap-read inside the `applyEntry` transaction (closes a rare concurrent over-claw window).
- [ ] Gate dashboard `setPro` write behind a value-diff check (avoid a write per page load).
- [ ] Reconciliation cron for stale PENDING redemptions (crash between debit and mint).

## 🟢 BFS / launch checklist
- [ ] **Protected Customer Data Access** approval in Partner dashboard (blocks dev preview + listing) — orders/customers scopes.
- [ ] Free-plan 200-orders/mo cap: enforce softly or reword the claim (currently unenforced).
- [ ] Contextual SaveBar on settings (BFS polish).
- [ ] Later: Shopify Flow triggers, Klaviyo events, POS, loyalty landing-page block, analytics time-series.
