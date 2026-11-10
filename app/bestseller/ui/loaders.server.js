// Shared server-side helpers for the dashboard pages.
import { SCHEDULE, TIME_ZONE } from "../config.js";
import { getSettings } from "../env.server.js";
import { applyGuard } from "../jobs/guards.js";
import { prismaRepo } from "../jobs/repo.server.js";
import { nextNightlyRunLabel, tagListView } from "../report/views.js";

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "6 Nov 2026, 02:01" in Copenhagen time. */
export function formatLocal(date) {
  return date ? dateFormat.format(new Date(date)) : null;
}

/** Latest successful result as a simple tag-list view, plus run status. */
export async function loadLatestView(shop) {
  const [latest, runs] = await Promise.all([prismaRepo.latestSucceededRun(shop), prismaRepo.listRuns(shop, 5)]);
  const newest = runs[0] ?? null;
  let view = null;
  if (latest?.result) {
    const [changes, members] = await Promise.all([
      latest.applyStatus ? prismaRepo.tagChangesForRun(latest.id) : [],
      prismaRepo.listMembers(shop, latest.result.config.bestsellerTag),
    ]);
    view = tagListView(latest.result, { changes, members, appliedAt: latest.appliedAt });
  }
  const trend = latest?.result?.salesTrend ?? null;
  return {
    view,
    // Daily units of the three categories together, for the overview sparkline.
    dailyUnits: trend ? trend.days.map((_, i) => trend.series.reduce((n, s) => n + (s.values[i] ?? 0), 0)) : null,
    unitsSold: latest?.result?.categories ? latest.result.categories.reduce((n, c) => n + (c.analytics?.totalUnits ?? 0), 0) : null,
    latestRun: latest
      ? {
          id: latest.id,
          localDate: latest.localDate,
          finishedAt: formatLocal(latest.finishedAt),
          appliedAt: formatLocal(latest.appliedAt),
          applyStatus: latest.applyStatus ?? null,
        }
      : null,
    newestRun: newest
      ? {
          id: newest.id,
          status: newest.status,
          startedAt: formatLocal(newest.startedAt),
          error: newest.error ? JSON.parse(newest.error) : null,
        }
      : null,
    running: runs.some((r) => r.status === "RUNNING"),
  };
}

/**
 * Plain-words automation status.
 * storeUpdates: the shop's in-app switch. storeChanges is true only when the
 * switch is on AND the server is ready (env flag, allow-list, write_products).
 */
export function automationStatus(shop, grantedScopes, storeUpdates = false) {
  const settings = getSettings();
  const server = applyGuard({ settings, shop, grantedScopes, runSucceeded: true, storeUpdates: true });
  const nightly = settings.cronShops.includes(shop) && settings.cronSecret.length >= 24;
  return {
    storeChanges: storeUpdates === true && server.allowed,
    storeSwitch: storeUpdates === true,
    serverReady: server.allowed,
    serverReasons: server.reasons,
    previewEmails: settings.flowTriggerEnabled,
    nightly,
    nextRun: nightly ? `${nextNightlyRunLabel(new Date(), { timeZone: TIME_ZONE, targetHour: SCHEDULE.targetHour })} (Copenhagen)` : null,
  };
}
