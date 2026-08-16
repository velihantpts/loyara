import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { earnReview } from "../loyalty/earn.server";

// Public endpoint for Judge.me review webhooks — NOT a Shopify webhook, so it's
// authenticated by a per-shop token the merchant pastes into the Judge.me webhook
// URL: POST https://<app>/judgeme/review?shop=<shop>&token=<judgemeSecret>
//
// ⚠️ Judge.me's exact payload varies by plan/version, so parsing is defensive and
// this MUST be verified against a real event on a dev store before relying on it.
// Everything degrades safely: unknown shop/token → 401; missing fields → 422; no
// matching Shopify customer → skipped (guest reviewer). No points are ever
// awarded without a real, published review mapped to a real customer.

/* eslint-disable @typescript-eslint/no-explicit-any */
export const action = async ({ request }: ActionFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const token = url.searchParams.get("token");
  if (!shop) return json({ error: "missing shop" }, { status: 400 });

  const cfg = await prisma.shopConfig.findUnique({ where: { shop } });
  if (!cfg || !cfg.judgemeSecret || !token || token !== cfg.judgemeSecret) {
    return json({ error: "unauthorized" }, { status: 401 });
  }
  if (!cfg.programActive || cfg.reviewBonus <= 0) {
    return json({ ok: true, skipped: "off" });
  }

  // Accept JSON or form-encoded bodies.
  let body: any = {};
  try {
    body = await request.clone().json();
  } catch {
    try {
      body = Object.fromEntries((await request.formData()) as any);
    } catch {
      body = {};
    }
  }
  const review = body?.review ?? body ?? {};
  const reviewId = String(review?.id ?? review?.review_id ?? body?.id ?? "");
  const email: string | null =
    review?.reviewer?.email ?? review?.email ?? body?.email ?? null;
  if (!reviewId || !email) {
    return json({ ok: false, error: "missing review id or email" }, { status: 422 });
  }

  // Only reward published reviews when that signal is present (default: reward,
  // since some payloads only fire on publish).
  const published =
    review?.published ?? (review?.hidden === true ? false : true);
  if (published === false) return json({ ok: true, skipped: "unpublished" });

  // Map the reviewer email → a Shopify customer gid. Guests (no account) earn
  // nothing — points only go to real customers.
  let customerGid = "";
  try {
    const { admin } = await unauthenticated.admin(shop);
    const r = await admin.graphql(
      `#graphql
      query CustomerByEmail($q: String!) {
        customers(first: 1, query: $q) { nodes { id } }
      }`,
      { variables: { q: `email:${email}` } },
    );
    const j = (await r.json()) as {
      data?: { customers?: { nodes?: { id?: string }[] } };
    };
    customerGid = j?.data?.customers?.nodes?.[0]?.id ?? "";
  } catch {
    // best-effort; a lookup failure just skips (no accrual)
  }
  if (!customerGid) return json({ ok: true, skipped: "no-customer" });

  const outcome = await earnReview(shop, customerGid, email, reviewId);
  return json({ ok: true, outcome });
};
