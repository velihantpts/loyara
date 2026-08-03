import type { MetaFunction } from "@remix-run/node";
import { BRAND, SUPPORT_EMAIL } from "../config";

export const meta: MetaFunction = () => [{ title: `Privacy Policy · ${BRAND}` }];

export default function Privacy() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: "40px auto",
        padding: "0 20px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        lineHeight: 1.6,
        color: "#1a1a1a",
      }}
    >
      <h1>Privacy Policy</h1>
      <p>
        <em>{BRAND} for Shopify</em>
      </p>

      <h2>What we access</h2>
      <p>
        To run your loyalty program the app reads: your store domain, your orders
        (to award and clawback points), your customers (to attribute points and
        grant signup bonuses), and your app subscription status. It creates
        discount codes to deliver redemptions. It requests these Shopify
        permissions: <code>read_orders</code>, <code>read_customers</code>,{" "}
        <code>write_discounts</code>.
      </p>

      <h2>What we store</h2>
      <p>
        We store your program settings, and for each participating customer: their
        Shopify customer ID, email, points balance and a ledger of points earned,
        redeemed and adjusted. We store this to operate the loyalty program you
        installed the app to run. We do not use it for any other purpose.
      </p>

      <h2>Data deletion</h2>
      <p>
        When you uninstall the app, or on a Shopify <code>shop/redact</code>{" "}
        request, we delete all data we hold for your store. On a{" "}
        <code>customers/redact</code> request we delete that customer&rsquo;s
        points balance and ledger. We honour <code>customers/data_request</code>{" "}
        by making the data we hold for that customer available to you.
      </p>

      <h2>Third parties</h2>
      <p>
        We do not sell or share your data. Billing is handled by Shopify. The
        optional monthly program summary is sent via Resend (email delivery). We
        use no third-party analytics or trackers.
      </p>

      <h2>Data Processing Addendum</h2>
      <p>
        Our <a href="/dpa">Data Processing Addendum</a> sets out the
        controller/processor terms for merchant customer data.
      </p>

      <h2>Contact</h2>
      <p>
        Questions: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      </p>
    </main>
  );
}
