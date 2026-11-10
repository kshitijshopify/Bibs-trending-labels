// Server glue for approvals: signed email links, app/email decisions, apply, undo.
import prisma from "../../db.server";
import { approvalSecret, approvalUrlFor } from "./links.server.js";
import { APPROVAL_STATES } from "./state.js";
import { verifyApprovalToken } from "./token.js";
import { getSettings } from "../env.server.js";
import { applyGuard } from "../jobs/guards.js";
import { UNDO_STATES } from "../apply/undo.js";
import { decideRun, loadApprovalContext, startApprovedApply } from "../jobs/approval-job.js";
import { prismaRepo } from "../jobs/repo.server.js";
import { depsForShop } from "../jobs/start.server.js";
import { loadUndoContext, startUndo } from "../jobs/undo-job.js";
import { tagListView } from "../report/views.js";
import { getShopApprovalMode, getShopLabelSetting, saveShopApprovalMode } from "../settings.server.js";
import { formatLocal } from "../ui/loaders.server.js";

export { approvalUrlFor };

async function approvalDeps(shop) {
  const deps = await depsForShop(shop);
  return { ...deps, repo: prismaRepo, settings: getSettings(), now: () => new Date(), approvalUrl: approvalUrlFor };
}

/** Everything the approval panel in the app needs for one run. */
export async function approvalPanelData(shop, runId, grantedScopes) {
  if (!runId) return null;
  const ctx = await loadApprovalContext({ repo: prismaRepo, shop, runId, now: new Date() });
  if (!ctx) return null;
  const settings = getSettings();
  const { storeUpdates } = await getShopLabelSetting(shop);
  const guard = applyGuard({ settings, shop, grantedScopes, runSucceeded: true, storeUpdates });
  const changes = ctx.run.applyStatus ? await prismaRepo.tagChangesForRun(runId) : [];
  const view = ctx.run.result ? tagListView(ctx.run.result, { changes }) : null;
  // Nothing to change: no approval needed, the store already matches the list.
  const nothingToDo = ctx.state.state === "pending" && view && view.totals.waiting === 0;
  return {
    runId,
    state: nothingToDo ? "nothing" : ctx.state.state,
    label: nothingToDo ? "No changes needed" : APPROVAL_STATES[ctx.state.state].label,
    tone: nothingToDo ? "success" : APPROVAL_STATES[ctx.state.state].tone,
    reason: nothingToDo ? `Every selected product already has ${view.tag} and nothing has to be removed. No approval is needed.` : ctx.state.reason ?? null,
    canApprove: nothingToDo ? false : ctx.state.canApprove,
    canReject: nothingToDo ? false : ctx.state.canReject,
    canApply: ctx.state.canApply,
    expiresAt: ctx.state.expiresAt?.toISOString() ?? null,
    decisions: ctx.approvals.map((a) => ({ decision: a.decision, via: a.via, by: a.by, note: a.note, at: a.at.toISOString() })),
    updatesAllowed: guard.allowed,
    blockedReasons: guard.reasons,
    applySummary: ctx.run.applySummary ?? null,
    counts: view ? { add: view.totals.willGet, remove: view.totals.willLose, keep: view.totals.staying, tag: view.tag } : null,
    approvalUrl: approvalUrlFor({ ...ctx.run, shop }),
  };
}

export async function decideFromApp({ shop, runId, decision, by, note }) {
  const deps = await approvalDeps(shop);
  const outcome = await decideRun({ shop, runId, decision, via: "app", by, note, deps });
  return withoutPromise(outcome);
}

export async function applyFromApp({ shop, runId, by }) {
  const deps = await approvalDeps(shop);
  const outcome = await startApprovedApply({ shop, runId, requestedBy: by, deps });
  return withoutPromise(outcome);
}

/** Reads a token from the email link. Returns { ok, ctx, shop } or { ok: false, reason }. */
export async function loadFromToken(token) {
  const verified = verifyApprovalToken(token, approvalSecret());
  if (!verified.ok) return verified;
  const ctx = await loadApprovalContext({ repo: prismaRepo, shop: verified.shop, runId: verified.runId, now: new Date() });
  if (!ctx || !String(ctx.run.resultHash ?? "").startsWith(verified.hashPrefix)) {
    return { ok: false, reason: "This link does not match a list in the app." };
  }
  return { ok: true, ctx, shop: verified.shop };
}

export async function decideFromEmail({ token, decision, by, note }) {
  const loaded = await loadFromToken(token);
  if (!loaded.ok) return { ok: false, error: loaded.reason };
  const deps = await approvalDeps(loaded.shop);
  const outcome = await decideRun({
    shop: loaded.shop,
    runId: loaded.ctx.run.id,
    decision,
    via: "email",
    by: by ? `${by} (email link)` : "email link",
    note,
    deps,
  });
  return withoutPromise(outcome);
}

/**
 * The undo card for one update (default: the latest update that changed the
 * store). Returns null when the update changed nothing.
 * grantedScopes: the session's scopes (null on the public email page; then
 * the offline session's scopes are used).
 */
export async function undoPanelData(shop, grantedScopes, runId = null) {
  const id = runId ?? (await prismaRepo.latestAppliedRunId(shop));
  if (!id) return null;
  const ctx = await loadUndoContext({ repo: prismaRepo, shop, runId: id });
  if (!ctx || ctx.state.state === "none") return null;
  const scopes = grantedScopes ?? (await offlineScopes(shop));
  const { storeUpdates } = await getShopLabelSetting(shop);
  const guard = applyGuard({ settings: getSettings(), shop, grantedScopes: scopes, runSucceeded: true, storeUpdates });
  const undo = ctx.run.applySummary?.undo ?? null;
  const meta = UNDO_STATES[ctx.state.state];
  return {
    runId: id,
    localDate: ctx.run.localDate,
    tag: ctx.run.result?.config?.bestsellerTag ?? ctx.run.labelTag ?? "",
    appliedAt: formatLocal(ctx.run.appliedAt),
    approvedBy: ctx.run.applySummary?.approvedBy ?? null,
    state: ctx.state.state,
    label: meta.label,
    tone: meta.tone,
    reason: ctx.state.reason,
    canUndo: ctx.state.canUndo && guard.allowed,
    blockedReasons: ctx.state.canUndo && !guard.allowed ? guard.reasons : [],
    progress: ctx.state.progress,
    undoneAt: formatLocal(undo?.at ?? null),
    undoneBy: undo?.by ?? null,
    undoneVia: undo?.via ?? null,
    paused: Boolean(undo?.paused),
    error: undo?.error ?? null,
  };
}

/**
 * Starts "Undo this update". pause: also switch automatic updates to manual
 * approval, so the next nightly update does not make the same changes again.
 */
async function undo({ shop, runId, by, via, note, pause }) {
  const deps = await approvalDeps(shop);
  const paused = Boolean(pause) && (await getShopApprovalMode(shop)) === "automatic";
  const outcome = await startUndo({ shop, runId, requestedBy: by, via, note, paused, deps });
  if (outcome.started) {
    outcome.done.catch?.(() => {});
    if (paused) await saveShopApprovalMode(shop, "manual", `${by ?? "app user"} (paused with the undo)`);
  }
  return { started: outcome.started, reasons: outcome.reasons ?? [], paused: outcome.started && paused };
}

export async function undoFromApp({ shop, runId, by, note, pause }) {
  return undo({ shop, runId, by, via: "app", note, pause });
}

export async function undoFromEmail({ token, by, note, pause }) {
  const loaded = await loadFromToken(token);
  if (!loaded.ok) return { started: false, reasons: [loaded.reason] };
  return undo({ shop: loaded.shop, runId: loaded.ctx.run.id, by: by ? `${by} (email link)` : "email link", via: "email", note, pause });
}

/** Scopes of the shop's offline session (read only; used by the public email page). */
async function offlineScopes(shop) {
  const session = await prisma.session.findFirst({ where: { shop, isOnline: false }, select: { scope: true } });
  return session?.scope ?? "";
}

function withoutPromise(outcome) {
  // The apply keeps running in the background; never send the promise to the client.
  const { done, ...rest } = outcome;
  done?.catch?.(() => {});
  if (rest.apply?.done) rest.apply = { started: rest.apply.started, reasons: rest.apply.reasons ?? [] };
  return rest;
}
