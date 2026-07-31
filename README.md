# Compliance-app golden template

A clean, buildable Remix + `@shopify/shopify-app-remix` + Polaris + Prisma base
for the serial **compliance-app factory**. It contains the ~60–70% of every app
that is identical — Dockerfile, billing guard, GDPR webhooks, hash-chained audit
engine, monthly-cert cron, SEO landing, embedded dashboard with TIER-4
onboarding — with every playbook trap **pre-fixed**. The only per-app work is the
regulation logic behind `app/regulation/` (the swap point) plus filling the
brand tokens.

Distilled from two shipped apps: **Packify** (PPWR/EPR, back-office) and
**Aclara** (AI Act, theme extension + verify-live). See
`../../SHOPIFY-APP-PLAYBOOK.md` and `../AUTOMATION-PLAN.md`.

## New app in 6 steps

1. **Clone** this folder to `shopify-apps/<new-app>/`.
2. **Fill tokens.** Copy `factory.config.example.json` → `factory.config.json`,
   fill it, then find/replace every `__TOKEN__` in the repo. They live in
   `app/config.ts` (the one place brand/domain/regulation strings are defined),
   `shopify.app.toml`, and `.env.example`. Set `__SCOPES__` per preset below.
3. **Swap the regulation.** Edit `app/regulation/*` (see
   `app/regulation/README.md`) and the Prisma **REGULATION ZONE** in
   `prisma/schema.prisma`. Get the legal model adversarially reviewed — it's the
   one thing that must be right.
4. **Migrate.** `npm install` then `npx prisma migrate dev --name <regulation>`
   (regenerates the migration for your domain tables; delete the placeholder
   `prisma/migrations/0000000000000_init` first if you changed the base schema).
5. **Link + run.** `shopify app config link`, then `shopify app dev`.
6. **Deploy.** Coolify (Docker, `/data` volume, envs incl. `SHOPIFY_API_KEY`,
   Let's Encrypt, monthly cron) + `shopify app deploy`. See the playbook §3.

## The two capability presets

| | back-office (default) | storefront-widget |
| --- | --- | --- |
| Example | Packify (PPWR/EPR) | Aclara (AI Act) |
| Scope | `read_products` | `read_themes` |
| Data webhook | `products/update` | `themes/update` |
| Theme extension | none | yes (`presets/storefront-widget-extension/`) |
| `scan.server.ts` reads | product catalog | live theme, verify blocks are live |
| Uses `theme-config.server.ts` | no | **yes** (JSONC parser) |

This template ships wired for **back-office** so `tsc`/`build` pass out of the
box. To switch to storefront-widget, follow
`presets/storefront-widget-extension/README.md`.

## Pre-fixed traps (from the playbook)

- **Dockerfile** `npm ci --include=dev` (prod build needs vite/@remix-run/dev);
  `docker-start` runs `prisma migrate deploy` then serves, with `stderr→stdout`
  so Coolify's log tail shows boot errors.
- **Billing guard** `BILLING_TEST==="1" || NODE_ENV==="development"` — a prod
  deploy that loses `NODE_ENV` bills for real, never TEST-for-free. Prod
  env fail-fast in `shopify.server.ts`. `hasProPlan` swallows billing errors.
- **API version** `2026-07` (`ApiVersion.July26`).
- **Prisma** `env("DATABASE_URL")`, SQLite `connection_limit=1` + WAL +
  `busy_timeout`; persistent `/data` volume in prod.
- **All GDPR webhooks** return 200; `shop/redact` guards the reinstall race.
- **Hash-chained audit** genesis sentinel + `@@unique([shop, prevHash])` so the
  chain can't fork; `verifyChain()` re-proves it.
- **`healthz`** resource route (DB open + `SHOPIFY_API_KEY` present) for probes.
- **`check-env.mjs`** fail-fast validator (loud on `BILLING_TEST=1` in prod).
- **SEO landing** with FAQPage + SoftwareApplication JSON-LD + `sitemap.xml`.

## File tree

```
compliance-app-template/
├── README.md · factory.config.example.json · APP-SPEC.example.yaml
├── Dockerfile · package.json · tsconfig.json · vite.config.ts · .graphqlrc.ts
├── shopify.app.toml (tokenized) · shopify.web.toml
├── .env.example · .npmrc · .dockerignore · .gitignore · env.d.ts
├── scripts/check-env.mjs                 # fail-fast env validator
├── prisma/
│   ├── schema.prisma                     # Session + ShopConfig + VerifyLog + REGULATION ZONE
│   └── migrations/0000000000000_init/    # placeholder — regenerate per app
├── presets/storefront-widget-extension/  # REFERENCE ONLY (not built)
└── app/
    ├── config.ts                         # ← the one place tokens live
    ├── db.server.ts · shopify.server.ts · entry.server.tsx · root.tsx · routes.ts
    ├── lib/core/                         # SHARED — reuse, don't touch
    │   ├── audit.server.ts               # trackScan<Scoring> hash-chain + verifyChain
    │   ├── email.server.ts               # Resend
    │   ├── cron.ts                       # runMonthlyReport(...)
    │   ├── review.ts                     # once-only reviews.request()
    │   └── theme-config.server.ts        # JSONC settings_data.json parser (widget preset)
    ├── regulation/                       # ← THE SWAP POINT (see its README)
    │   ├── index.ts · config.ts · scoring.ts · scan.server.ts
    │   ├── monitor.server.ts · purge.server.ts · README.md
    └── routes/
        ├── _index/ (SEO landing) · privacy.tsx · sitemap[.]xml.tsx · healthz.tsx
        ├── app.tsx · app._index.tsx (dashboard) · app.record.tsx · app.upgrade.tsx
        ├── auth.$.tsx · auth.login/
        ├── cron.monthly-report.tsx
        └── webhooks.*  (uninstalled, scopes_update, app_subscriptions.update,
                         customers.data_request, customers.redact, shop.redact,
                         regulation-data.update)
```

## Verify it builds

```
npm install
npm run typecheck   # tsc --noEmit
npm run build       # remix vite:build
```
