# Loyara — Growth & Roadmap Strategy

> Synthesis of a 3-agent review (feature / performance / content-growth) vs Smile, Rivo, BON,
> Yotpo, Appstle. Grounded in incumbent pricing gates + 1–3★ review complaints + new Shopify
> surfaces. 2026-07-31. **The one cross-cutting truth: distribution + reviews + the BFS badge
> beat features right now. "More features before 10 reviews is comfortable procrastination."**

## Priority order (do it in THIS sequence)

### Phase 0 — Distribution unlock (weeks 1–6, do FIRST, before any feature)
1. **Reviews cold-start via UNCONDITIONAL free white-glove migration.** NOT "review for migration"
   (Shopify prohibits incentivized reviews — delisting/termination risk). Offer the migration free as
   onboarding; after a successful, appreciated migration, ask ONCE for an honest review (the sanctioned
   post-support pattern). 10 hand-migrations → ~5–8 honest reviews in 4–6 weeks. This unlocks everything —
   a 0-review app loses even when it wins the click.
2. **ASO pass (S).** Name `Loyara Loyalty & Rewards` (30). Subtitle `Points, referrals & VIP tiers. Flat price, unlimited orders` (62). First 100 chars of description repeat loyalty/rewards/points/referral. First screenshot = a `$19 flat. No order limits.` frame (listing conversion is a ranking factor). ⚠️ Listing may NOT reference competitors — all "Smile alternative" targeting lives on loyara.velihantoptas.com, never the App Store listing.
3. **Smile Tax Calculator (S–M)** — interactive, on our domain: orders/mo slider → Smile's real annual cost (tier + $20/100 overage + retroactive bumps) vs $228/yr Loyara → "you'd save $X,XXX/yr". Landing-page HERO + outreach attachment. Softest SERP ("smile.io pricing" adjacency), earns links from the alternatives listicles that outrank us.
4. **Outreach (M, the quick win).** Mine Smile's 1–3★ App Store reviews (store name → website → email) + Shopify Community threads ("does Smile count unrewarded orders?") + r/shopify. 5 emails/day, ~80 words, lead with their order-limit pain + free personal migration + "if it's not a fit I'll tell you which competitor is." No review ask in msg 1.

### Phase 1 — Purchase-rejection removers (weeks 3–8, parallel with Phase 0)
5. **Klaviyo integration (S–M) — do first of the features.** Push `points_earned/redeemed/tier_changed/expiring_soon/referral_completed` events + balance/tier profile props (merchant pastes a private key). NOT why they install — why they don't REJECT Loyara during evaluation. Table-stakes; highest leverage-per-hour.
6. **BFS technical readiness (M–L) → badge at 50 installs + 5 reviews.** The single biggest install lever (~49% lift within 14 days + search-rank preference). Loyara's storefront perf makes the hardest criterion FREE. Do now: verify App Bridge from Shopify CDN (not npm-pinned), admin CWV (reserve skeleton space to kill CLS in app._index, add member-list indexes), Polaris contextual save bar on settings. Then it's a form-fill when installs arrive.

### Phase 2 — The wedge features (weeks 6–12, after reviews are flowing)
7. **WEDGE: Points → native Store Credit (M).** Redeem points as real Shopify store credit
   (`storeCreditAccountCredit`) — appears in new customer accounts + as a checkout payment option, no code
   to copy. Kills Smile's #1 complaint ("customers can't figure out how to redeem"). ⚠️ Store credit is real
   money — ship with per-customer/day caps, referral velocity limits, auto-clawback on refund, or one abuse
   loop = 1★. Watch-item: Shopify may absorb basic cashback natively; keep the moat in points/tiers/referrals ON TOP.
8. **WEDGE: Redeem-at-checkout UI extension (M–L).** "You have 640 points — redeem $6?" one-tap in checkout
   + "you'll earn 128 points" AOV nudge. Checkout extensions are now on ALL plans (Scripts died 2026-06-30);
   ride the Aug-2026 extensibility news. Pair with #7 as one project. The single most demoable listing-video feature.
9. **WEDGE (messaging): Shopify Flow triggers/actions + ONE signed "adjust points" endpoint (M).** "The API
   Smile charges $1,000/mo for — included." Merchants build custom earn rules via Flow. ⚠️ Do NOT build a
   full public REST API — that's a documentation/support tarpit (why Smile prices it high).

### Phase 3 — Retention + completeness (later)
10. **Nudge emails (S)** — expiry warnings + "80 pts from your next reward" (email infra already exists; cap sends).
11. **Loyalty ROI analytics (M)** — members vs non-members repeat-rate/AOV, outstanding liability, monthly email.
    The anti-churn feature: "loyalty members spent 2.3× more" is why they don't cancel $19 during a cost cull.
12. **Review-for-points via Judge.me webhook (S).** POS (M) only after real support-inbox demand.

## Performance = a packaged wedge (cheap, do alongside Phase 0–1)
The widget is already inline, **0 network requests until opened, 0 CLS, <8KB** — genuinely rare here (Smile ~200KB, Yotpo worst-in-test). Package it:
- Minify inline JS at build + a CI byte-budget gate (S). Defer widget init to `requestIdleCallback` (S).
- Listing/landing: `Zero requests. Zero layout shift. Zero external scripts. <8KB.` + a WebPageTest filmstrip GIF vs Smile (highest-ROI marketing asset).
- **Speed Report** in-admin (M): call the free PageSpeed Insights API, show the merchant their CWV + Loyara's contribution (0 requests, 0 CLS). No incumbent dares — their report would incriminate them.
- **Speed guarantee** (S copy): "If Loyara ever drops your Lighthouse score >1 point, that month is free." Safe because the widget is static + CI-gated.
- Backend: webhook job-table backpressure (S/M) before scaling. SQLite ceiling — monitor triggers, don't migrate yet.

## Do NOT waste time on
Full public REST API · SMS (let Klaviyo do it) · built-in reviews/email suite (stay unbundled) · Apple Wallet · AI/agentic gimmicks (Shopify absorbs them) · paid ads pre-reviews · Product Hunt/HN · social broadcast · TOFU "what is loyalty" content · **more features before 10 reviews**.

## The three headline install reasons (comparison-table rows on the listing)
1. "Points your customers actually spend — as store credit, right in checkout. No codes, no popups." (#7+#8)
2. "Flow + webhooks included — the API Smile charges $1,000/mo for." (#9)
3. Flat $19 with everything Smile spreads across $79/$199/$999 (VIP, expiry, analytics, Klaviyo, Flow) — the comparison table + Smile Tax Calculator.
