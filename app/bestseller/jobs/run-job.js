import { randomUUID } from "node:crypto";
import { applyRunResult, applyStatusText } from "../apply/run-apply.js";
import { DEFAULT_CONFIG, SCHEDULE } from "../config.js";
import { ConfigurationError, serializeError } from "../errors.js";
import { computeBestsellers } from "../engine/compute.js";
import { computeSalesWindow, localDateString, scheduleDecision } from "../engine/time.js";
import { buildEmailBatches, buildFlowEvents, buildSummaryEvent, payloadSizeSummary } from "../flow/payload.js";
import { membershipChanges, selectionSnapshot } from "../report/history.js";
import { sendFlowEvents } from "../flow/send.js";
import { readCatalog } from "../shopify/catalog.js";
import { readSales, readSalesTrend } from "../shopify/sales.js";
import { checkShopTimeZone, readShopInfo } from "../shopify/shop.js";
import { applyGuard, hasScope } from "./guards.js";

/** Read access needed by every run (catalog export + ShopifyQL). */
export const REQUIRED_SCOPES = ["read_products", "read_reports"];

export const LOCK_TTL_MS = 45 * 60 * 1000;
export const MAX_SCHEDULED_ATTEMPTS = 2;

/**
 * Starts a run if the shop's lock is free. Returns immediately with the run
 * ID; `done` resolves when the run has finished (tests await it, the web
 * request does not).
 *
 * deps: { graphql, fetchImpl, repo, settings, config, now, sleep, logger,
 *         grantedScopes, pollIntervalMs, storeUpdates }
 * storeUpdates: the shop's in-app "Store updates" switch (must be true to apply).
 */
export async function startBestsellerRun({ shop, trigger, requestedBy = null, options = {}, localDate, deps }) {
  const { repo } = deps;
  const config = deps.config ?? DEFAULT_CONFIG;
  const now = deps.now ?? (() => new Date());
  const holder = randomUUID();
  const runOptions = {
    sendFlow: Boolean(options.sendFlow),
    apply: Boolean(options.apply),
    approvalMode: options.approvalMode === "manual" ? "manual" : "automatic",
  };

  const acquired = await repo.acquireLock(shop, holder, LOCK_TTL_MS, now());
  if (!acquired) {
    return { started: false, reason: "Another run is already in progress for this shop." };
  }

  let run;
  try {
    await repo.failAbandonedRuns(shop, "Run was interrupted before it finished (lock expired).");
    run = await repo.createRun({
      shop,
      trigger,
      mode: runOptions.apply ? "apply" : "preview",
      localDate: localDate ?? localDateString(now(), config.timeZone),
      requestedBy,
      options: runOptions,
    });
  } catch (error) {
    await repo.releaseLock(shop, holder);
    throw error;
  }

  const done = executeRun({ run, shop, options: runOptions, deps: { ...deps, config, now }, holder }).finally(() =>
    repo.releaseLock(shop, holder),
  );
  return { started: true, runId: run.id, done };
}

async function executeRun({ run, shop, options, deps, holder }) {
  const { graphql, repo, settings, config, now } = deps;
  const logs = [];
  let lastHeartbeat = Date.now();
  const log = (level, message, data) => {
    const entry = { at: now().toISOString(), level, message, ...(data === undefined ? {} : { data }) };
    logs.push(entry);
    deps.logger?.({ runId: run.id, shop, ...entry });
    if (Date.now() - lastHeartbeat > 60000) {
      lastHeartbeat = Date.now();
      repo.renewLock(shop, holder, LOCK_TTL_MS, now()).catch(() => {});
    }
  };

  try {
    log("info", "Run started", { trigger: run.trigger, mode: run.mode, localDate: run.localDate, options });

    const missingScopes = REQUIRED_SCOPES.filter((scope) => !hasScope(deps.grantedScopes, scope));
    if (missingScopes.length) {
      throw new ConfigurationError(
        "MISSING_SCOPES",
        `The app has not been granted ${missingScopes.join(", ")} on this shop (granted now: ${
          deps.grantedScopes || "none"
        }). Push the app configuration (shopify app dev / shopify app deploy), then approve the updated permissions in the store admin.`,
        { missingScopes, grantedScopes: deps.grantedScopes ?? "" },
      );
    }

    await repo.updateRun(run.id, { phase: "checking shop" });
    const shopInfo = await readShopInfo(graphql);
    const tz = checkShopTimeZone(shopInfo, config.timeZone, { allowMismatch: settings.allowTimeZoneMismatch });
    if (tz.warning) log("warn", tz.warning);

    const window = computeSalesWindow({
      runLocalDate: run.localDate,
      days: config.salesWindowDays,
      timeZone: config.timeZone,
      includeToday: settings.devWindowIncludeToday,
    });
    log("info", "Sales window", window);

    await repo.updateRun(run.id, { phase: "reading catalog", windowStart: window.startDate, windowEnd: window.endDate });
    const catalog = await readCatalog({
      graphql,
      fetchImpl: deps.fetchImpl,
      sleep: deps.sleep,
      pollIntervalMs: deps.pollIntervalMs,
      log,
    });
    log("info", "Catalog read complete", catalog.completeness);

    await repo.updateRun(run.id, { phase: "reading sales" });
    const salesRead = await readSales({ graphql, window, log });
    log("info", "Sales read complete", { ...salesRead.completeness, queries: undefined });

    // Daily trend for the analytics chart only: optional, never fails the run.
    let trend = null;
    try {
      trend = (await readSalesTrend({ graphql, window })).byType;
    } catch (error) {
      log("warn", "Daily sales trend unavailable (analytics only; the selection is not affected)", { message: error.message });
    }

    await repo.updateRun(run.id, { phase: "calculating" });
    const readerWarnings = [];
    if (tz.warning) readerWarnings.push(tz.warning);
    if (window.nonStandard) {
      readerWarnings.push("Development override: the sales window includes today (BESTSELLER_DEV_WINDOW_INCLUDE_TODAY).");
    }
    if (salesRead.completeness.grandTotal === 0) {
      readerWarnings.push(
        `The sales report has no sales between ${window.startDate} and ${window.endDate}; every product ranks with 0 units (ties broken by product ID).`,
      );
    }
    if (salesRead.completeness.parseWarnings?.length) {
      readerWarnings.push(`ShopifyQL warnings: ${salesRead.completeness.parseWarnings.join("; ")}`);
    }
    const result = computeBestsellers({
      products: catalog.products,
      sales: salesRead.sales,
      window,
      config,
      completeness: {
        shop: {
          domain: shopInfo.myshopifyDomain,
          name: shopInfo.name,
          ianaTimezone: shopInfo.ianaTimezone,
          plan: shopInfo.plan ?? null,
        },
        catalog: catalog.completeness,
        sales: salesRead.completeness,
      },
      warnings: readerWarnings,
      revenue: salesRead.revenue ?? new Map(),
      trend,
      currency: shopInfo.currencyCode ?? null,
    });

    const approvalUrl = deps.approvalUrl?.({ ...run, resultHash: result.resultHash, finishedAt: now() }) ?? null;
    // Automatic mode: the email is the review; manual mode: it asks for approval.
    const previewStatus =
      options.approvalMode === "manual"
        ? "Preview: approval needed"
        : options.apply
          ? "Preview: changes will be applied automatically"
          : "Preview: store updates are off, nothing was changed";
    const previewOptions = { runId: run.id, mode: "preview", approvalUrl, statusText: previewStatus };
    // Sizes of both email formats, so the report shows whether each would fit.
    result.flowPayloads = payloadSizeSummary([...buildFlowEvents(result, previewOptions), buildSummaryEvent(result, previewOptions)]);
    for (const category of result.categories) {
      log("info", `Season decision: ${category.name}`, {
        season: category.launch.chosenSeason,
        source: category.launch.source,
        ladder: category.launch.ladder,
      });
      log("info", `Selection: ${category.name}`, {
        selected: category.selected.map((p) => `${p.legacyId}:${p.netUnits}:${p.pickedAs}`),
        shortfall: category.shortfall,
        add: category.wouldAdd.length,
        remove: category.wouldRemove.length,
        keep: category.wouldKeep.length,
      });
    }

    await repo.completeRun(run.id, {
      status: "SUCCEEDED",
      phase: "done",
      result,
      inputHash: result.inputHash,
      resultHash: result.resultHash,
      logs,
    });

    // History: compare with the stored list so a product is recorded only when
    // it really joins or leaves (never twice in a row).
    try {
      const members = await repo.listMembers(shop, config.bestsellerTag);
      const changes = membershipChanges(members, result, { runId: run.id, localDate: run.localDate });
      await repo.saveRunSelection(run.id, { labelTag: config.bestsellerTag, selection: selectionSnapshot(result) });
      await repo.saveMembership(shop, config.bestsellerTag, { ...changes, runId: run.id });
      await repo.recordEvents(shop, changes.events);
      log("info", "History updated", { ...changes.counts, summary: changes.summary });
    } catch (error) {
      log("warn", "History could not be updated (the run result is still valid)", { message: error.message });
    }

    // Automatic mode only (the merchant chose "apply every night"): apply now,
    // then email what was changed. Manual mode: email the preview with an
    // approval link; changes wait for an approval in the app or by email.
    let applied = null;
    if (options.apply) {
      const guard = applyGuard({ settings, shop, grantedScopes: deps.grantedScopes, runSucceeded: true, storeUpdates: deps.storeUpdates });
      if (!guard.allowed) {
        log("warn", "Tag updates blocked", { reasons: guard.reasons });
        await repo.updateRun(run.id, { applySummary: { blocked: true, reasons: guard.reasons } });
      } else {
        await repo.recordApproval(shop, { runId: run.id, decision: "approved", via: "automatic", by: "Automatic mode", note: null });
        await repo.updateRun(run.id, { applyStatus: "RUNNING" });
        applied = await applyRunResult({ graphql, result, run, shop, repo, log });
        await repo.updateRun(run.id, {
          applyStatus: applied.failed ? "FAILED" : "DONE",
          appliedAt: now(),
          applySummary: { blocked: false, ...applied, approvedBy: "Automatic mode" },
        });
        await repo.recordEvents(shop, [
          { kind: "applied", tag: config.bestsellerTag, runId: run.id, localDate: run.localDate, detail: `${applyStatusText(applied)} · automatic mode` },
        ]);
      }
    }

    if (options.sendFlow) {
      if (!settings.flowTriggerEnabled) {
        log("warn", "Flow sending was requested but BESTSELLER_FLOW_TRIGGER_ENABLED is not true; nothing was sent.");
      } else {
        const emailOptions = applied
          ? { runId: run.id, mode: "applied", statusText: applyStatusText(applied), approvalUrl, keySuffix: ":applied" }
          : previewOptions;
        // Each format is its own batch: an oversized combined email never blocks the separate ones.
        for (const events of buildEmailBatches(result, emailOptions, deps.emailFormat ?? "separate")) {
          const flow = await sendFlowEvents({
            graphql,
            events,
            alreadySent: new Set(await repo.sentFlowEventKeys(run.id)),
            record: (eventKey, data) => repo.recordFlowEvent(run.id, eventKey, data),
            log,
          });
          log("info", "Flow events processed", { ...flow, events: events.map((e) => e.eventKey) });
        }
      }
    }

    await repo.updateRun(run.id, { logs });
    return { status: "SUCCEEDED", runId: run.id };
  } catch (error) {
    log("error", "Run failed; no previews were sent and no tags were changed.", serializeError(error));
    await repo.completeRun(run.id, { status: "FAILED", phase: "failed", error: serializeError(error), logs });
    return { status: "FAILED", runId: run.id, error };
  }
}

/**
 * Called by the external scheduler (00:00 and 01:00 UTC). Starts at most one
 * nightly run per shop per Copenhagen date.
 *
 * makeDeps(shop) -> deps for startBestsellerRun (admin client etc.)
 */
export async function triggerScheduledRuns({
  shops,
  now,
  repo,
  settings,
  config = DEFAULT_CONFIG,
  configForShop = async () => config,
  approvalModeForShop = async () => "manual",
  makeDeps,
}) {
  const results = [];
  for (const shop of shops) {
    const decision = scheduleDecision(now, { timeZone: config.timeZone, ...SCHEDULE });
    if (!decision.due) {
      results.push({ shop, started: false, reason: decision.reason });
      continue;
    }
    const runs = await repo.findRunsForLocalDate(shop, decision.localDate, "schedule");
    if (runs.some((r) => r.status === "SUCCEEDED")) {
      results.push({ shop, started: false, reason: `nightly run for ${decision.localDate} already succeeded` });
      continue;
    }
    if (runs.some((r) => r.status === "RUNNING")) {
      results.push({ shop, started: false, reason: `nightly run for ${decision.localDate} is still running` });
      continue;
    }
    const failed = runs.filter((r) => r.status === "FAILED").length;
    if (failed >= MAX_SCHEDULED_ATTEMPTS) {
      results.push({ shop, started: false, reason: `nightly run for ${decision.localDate} failed ${failed} times; waiting for a manual retry` });
      continue;
    }
    try {
      const deps = await makeDeps(shop);
      const approvalMode = await approvalModeForShop(shop);
      const started = await startBestsellerRun({
        shop,
        trigger: "schedule",
        localDate: decision.localDate,
        options: {
          sendFlow: true,
          // Nightly apply only in automatic mode with store updates switched on
          // in the app; manual mode waits for approval.
          apply: settings.applyEnabled && deps.storeUpdates === true && approvalMode === "automatic",
          approvalMode,
        },
        deps: { ...deps, repo, settings, config: await configForShop(shop) },
      });
      results.push({ shop, ...started, done: undefined });
    } catch (error) {
      results.push({ shop, started: false, reason: error.message });
    }
  }
  return results;
}
