// App Bridge review request, asked once at a peak-value moment (first export, or
// first "verified live"). Policy-safe: Shopify's reviews API enforces its own
// eligibility + rate limits, and we never gate any feature on it. We only ask
// again if the modal wasn't actually shown (e.g. not yet eligible), and stop for
// good once it has been.
//
// This is the CLIENT half (localStorage guard). For a strictly once-per-shop
// guarantee across devices, pair it with the server-side reviewRequestedAt flag
// in regulation/monitor.server.ts (maybeRequestReview) and only call this when
// the loader says the peak was just reached.

import type { useAppBridge } from "@shopify/app-bridge-react";
import { BRAND } from "../../config";

type Shopify = ReturnType<typeof useAppBridge>;

const KEY = `${BRAND.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:review-asked`;

export async function requestReviewOnce(shopify: Shopify): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(KEY) === "done") return;
    const res = await shopify.reviews.request();
    // Only burn our one ask once the modal was genuinely shown — if the merchant
    // isn't eligible yet, leave the door open to ask at the next peak moment.
    if (res?.success) window.localStorage.setItem(KEY, "done");
  } catch {
    // Best-effort; a review prompt must never interrupt the merchant's action.
  }
}
