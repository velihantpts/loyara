import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { runMonthlyReport } from "../lib/core/cron";

// Called by an external scheduler (Coolify cron) monthly:
//   GET /cron/monthly-report?key=$CRON_SECRET
// Reconciles Pro shops against live billing and emails each a program summary.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (
    !process.env.CRON_SECRET ||
    url.searchParams.get("key") !== process.env.CRON_SECRET
  ) {
    return json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runMonthlyReport();
  return json(result);
};
