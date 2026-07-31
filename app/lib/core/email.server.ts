// Transactional email via Resend (free tier covers thousands/month). Degrades
// to a no-op when RESEND_API_KEY isn't set, so dev/build never breaks.

import { BRAND } from "../../config";

interface SendArgs {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({
  to,
  subject,
  html,
}: SendArgs): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? `${BRAND} <onboarding@resend.dev>`;

  if (!key || !to) {
    console.log("[email] skipped — no RESEND_API_KEY or recipient");
    return false;
  }

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!r.ok) {
      console.warn("[email] send failed:", r.status, await r.text());
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[email] error:", e);
    return false;
  }
}
