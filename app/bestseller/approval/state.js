// Approval state of a run. Pure.
//
// Rules:
//  - only a successful preview run can be approved or rejected, once
//  - only the NEWEST successful run can be approved (older lists are stale)
//  - approval must happen within APPROVAL_MAX_AGE_HOURS of the run
//  - an approved run can be applied once; applying re-checks every product
//  - an applied run can be undone (apply/undo.js); after that it is final

export const APPROVAL_MAX_AGE_HOURS = 48;

export const APPROVAL_STATES = {
  pending: { label: "Waiting for approval", tone: "attention" },
  approved: { label: "Approved, not applied yet", tone: "info" },
  applying: { label: "Applying changes…", tone: "info" },
  applied: { label: "Applied in the store", tone: "success" },
  undoing: { label: "Undoing changes…", tone: "info" },
  undone: { label: "Changes undone", tone: "warning" },
  rejected: { label: "Rejected", tone: "critical" },
  superseded: { label: "Replaced by a newer list", tone: "neutral" },
  expired: { label: "Approval window has passed", tone: "neutral" },
  unavailable: { label: "Cannot be approved", tone: "neutral" },
};

export function approvalState({ run, latestSucceededId, approvals = [], now = new Date(), maxAgeHours = APPROVAL_MAX_AGE_HOURS }) {
  const decision = approvals.find((a) => a.decision === "approved" || a.decision === "rejected") ?? null;
  const base = { decision, canApprove: false, canReject: false, canApply: false };
  const isLatest = run.id === latestSucceededId;
  const finished = run.finishedAt ? new Date(run.finishedAt) : null;
  const fresh = Boolean(finished) && now.getTime() - finished.getTime() <= maxAgeHours * 3600 * 1000;
  const expiresAt = finished ? new Date(finished.getTime() + maxAgeHours * 3600 * 1000) : null;

  if (run.status !== "SUCCEEDED") {
    return { ...base, state: "unavailable", reason: "This run did not finish with complete data.", expiresAt };
  }
  if (run.applyStatus === "UNDOING") return { ...base, state: "undoing", expiresAt };
  if (run.applyStatus === "UNDONE" || run.applyStatus === "UNDO_FAILED") return { ...base, state: "undone", expiresAt };
  if (run.applyStatus === "DONE") return { ...base, state: "applied", expiresAt };
  if (run.applyStatus === "RUNNING") return { ...base, state: "applying", expiresAt };
  if (decision?.decision === "rejected") return { ...base, state: "rejected", expiresAt };
  if (decision?.decision === "approved") {
    const canApply = isLatest && fresh;
    return {
      ...base,
      state: "approved",
      canApply,
      reason: canApply ? null : isLatest ? "The approval is older than 48 hours; approve the newest list again." : "A newer list exists.",
      expiresAt,
    };
  }
  if (!isLatest) return { ...base, state: "superseded", reason: "A newer list exists; please approve that one.", expiresAt };
  if (!fresh) return { ...base, state: "expired", reason: "This list is older than 48 hours. Run an update first.", expiresAt };
  return { ...base, state: "pending", canApprove: true, canReject: true, expiresAt };
}
