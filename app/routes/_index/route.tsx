import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";

import { login } from "../../shopify.server";
import { APP_NAME, APP_STORE_URL, BRAND, CANONICAL } from "../../config";

import styles from "./styles.module.css";

// SEO landing — targets the winnable SERPs: "smile.io alternative", "shopify
// loyalty flat pricing", "loyalty app no order limits". Keep the shape:
// title/meta/canonical/OG + FAQPage & SoftwareApplication JSON-LD + Install CTA +
// the shop-domain login form (all SEO-load-bearing).

const TITLE = `${BRAND} — flat-price Shopify loyalty & rewards (Smile.io alternative)`;
const DESC = `A loyalty program for one flat monthly price — unlimited orders, no overage fees. Points, VIP tiers & referrals, plus 5-minute CSV migration from Smile, Rivo & BON.`;

export const meta: MetaFunction = () => [
  { title: TITLE },
  { name: "description", content: DESC },
  { property: "og:title", content: TITLE },
  { property: "og:description", content: DESC },
  { property: "og:type", content: "website" },
  { property: "og:url", content: CANONICAL },
  { tagName: "link", rel: "canonical", href: CANONICAL },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "How is Loyara different from Smile.io or Yotpo?",
    a: "Loyara is one flat monthly price with unlimited orders and no overage fees. Smile and Yotpo charge by monthly order count, so your bill jumps as you grow — Smile from $79 to $199+ and Yotpo from $199 with per-order fees on top. With Loyara your price never changes.",
  },
  {
    q: "Can I switch from my current loyalty app without losing points?",
    a: "Yes. Export your members (email + points balance) from Smile, Rivo, BON or Yotpo, paste the CSV into Loyara, and every balance moves with you. Nobody loses a point, and re-running the import is safe.",
  },
  {
    q: "What's included?",
    a: "Points earning and redemption, VIP tiers, a referral program, birthday bonuses, points expiry, a storefront widget, and CSV migration — all on one plan. No feature gating behind higher tiers.",
  },
  {
    q: "How much does it cost?",
    a: "A free plan covers up to 200 orders/month. Pro is $19/month flat (or $190/year) for unlimited orders and every feature, with a 14-day free trial.",
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "FAQPage",
        mainEntity: FAQ.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
      {
        "@type": "SoftwareApplication",
        name: APP_NAME,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Shopify",
        url: APP_STORE_URL,
        description: DESC,
        offers: {
          "@type": "Offer",
          price: "19",
          priceCurrency: "USD",
        },
      },
    ],
  };

  return (
    <div className={styles.index}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className={styles.content}>
        <header className={styles.hero}>
          <h1 className={styles.heading}>
            Shopify loyalty &amp; rewards — one flat price, unlimited orders
          </h1>
          <p className={styles.text}>
            {BRAND} gives your store points, VIP tiers and referrals for one flat
            monthly price. No order-count tiers, no overage fees — your growth is
            never your loyalty app&rsquo;s payday. The simple, honest{" "}
            <strong>Smile.io alternative</strong>.
          </p>
          <div className={styles.ctaRow}>
            <a className={styles.cta} href={APP_STORE_URL}>
              Add {BRAND} on the Shopify App Store
            </a>
          </div>
          <p className={styles.text}>
            Paying too much for Smile.io?{" "}
            <a href="/smile-tax-calculator">
              See how much you&rsquo;d save at your order volume →
            </a>
          </p>
        </header>

        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Already installed? Log in with your shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}

        <section className={styles.section}>
          <h2 className={styles.h2}>Why merchants switch to {BRAND}</h2>
          <ul className={styles.bullets}>
            <li>
              <strong>Flat price, unlimited orders.</strong> One monthly fee that
              never changes — no per-order fees, no tier cliffs at 500 or 2,500
              orders.
            </li>
            <li>
              <strong>Every feature included.</strong> VIP tiers, referrals,
              birthday bonuses and branding removal aren&rsquo;t locked behind a
              $199 plan.
            </li>
            <li>
              <strong>5-minute migration.</strong> Bring your members&rsquo; point
              balances from Smile, Rivo, BON or Yotpo with a CSV import.
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>How {BRAND} works</h2>
          <p className={styles.text}>
            Customers earn points on every purchase and redeem them for discounts
            from a storefront widget. Set your earn rate and rewards in minutes,
            add the widget to your theme, and optionally import your existing
            program. Free for up to 200 orders/month; $19/month flat for
            unlimited.
          </p>
          <div className={styles.ctaRow}>
            <a className={styles.cta} href={APP_STORE_URL}>
              Get {BRAND} on the Shopify App Store
            </a>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>Frequently asked questions</h2>
          <dl className={styles.faq}>
            {FAQ.map((f) => (
              <div key={f.q} className={styles.faqItem}>
                <dt className={styles.faqQ}>{f.q}</dt>
                <dd className={styles.faqA}>{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}
