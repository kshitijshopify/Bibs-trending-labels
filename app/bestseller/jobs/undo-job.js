import { randomUUID } from "node:crypto";
import { undoRunChanges, undoState, undoStatusText } from "../apply/undo.js";
import { applyGuard } from "./guards.js";
import { LOCK_TTL_MS } from "./run-job.js";

/**
 * "Undo this update": reverses the store changes of the latest applied update.
 * Serves the app button (via: "app") and the email link page (via: "email").
 *
 * deps: { repo, settings, graphql, grantedScopes, now, logger, storeUpdates }
 */

export async function loadUndoContext({ repo, shop, runId }) {
  const run = await repo.getRunBasic(shop, runId);
  if (!run) return null;
  const [latestAppliedId, changes] = await Promise.all([repo.latestAppliedRunId(shop), repo.tagChangesForRun(runId)]);
  return { run, changes, state: undoState({ run, latestAppliedId, changes }) };
}

/** Starts the undo in the background. Blocked (with reasons) unless every update guard passes. */
export async function startUndo({ shop, runId, requestedBy = null, via = "app", note = null, paused = false, deps }) {
  const { repo, settings } = deps;
  const now = deps.now ?? (() => new Date());
  const first = await loadUndoContext({ repo, shop, runId });
  if (!first) return { started: false, reasons: ["This update could not be found."] };
  if (!first.state.canUndo) return { started: false, reasons: [first.state.reason ?? "There is nothing to undo for this update."] };
  const guard = applyGuard({ settings, shop, grantedScopes: deps.grantedScopes, runSucceeded: true, storeUpdates: deps.storeUpdates });
  if (!guard.allowed) return { started: false, reasons: guard.reasons };

  const holder = randomUUID();
  if (!(await repo.acquireLock(shop, holder, LOCK_TTL_MS, now()))) {
    return { started: false, reasons: ["Another update is running; try again in a minute."] };
  }
  // Holding the lock means nothing else is running: clear interrupted jobs,
  // then check again (a nightly update may have finished in the meantime).
  await repo.failAbandonedRuns(shop, "Interrupted before it finished (lock expired).");
  const ctx = await loadUndoContext({ repo, shop, runId });
  if (!ctx?.state.canUndo) {
    await repo.releaseLock(shop, holder);
    return { started: false, reasons: [ctx?.state.reason ?? "There is nothing to undo for this update."] };
  }
  await repo.updateRun(runId, { applyStatus: "UNDOING" });

  const tag = ctx.run.result?.config?.bestsellerTag ?? ctx.run.labelTag ?? "";
  const log = (level, message, data) => deps.logger?.({ level, shop, runId, message, ...(data ? { data } : {}) });
  const done = (async () => {
    const meta = { at: now().toISOString(), by: requestedBy, via, note, paused };
    try {
      const summary = await undoRunChanges({ graphql: deps.graphql, run: ctx.run, changes: ctx.changes, shop, repo, by: requestedBy, log });
      await repo.updateRun(runId, {
        applyStatus: summary.failed ? "UNDO_FAILED" : "UNDONE",
        applySummary: { ...(ctx.run.applySummary ?? {}), undo: { ...summary, ...meta } },
      });
      await repo.recordEvents(shop, [
        {
          kind: "undone",
          tag,
          runId,
          localDate: ctx.run.localDate,
          detail: `${undoStatusText(summary, { by: requestedBy, via, paused })}${note ? ` · “${note}”` : ""}`,
        },
      ]);
      return { status: summary.failed ? "UNDO_FAILED" : "UNDONE", summary };
    } catch (error) {
      log("error", "Undo failed", { message: error.message });
      await repo.updateRun(runId, {
        applyStatus: "UNDO_FAILED",
        applySummary: { ...(ctx.run.applySummary ?? {}), undo: { error: error.message, ...meta } },
      });
      await repo.recordEvents(shop, [
        { kind: "undone", tag, runId, localDate: ctx.run.localDate, detail: `Undo failed: ${error.message}. Safe to try again.` },
      ]);
      return { status: "UNDO_FAILED", error };
    } finally {
      await repo.releaseLock(shop, holder);
    }
  })();

  return { started: true, done, paused };
}
