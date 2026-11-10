// Called by the external scheduler (Render Cron Job) at 00:00 and 01:00 UTC.
// The app decides which call is 02:00 Europe/Copenhagen (DST-safe) and starts
// at most one run per shop per local date.
//
// Env: BESTSELLER_APP_URL (e.g. https://bibs-trending-labels.onrender.com)
//      BESTSELLER_CRON_SECRET
const appUrl = (process.env.BESTSELLER_APP_URL ?? "").replace(/\/$/, "");
const secret = process.env.BESTSELLER_CRON_SECRET ?? "";

if (!appUrl || !secret) {
  console.error("BESTSELLER_APP_URL and BESTSELLER_CRON_SECRET are required.");
  process.exit(1);
}

const response = await fetch(`${appUrl}/api/cron/nightly`, {
  method: "POST",
  headers: { Authorization: `Bearer ${secret}` },
});
const body = await response.text();
console.log(`HTTP ${response.status} ${body}`);
if (!response.ok) process.exit(1);
