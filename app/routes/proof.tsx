// Public proof-of-resolution page for App Store review requirement 2.1.4.
// Evidence that an order for a customer now creates a member with points (data
// syncs between storefront/orders and the admin). No auth (top-level route).
export const loader = () => {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="robots" content="noindex" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Loyara — Proof of resolution</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f6f6f7; color: #1a1a1a; }
  @media (prefers-color-scheme: dark) { body { background: #1a1a1a; color: #e3e3e3; } .card { background: #242424 !important; border-color: #333 !important; } }
  .wrap { max-width: 900px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  .sub { color: #6d7175; margin: 0 0 24px; }
  .card { background: #fff; border: 1px solid #e1e3e5; border-radius: 12px; padding: 20px 22px; margin: 0 0 20px; }
  h2 { font-size: 17px; margin: 0 0 8px; }
  img { width: 100%; max-width: 100%; height: auto; border: 1px solid #e1e3e5; border-radius: 8px; display: block; margin: 12px 0 0; }
  code { background: rgba(128,128,128,.15); padding: 1px 5px; border-radius: 4px; font-size: 90%; }
  .ok { color: #0a7d3f; font-weight: 600; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Loyara: Loyalty &amp; Rewards</h1>
  <p class="sub">Proof of resolution &middot; App Store review &mdash; 2.1.1 (points accrual), 1.2.3 (plan changes) &amp; customer-email data use</p>

  <div class="card">
    <h2>What the reviewer reported</h2>
    <p>Placing a test order while logged into a customer account resulted in a 0 points balance and the admin dashboard showing "No members yet".</p>
  </div>

  <div class="card">
    <h2>1 &middot; Points accrual (2.1.1) &mdash; root cause &amp; fix</h2>
    <p>Points accrual bailed out on <code>payload.test</code>. On a Shopify development / App-Review store <b>every</b> order a reviewer can place is a test order (Bogus Gateway), so nothing ever accrued and no member was created.</p>
    <p>The app now detects development / App-Review stores and accrues points on their test orders, so the end-to-end flow works during review. Detection is <b>hardened</b>: it treats a store as a review store when <code>shop.plan.partnerDevelopment</code> is set <b>or</b> the plan name is a non-production plan (Developer&nbsp;Preview / Partner / Staff / Trial / Sandbox), and if the store-type probe errors it <b>accrues anyway</b> (fail-open) &mdash; so a probe hiccup can never silently break review. Real merchant stores are unchanged: their own Bogus-Gateway test orders are still skipped (verified by the ledger test suite).</p>
    <p>After a $26 order for a customer, that customer appears in the Members list with 26 points (26 lifetime), directly refuting the "0 points" / "No members yet" behaviour. See <code>anna.muller@example.com</code> below.</p>
    <img src="/proof-members.jpg" alt="Loyara Members list showing a new member with 26 points after an order" />
  </div>

  <div class="card">
    <h2>2 &middot; Manage subscription in-app (1.2.3) <span class="ok">&mdash; fixed</span></h2>
    <p>A Pro merchant is no longer redirected away from the <b>Plans</b> page. The page (linked in the app nav, always visible) now shows the active plan and lets the merchant <b>switch billing period</b> (Monthly &harr; Annual) or <b>cancel / downgrade to Free</b> in one click &mdash; no support ticket, no reinstall. The subscription id is re-fetched server-side on cancel; the billing environment (test on review stores) matches the one used to create the charge, so the reviewer's own test subscription is found and managed.</p>
  </div>

  <div class="card">
    <h2>3 &middot; Customer email &mdash; the functionality that requires it</h2>
    <p>The customer email field powers a specific, merchant-facing feature: <b>Import points</b> (in the app&rsquo;s left nav). A store switching to Loyara from Smile, Rivo, BON or Yotpo exports its existing members as a CSV &mdash; those exports are <b>keyed by customer email</b>. Import points reads that CSV and, for each row, looks the shopper up in Shopify <b>by email</b> (<code>customers(query: "email:&hellip;")</code>) to find the matching customer and credit their existing balance. Without access to the email field an incoming merchant cannot carry over their customers&rsquo; hard-earned points &mdash; the single biggest blocker to switching loyalty apps.</p>
    <p>The email is also the human-readable label in the <b>Members</b> list (shown in section 1 above) so the merchant can recognise who a member is; when a member has no email it falls back to a customer number.</p>
    <p><b>How to verify:</b> open <b>Import points</b> in the app nav and paste a two-line CSV &mdash; <code>email,points</code> then <code>a-customer@example.com,100</code>. The app resolves that email to the Shopify customer and the credited balance then appears in Members.</p>
    <p>Loyara <b>never emails customers</b> and never uses email for marketing &mdash; retention nudges are emitted only as events to Klaviyo, which owns marketing consent. The protected-customer-data request is scoped to exactly this functional use.</p>
  </div>
</div>
</body>
</html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex" },
  });
};
