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
<title>Loyara — Proof of resolution (2.1.4)</title>
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
  <p class="sub">Proof of resolution &middot; App Store review requirement 2.1.4 (Synchronize data accurately)</p>

  <div class="card">
    <h2>What the reviewer reported</h2>
    <p>Placing a test order while logged into a customer account resulted in a 0 points balance and the admin dashboard showing "No members yet".</p>
  </div>

  <div class="card">
    <h2>Root cause &amp; fix</h2>
    <p>Points accrual bailed out on <code>payload.test</code>. On a Shopify development / App-Review store <b>every</b> order a reviewer can place is a test order (Bogus Gateway), so nothing ever accrued and no member was created.</p>
    <p>The app now detects development / App-Review stores (<code>shop.plan.partnerDevelopment</code>) and accrues points on their test orders, so the end-to-end flow works during review. Real merchant stores are unchanged: their own Bogus-Gateway test orders are still skipped (verified by the ledger test suite, 29/29).</p>
  </div>

  <div class="card">
    <h2>A paid order now creates a member with points <span class="ok">&mdash; admin is in sync</span></h2>
    <p>After a $26 order for a customer, that customer appears in the Members list with 26 points (26 lifetime), directly refuting the "0 points" / "No members yet" behaviour. See <code>anna.muller@example.com</code> below.</p>
    <img src="/proof-members.jpg" alt="Loyara Members list showing a new member with 26 points after an order" />
  </div>
</div>
</body>
</html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex" },
  });
};
