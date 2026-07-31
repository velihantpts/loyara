import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { runDaily } from "../loyalty/daily.server";

// External scheduler (Coolify cron), daily:
//   GET /cron/daily?key=$CRON_SECRET
// Runs inactivity-based points expiry + birthday bonuses.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (
    !process.env.CRON_SECRET ||
    url.searchParams.get("key") !== process.env.CRON_SECRET
  ) {
    return json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runDaily(new Date());
  return json(result);
};
