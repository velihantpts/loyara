import { useState } from "react";
import type { MetaFunction } from "@remix-run/node";
import { BRAND, APP_STORE_URL, CANONICAL } from "../config";

const TITLE = "Smile.io Pricing Calculator: what you'll actually pay at your order volume";
const DESC =
  "Estimate your real Smile.io annual cost (tier + overage fees) at your monthly order volume, and compare it to a flat $19/mo loyalty program with unlimited orders.";
const URL = `${CANONICAL}smile-tax-calculator`;

export const meta: MetaFunction = () => [
  { title: TITLE },
  { name: "description", content: DESC },
  { property: "og:title", content: TITLE },
  { property: "og:description", content: DESC },
  { property: "og:type", content: "website" },
  { property: "og:url", content: URL },
  { tagName: "link", rel: "canonical", href: URL },
];

// Estimated Smile.io monthly cost from published 2026 tiers (Free <200 orders,
// Standard $79, Growth $199 to 2,500, then ~$5/100 overage). Directional — a
// merchant's exact bill depends on their plan; the point is the tier cliffs.
function smileMonthly(orders: number): number {
  if (orders <= 200) return 0;
  if (orders <= 1000) return 79;
  if (orders <= 2500) return 199;
  return 199 + Math.ceil((orders - 2500) / 100) * 5;
}
const LOYARA_MONTHLY = 19;

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export default function SmileTaxCalculator() {
  const [orders, setOrders] = useState(1200);
  const smileYr = smileMonthly(orders) * 12;
  const loyaraYr = LOYARA_MONTHLY * 12;
  const saveYr = Math.max(0, smileYr - loyaraYr);

  const wrap: React.CSSProperties = {
    maxWidth: 760, margin: "40px auto", padding: "0 20px",
    fontFamily: "system-ui, -apple-system, sans-serif", lineHeight: 1.6, color: "#1a1a1a",
  };
  const card: React.CSSProperties = {
    border: "1px solid #e3e3e3", borderRadius: 14, padding: 24, margin: "24px 0",
    boxShadow: "0 4px 20px rgba(0,0,0,.05)",
  };

  return (
    <main style={wrap}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: [
              { "@type": "Question", name: "How much does Smile.io cost per month?", acceptedAnswer: { "@type": "Answer", text: "Smile.io is free up to 200 orders/month, then jumps to $79/mo (Standard) and $199/mo (Growth, to 2,500 orders), with per-order overage fees above that, so your bill rises as your store grows." } },
              { "@type": "Question", name: "Is there a flat-price loyalty app?", acceptedAnswer: { "@type": "Answer", text: `${BRAND} is a flat ${money(LOYARA_MONTHLY)}/month with unlimited orders and no overage fees, including VIP tiers, referrals and CSV migration.` } },
            ],
          }),
        }}
      />

      <h1>Smile.io Pricing Calculator</h1>
      <p style={{ color: "#555" }}>
        Smile.io bills by your monthly order count, so your loyalty bill climbs as your store
        grows: free up to 200 orders, then $79, then $199, plus per-order overage fees. Move
        the slider to estimate your real annual cost, and see it against a flat {money(LOYARA_MONTHLY)}/month.
      </p>

      <div style={card}>
        <label style={{ fontWeight: 600 }}>
          Your orders per month: <span style={{ color: "#008060" }}>{orders.toLocaleString()}</span>
        </label>
        <input
          type="range" min={0} max={5000} step={50} value={orders}
          onChange={(e) => setOrders(Number(e.target.value))}
          style={{ width: "100%", marginTop: 12 }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#888" }}>
          <span>0</span><span>2,500</span><span>5,000+</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 24 }}>
          <div style={{ background: "#fbfbfb", borderRadius: 10, padding: 16, textAlign: "center" }}>
            <div style={{ fontSize: 13, color: "#888" }}>Smile.io, estimated / year</div>
            <div style={{ fontSize: 30, fontWeight: 700 }}>{money(smileYr)}</div>
            <div style={{ fontSize: 12, color: "#888" }}>{money(smileMonthly(orders))}/mo</div>
          </div>
          <div style={{ background: "#f0f8f4", borderRadius: 10, padding: 16, textAlign: "center" }}>
            <div style={{ fontSize: 13, color: "#008060" }}>{BRAND}, flat / year</div>
            <div style={{ fontSize: 30, fontWeight: 700 }}>{money(loyaraYr)}</div>
            <div style={{ fontSize: 12, color: "#008060" }}>{money(LOYARA_MONTHLY)}/mo, unlimited orders</div>
          </div>
        </div>

        <div style={{ textAlign: "center", marginTop: 20 }}>
          <div style={{ fontSize: 15, color: "#555" }}>You'd save</div>
          <div style={{ fontSize: 40, fontWeight: 800, color: "#008060" }}>{money(saveYr)}<span style={{ fontSize: 18, color: "#888" }}> / year</span></div>
        </div>
      </div>

      <div style={{ textAlign: "center" }}>
        <a href={APP_STORE_URL} style={{ display: "inline-block", padding: "12px 24px", background: "#1a1a1a", color: "#fff", borderRadius: 10, textDecoration: "none", fontWeight: 600 }}>
          Switch to {BRAND}: flat {money(LOYARA_MONTHLY)}/mo
        </a>
        <p style={{ fontSize: 13, color: "#888", marginTop: 10 }}>
          Free CSV migration; your customers keep every point. Free plan up to 200 orders/mo; 14-day Pro trial.
        </p>
      </div>

      <p style={{ fontSize: 12, color: "#999", marginTop: 32 }}>
        Estimates are based on Smile.io's publicly listed pricing tiers and are for comparison only;
        your exact Smile.io bill depends on your current plan and usage. {BRAND} is not affiliated with Smile.io.
      </p>
    </main>
  );
}
