import { randomUUID } from "node:crypto";
import { applyRunResult, applyStatusText } from "../apply/run-apply.js";
import { APPROVAL_STATES, approvalState } from "../approval/state.js";
import { buildEmailBatches } from "../flow/payload.js";
import { sendFlowEvents } from "../flow/send.js";
import { applyGuard } from "./guards.js";
import { LOCK_TTL_MS } from "./run-job.js";

/**
 * Approval and manual apply. The same functions serve the app buttons
 * (via: "app") and the email link page (via: "email").
 *
 * deps: { repo, settings, graphql, grantedScopes, now, logger, approvalUrl, storeUpdates }
 */

export async function loadApprovalContext({ repo, shop, runId, now }) {
  const run = await repo.getRunBasic(shop, runId);
  if (!run) return null;
  const [latestSucceededId, approvals] = await Promise.all([repo.latestSucceededRunId(shop), repo.approvalsForRun(shop, runId)]);
  return { run, approvals, state: approvalState({ run, latestSucceededId, approvals, now }) };
}

/** Records an approval or rejection; an approval starts the apply when updates are allowed. */
export async function decideRun({ shop, runId, decision, via, by = null, note = null, deps }) {
  const now = deps.now ?? (() => new Date());
  const ctx = await loadApprovalContext({ repo: deps.repo, shop, runId, now: now() });
  if (!ctx) return { ok: false, error: "This list could not be found." };
  const allowed = decision === "approved" ? ctx.state.canApprove : ctx.state.canReject;
  if (!allowed) {
    return { ok: false, error: ctx.state.reason ?? `This list is ${APPROVAL_STATES[ctx.state.state].label.toLowerCase()}.` };
  }

  const tag = ctx.run.result?.config?.bestsellerTag ?? ctx.run.labelTag ?? "";
  await deps.repo.recordApproval(shop, { runId, decision, via, by, note });
  await deps.repo.recordEvents(shop, [
    {
      kind: decision,
      tag,
      runId,
      localDate: ctx.run.localDate,
      detail: `${decision === "approved" ? "Approved" : "Rejected"} via ${via === "email" ? "the email link" : "the app"}${
        by ? ` by ${by}` : ""
      }${note ? `: “${note}”` : ""}`,
    },
  ]);

  if (decision !== "approved") return { ok: true, decision };
  const apply = await startApprovedApply({ shop, runId, requestedBy: by, deps });
  return { ok: true, decision, apply: { started: apply.started, reasons: apply.reasons ?? [] }, done: apply.done };
}

/** Applies an approved list. Blocked (with reasons) unless every update guard passes. */
export async function startApprovedApply({ shop, runId, requestedBy = null, deps }) {
  const { repo, settings } = deps;
  const now = deps.now ?? (() => new Date());
  const ctx = await loadApprovalContext({ repo, shop, runId, now: now() });
  if (!ctx) return { started: false, reasons: ["This list could not be found."] };
  if (!ctx.state.canApply) {
    return { started: false, reasons: [ctx.state.reason ?? `This list is ${APPROVAL_STATES[ctx.state.state].label.toLowerCase()}.`] };
  }
  const guard = applyGuard({ settings, shop, grantedScopes: deps.grantedScopes, runSucceeded: true, storeUpdates: deps.storeUpdates });
  if (!guard.allowed) return { started: false, reasons: guard.reasons };

  const holder = randomUUID();
  if (!(await repo.acquireLock(shop, holder, LOCK_TTL_MS, now()))) {
    return { started: false, reasons: ["Another update is running; try again in a minute."] };
  }
  // Holding the lock means nothing else is running: clear interrupted jobs.
  await repo.failAbandonedRuns(shop, "Interrupted before it finished (lock expired).");
  await repo.updateRun(runId, { applyStatus: "RUNNING" });

  const log = (level, message, data) => deps.logger?.({ level, shop, runId, message, ...(data ? { data } : {}) });
  const done = (async () => {
    const result = ctx.run.result;
    const tag = result.config.bestsellerTag;
    try {
      const summary = await applyRunResult({ graphql: deps.graphql, result, run: ctx.run, shop, repo, log });
      await repo.updateRun(runId, {
        applyStatus: summary.failed ? "FAILED" : "DONE",
        appliedAt: now(),
        applySummary: { blocked: false, ...summary, approvedBy: requestedBy },
      });
      await repo.recordEvents(shop, [
        { kind: "applied", tag, runId, localDate: ctx.run.localDate, detail: `${applyStatusText(summary)}${requestedBy ? ` · approved by ${requestedBy}` : ""}` },
      ]);
      if (settings.flowTriggerEnabled) {
        const options = {
          runId,
          mode: "applied",
          statusText: applyStatusText(summary),
          approvalUrl: deps.approvalUrl?.(ctx.run),
          keySuffix: ":applied",
        };
        for (const events of buildEmailBatches(result, options, deps.emailFormat ?? "separate")) {
          await sendFlowEvents({
            graphql: deps.graphql,
            events,
            alreadySent: new Set(await repo.sentFlowEventKeys(runId)),
            record: (eventKey, data) => repo.recordFlowEvent(runId, eventKey, data),
            log,
          });
        }
      }
      return { status: summary.failed ? "FAILED" : "DONE", summary };
    } catch (error) {
      log("error", "Applying the approved list failed", { message: error.message });
      await repo.updateRun(runId, { applyStatus: "FAILED", applySummary: { blocked: false, error: error.message } });
      await repo.recordEvents(shop, [
        { kind: "applied", tag, runId, localDate: ctx.run.localDate, detail: `Applying failed: ${error.message}. Safe to retry with “Apply now”.` },
      ]);
      return { status: "FAILED", error };
    } finally {
      await repo.releaseLock(shop, holder);
    }
  })();

  return { started: true, done };
}
