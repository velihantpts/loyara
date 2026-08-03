import type { MetaFunction } from "@remix-run/node";
import { BRAND, SUPPORT_EMAIL } from "../config";

export const meta: MetaFunction = () => [
  { title: `Data Processing Addendum · ${BRAND}` },
];

export default function Dpa() {
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
      <h1>Data Processing Addendum</h1>
      <p>
        <em>{BRAND} for Shopify</em>
      </p>
      <p>
        This Addendum governs the processing of personal data by {BRAND} (the
        &ldquo;Processor&rdquo;) on behalf of the merchant (the
        &ldquo;Controller&rdquo;) when the merchant installs and uses {BRAND} on
        their Shopify store. Merchants accept it by installing the app.
      </p>

      <h2>1. Roles</h2>
      <p>
        The merchant is the data controller of their customers&rsquo; personal
        data. {BRAND} is a data processor acting only on the merchant&rsquo;s
        documented instructions, providing the loyalty program&rsquo;s
        functionality.
      </p>

      <h2>2. Scope of processing</h2>
      <p>
        {BRAND} processes only the data needed to run the loyalty program: the
        customer identifier, email, loyalty points balance and history, and, if
        the customer provides it, their birthday. It does not process customer
        names, phone numbers, addresses, or payment data.
      </p>

      <h2>3. Purpose limitation</h2>
      <p>
        Personal data is used solely to operate the loyalty program. It is never
        sold, rented, or used for the app&rsquo;s own marketing, advertising, or
        profiling.
      </p>

      <h2>4. Sub-processors</h2>
      <p>
        Shopify (platform &amp; billing), our hosting provider (application
        hosting), and Resend (transactional email delivery, only when the merchant
        enables email notifications). Each processes data only to provide their
        service.
      </p>

      <h2>5. Security</h2>
      <p>
        Encryption in transit (TLS) and at rest, encrypted offsite backups, access
        control (2FA, SSH keys, least privilege), environment separation, and a
        documented incident response policy.
      </p>

      <h2>6. Data subject rights &amp; Shopify GDPR webhooks</h2>
      <p>
        {BRAND} honors Shopify&rsquo;s mandatory privacy webhooks:{" "}
        <code>customers/data_request</code>, <code>customers/redact</code>, and{" "}
        <code>shop/redact</code>, and deletes all shop data on uninstall.
      </p>

      <h2>7. Retention</h2>
      <p>
        Personal data is retained only while the app is installed and the program
        is active, and is deleted on uninstall or a redact request.
      </p>

      <h2>8. Breach notification</h2>
      <p>
        We will notify the merchant without undue delay (and within any legally
        required window, e.g. 72 hours under GDPR) upon becoming aware of a
        personal-data breach affecting their customers.
      </p>

      <h2>Contact</h2>
      <p>
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      </p>
      <p style={{ fontSize: 13, color: "#777" }}>
        This Addendum supplements the {BRAND} Privacy Policy. It is not legal
        advice.
      </p>
    </main>
  );
}
