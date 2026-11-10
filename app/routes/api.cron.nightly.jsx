import { timingSafeEqual } from "node:crypto";
import { getSettings } from "../bestseller/env.server";
import { startScheduledRuns } from "../bestseller/jobs/start.server";

/**
 * External scheduler endpoint: POST /api/cron/nightly
 * Header: Authorization: Bearer <BESTSELLER_CRON_SECRET>
 *
 * Call it at 00:00 and 01:00 UTC every day. The job itself decides which call
 * is 02:00 in Copenhagen and starts at most one run per shop per local date.
 */
export const action = async ({ request }) => {
  const { cronSecret } = getSettings();
  if (!cronSecret || cronSecret.length < 24) {
    return Response.json({ error: "BESTSELLER_CRON_SECRET is not configured (min. 24 characters)." }, { status: 503 });
  }
  const provided = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!safeEqual(provided, cronSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const results = await startScheduledRuns(new Date());
  return Response.json({ at: new Date().toISOString(), results }, { status: 202 });
};

export const loader = () => Response.json({ error: "Use POST" }, { status: 405 });

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
