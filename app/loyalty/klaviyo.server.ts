// Klaviyo integration (Pro): emit loyalty events + profile properties so merchants
// can build retention flows (points earned/redeemed, tier changed, expiring soon,
// referral completed). Best-effort fire-and-forget — a Klaviyo hiccup must never
// block or fail the ledger path. The merchant pastes a private API key in Settings.

const KLAVIYO = "https://a.klaviyo.com/api";
const REVISION = "2024-10-15";

/** Emit a Klaviyo event for a customer, optionally updating profile properties
 *  (e.g. loyalty_points, loyalty_vip_tier) so flows can segment on them. No-op
 *  without an api key / email. Never throws. */
export function klaviyoEvent(
  apiKey: string | null | undefined,
  metricName: string,
  email: string | null | undefined,
  properties: Record<string, unknown> = {},
  profileProperties?: Record<string, unknown>,
): void {
  if (!apiKey || !email) return;
  const body = JSON.stringify({
    data: {
      type: "event",
      attributes: {
        metric: { data: { type: "metric", attributes: { name: metricName } } },
        profile: {
          data: {
            type: "profile",
            attributes: {
              email,
              ...(profileProperties ? { properties: profileProperties } : {}),
            },
          },
        },
        properties,
      },
    },
  });
  // fire-and-forget
  void fetch(`${KLAVIYO}/events/`, {
    method: "POST",
    headers: {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      revision: REVISION,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body,
  }).catch((e) => console.warn("[klaviyo] event failed:", e));
}
