import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { applyEntry } from "../loyalty/points.server";

// Shopify Flow ACTION handler: "Adjust loyalty points".
//
// This is the whole "programmable loyalty API" — the thing Smile gates behind a
// ~$1,000/mo plan — delivered as ONE signed endpoint instead of a public REST
// surface (which is a support/version tarpit). Merchants build any earn rule they
// want in Flow ("customer left a review → +50 points", "tagged VIP → +500") and
// wire the action here. authenticate.flow verifies the HMAC signature with the
// app secret, so only Shopify Flow can call it.
//
// Idempotent on the Flow action_run_id, so a Flow retry never double-applies.
// A positive adjustment is treated as earned (EARN_MANUAL → counts toward VIP);
// a negative one is a balance-only correction (ADJUST_MANUAL → never un-earns
// lifetime/VIP, matching how refunds vs manual edits are modelled elsewhere).
//   POST /flow/adjust-points

// Guard against a misconfigured Flow pushing an absurd single adjustment.
const MAX_MAGNITUDE = 1_000_000;

export const loader = async (_: LoaderFunctionArgs) =>
  json({ error: "method_not_allowed" }, { status: 405 });

function toCustomerGid(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v))
    return `gid://shopify/Customer/${Math.trunc(v)}`;
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (s.startsWith("gid://shopify/Customer/")) return s;
  if (/^\d+$/.test(s)) return `gid://shopify/Customer/${s}`;
  return null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, payload } = await authenticate.flow(request);
  const shop = session.shop;

  const props = (payload?.properties ?? {}) as Record<string, unknown>;
  const customerGid = toCustomerGid(props.customer_id);
  const points = Math.trunc(Number(props.points));
  const note = String(props.note ?? "").slice(0, 200);

  if (!customerGid)
    return json({ ok: false, error: "customer_id required" }, { status: 400 });
  if (!Number.isFinite(points) || points === 0)
    return json({ ok: false, error: "points must be a non-zero integer" }, { status: 400 });
  if (Math.abs(points) > MAX_MAGNITUDE)
    return json({ ok: false, error: "points magnitude too large" }, { status: 400 });

  // Idempotency: one apply per Flow action run. Fall back to a stable synthetic
  // key if action_run_id is somehow absent (shouldn't be) so we never collide.
  const runId =
    String(payload?.action_run_id ?? "") ||
    `${customerGid}:${points}:${payload?.action_definition_id ?? "flow"}`;

  const res = await applyEntry({
    shop,
    customerGid,
    delta: points,
    // Positive => earned (builds VIP); negative => balance-only correction.
    reason: points > 0 ? "EARN_MANUAL" : "ADJUST_MANUAL",
    sourceType: "manual",
    sourceId: `flow:${runId}`,
    meta: { via: "flow", note: note || undefined },
  });

  return json({
    ok: true,
    applied: res.applied, // false = duplicate Flow retry, already counted
    balance: res.balance ?? null,
  });
};
