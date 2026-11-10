import {
  FLOW_PAYLOAD_LIMIT_BYTES,
  FLOW_PAYLOAD_WARN_BYTES,
  FLOW_SUMMARY_TRIGGER_HANDLE,
  FLOW_TRIGGER_HANDLE,
} from "../config.js";

export const CLEANUP_EVENT_KEY = "cleanup";
export const SUMMARY_EVENT_KEY = "summary";
export const APPROVAL_LINK_PLACEHOLDER = "https://example.com/approval-link-not-configured";

/**
 * Flow trigger payloads. Field keys must match the trigger TOML files exactly
 * (Flow allows only letters and spaces in keys) and every field must be
 * present on every event. Nothing is truncated: an event over the limit is
 * never sent (the caller blocks its whole batch).
 *
 * Two triggers:
 *  - "Bestseller preview ready": one event per category + one cleanup event
 *    (one email per category)
 *  - "Bestseller daily summary ready": ONE event with everything (one email)
 *
 * mode "preview": the email asks for approval. mode "applied": it confirms
 * what was changed in the store.
 */

function commonFields(result, { runId, mode, statusText, approvalUrl }) {
  return {
    "Run ID": runId,
    Mode: mode,
    Status: statusText ?? (mode === "applied" ? "Applied" : "Preview: approval needed"),
    "Approval link": approvalUrl || APPROVAL_LINK_PLACEHOLDER,
    "Sales window": result.window?.label ?? "",
  };
}

function categoryReport(result, category, runId) {
  return {
    category: category.name,
    labelTag: result.config.bestsellerTag,
    runId,
    salesWindow: result.window?.label ?? "",
    season: category.launch.chosenSeason ?? "None",
    seasonSource: category.launch.source,
    target: category.total,
    reserved: category.reserved,
    reservedFilled: category.launch.reservedFilled,
    shortfall: category.shortfall,
    skippedSeasons: category.launch.ladder
      .filter((step) => step.decision === "skipped")
      .map((step) => `${step.season} (${step.source}): ${step.reason}`),
    selected: category.selected.map(line),
    wouldAdd: category.wouldAdd.map(line),
    wouldRemove: category.wouldRemove.map(line),
    wouldKeep: category.wouldKeep.map(line),
    cleanup: [],
    review: [],
    warnings: category.shortfall > 0 ? [`Shortfall: ${category.shortfall} place(s) could not be filled.`] : [],
  };
}

function cleanupReport(result, runId) {
  return {
    category: "Cleanup and review",
    labelTag: result.config.bestsellerTag,
    runId,
    salesWindow: result.window?.label ?? "",
    season: "None",
    seasonSource: "none",
    target: 0,
    reserved: 0,
    reservedFilled: 0,
    shortfall: 0,
    skippedSeasons: [],
    selected: [],
    wouldAdd: [],
    wouldRemove: [],
    wouldKeep: [],
    cleanup: result.cleanup.map(line),
    review: result.review.map(line),
    warnings: result.warnings,
  };
}

/** One event per category plus one cleanup/review event (one email each). */
export function buildFlowEvents(result, { runId, mode = "preview", statusText, approvalUrl, keySuffix = "" }) {
  const common = commonFields(result, { runId, mode, statusText, approvalUrl });

  const events = result.categories.map((category) => {
    const report = categoryReport(result, category, runId);
    return finalise(`${category.key}${keySuffix}`, FLOW_TRIGGER_HANDLE, {
      ...common,
      "Event type": "category",
      Category: category.name,
      Season: report.season,
      "Season source": report.seasonSource,
      "Selected count": category.selected.length,
      "Target count": category.total,
      Shortfall: category.shortfall,
      "Would add count": category.wouldAdd.length,
      "Would remove count": category.wouldRemove.length,
      "Would keep count": category.wouldKeep.length,
      Report: report,
    });
  });

  events.push(
    finalise(`${CLEANUP_EVENT_KEY}${keySuffix}`, FLOW_TRIGGER_HANDLE, {
      ...common,
      "Event type": "cleanup",
      Category: "Cleanup and review",
      Season: "None",
      "Season source": "none",
      "Selected count": 0,
      "Target count": 0,
      Shortfall: 0,
      "Would add count": 0,
      "Would remove count": result.cleanup.length,
      "Would keep count": 0,
      Report: cleanupReport(result, runId),
    }),
  );

  return events;
}

/** One event with every category, cleanup and review (one email in total). */
export function buildSummaryEvent(result, { runId, mode = "preview", statusText, approvalUrl, keySuffix = "" }) {
  const add = result.categories.reduce((n, c) => n + c.wouldAdd.length, 0);
  const remove = result.categories.reduce((n, c) => n + c.wouldRemove.length, 0) + result.cleanup.length;
  const keep = result.categories.reduce((n, c) => n + c.wouldKeep.length, 0);
  const upToDate = add + remove === 0;
  const tag = result.config.bestsellerTag;
  const summaryLine =
    mode === "applied"
      ? statusText ?? "Applied"
      : upToDate
        ? `No changes: all ${keep} selected product(s) already have ${tag}`
        : `${add} product(s) get ${tag}, ${remove} lose it, ${keep} keep it`;

  return finalise(`${SUMMARY_EVENT_KEY}${keySuffix}`, FLOW_SUMMARY_TRIGGER_HANDLE, {
    ...commonFields(result, { runId, mode, statusText, approvalUrl }),
    Tag: tag,
    "Up to date": upToDate,
    "Would add count": add,
    "Would remove count": remove,
    "Would keep count": keep,
    Summary: {
      labelTag: tag,
      runId,
      salesWindow: result.window?.label ?? "",
      upToDate,
      summaryLine,
      categories: result.categories.map((category) => categoryReport(result, category, runId)),
      cleanup: result.cleanup.map(line),
      review: result.review.map(line),
      warnings: result.warnings,
    },
  });
}

/** Events for the shop's email format: separate | combined | both. */
export function buildEmailBatches(result, options, emailFormat = "separate") {
  const batches = [];
  if (emailFormat === "separate" || emailFormat === "both") batches.push(buildFlowEvents(result, options));
  if (emailFormat === "combined" || emailFormat === "both") batches.push([buildSummaryEvent(result, options)]);
  return batches;
}

function line(product) {
  return {
    productId: product.id,
    title: product.title,
    productType: product.productType ?? "",
    status: product.status,
    netUnits: product.netUnits ?? 0,
    rank: product.overallRank ?? null,
    pickedAs: product.pickedAs ?? null,
    launch: Boolean(product.isLaunch),
    reasons: product.removeReasons ?? (product.reviewReason ? [product.reviewReason] : []),
  };
}

function finalise(eventKey, handle, payload) {
  const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  return {
    eventKey,
    handle,
    payload,
    bytes,
    withinLimit: bytes < FLOW_PAYLOAD_LIMIT_BYTES,
    nearLimit: bytes >= FLOW_PAYLOAD_WARN_BYTES,
  };
}

export function payloadSizeSummary(events) {
  return events.map(({ eventKey, bytes, withinLimit, nearLimit }) => ({
    eventKey,
    bytes,
    withinLimit,
    nearLimit,
    limit: FLOW_PAYLOAD_LIMIT_BYTES,
  }));
}
