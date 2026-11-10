import { useEffect, useId, useRef, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { InfoTip, useElementEvent } from "./kit.jsx";
import { UndoPanel } from "./undo-panel.jsx";

const STATE_TONES = { attention: "warning" };
const VIA = { email: "with the email link", automatic: "automatically", app: "in the app" };

/**
 * Approval card for one list (run). Buttons post to /app/approval; the
 * decision is confirmed in a Polaris modal.
 * data: output of approvalPanelData() on the server.
 * undo: output of undoPanelData(); shown inside this card when it is the same update.
 */
export function ApprovalPanel({ data, mode = "manual", nextRun = null, undo = null }) {
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [intent, setIntent] = useState(null);
  const [note, setNote] = useState("");
  const noteRef = useRef(null);
  useElementEvent(noteRef, "input", (event) => setNote(event.target.value ?? ""));
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.ok === false) shopify.toast.show(fetcher.data.error, { isError: true });
    else if (fetcher.data.message) shopify.toast.show(fetcher.data.message);
  }, [fetcher.data, shopify]);

  useEffect(() => {
    if (data?.state !== "applying" && data?.state !== "undoing") return undefined;
    const timer = setInterval(() => revalidator.revalidate(), 3000);
    return () => clearInterval(timer);
  }, [data?.state, revalidator]);

  if (!data) return null;
  const automatic = mode === "automatic";
  const c = data.counts;
  const modalId = `approval-modal-${uid}`;
  const open = (next) => setIntent(next);
  const confirm = () => fetcher.submit({ intent, runId: data.runId, note }, { method: "POST", action: "/app/approval" });

  const summary = c && (c.add || c.remove) ? `${c.add} to add · ${c.remove} to remove · ${c.keep} unchanged` : null;
  const decision = data.decisions[0];
  const modalCopy = {
    approve: {
      heading: automatic ? "Apply changes now?" : data.updatesAllowed ? "Approve and apply changes?" : "Approve this list?",
      body: data.updatesAllowed
        ? `${c?.tag} will be added to ${c?.add} product(s) and removed from ${c?.remove}. Other tags are not changed.`
        : "The approval is recorded. The store is updated once store updates are switched on.",
      action: automatic ? "Apply now" : data.updatesAllowed ? "Approve and apply" : "Approve",
    },
    reject: { heading: "Reject this list?", body: "Nothing is changed in the store. The next update creates a new list.", action: "Reject" },
    apply: { heading: "Apply approved changes?", body: `${c?.tag} will be added to ${c?.add} product(s) and removed from ${c?.remove}.`, action: "Apply changes" },
  }[intent ?? "approve"];

  return (
    <s-section>
      <s-stack gap="base">
        <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
          <s-stack direction="inline" gap="small-300" alignItems="center">
            <s-heading>{automatic ? "Automatic update" : "Approval"}</s-heading>
            <InfoTip>
              {automatic
                ? "Every night the latest list is applied to the store and an email lists every change. Use Apply now to apply the current list right away."
                : "Changes reach the store only after approval, here or with the link in the preview email. Only the newest list can be approved, within 48 hours."}
            </InfoTip>
          </s-stack>
          <s-badge tone={STATE_TONES[data.tone] ?? data.tone}>
            {automatic && data.state === "pending" ? (data.updatesAllowed ? "Applies at the next update" : "Store updates off") : data.label}
          </s-badge>
        </s-stack>

        {summary ? <s-text>{summary}</s-text> : null}
        {automatic && data.state === "pending" ? (
          <s-text color="subdued">
            {data.updatesAllowed
              ? `The changes are applied automatically${nextRun ? ` at the next update (${nextRun})` : " at the next nightly update"}, and an email lists every change.`
              : "Nothing is changed in the store until store updates are switched on."}
          </s-text>
        ) : null}
        {!automatic && data.state === "pending" && data.expiresAt ? (
          <s-text color="subdued">{`Can be approved until ${new Date(data.expiresAt).toLocaleString()}`}</s-text>
        ) : null}
        {data.reason ? <s-text color="subdued">{data.reason}</s-text> : null}
        {decision ? (
          <s-text color="subdued">
            {`${decision.decision === "approved" ? "Approved" : "Rejected"} ${VIA[decision.via] ?? ""}${decision.by ? ` by ${decision.by}` : ""}, ${new Date(decision.at).toLocaleString()}${
              decision.note ? ` · “${decision.note}”` : ""
            }`}
          </s-text>
        ) : null}

        {data.applySummary && !data.applySummary.blocked ? (
          <s-banner tone={data.applySummary.failed || data.applySummary.error ? "warning" : "success"}>
            {data.applySummary.error
              ? `Applying failed: ${data.applySummary.error}. You can try again.`
              : `${data.applySummary.applied} change(s) made, ${data.applySummary.noop} already correct, ${data.applySummary.skipped} skipped, ${data.applySummary.failed} failed.`}
          </s-banner>
        ) : null}

        {!automatic && (data.canApprove || data.canApply) && !data.updatesAllowed ? (
          <s-banner tone="info" heading="Store updates are off">
            <s-paragraph>Approving records the decision only. {data.blockedReasons.join(". ")}.</s-paragraph>
          </s-banner>
        ) : null}

        {automatic ? (
          // Apply now: a waiting list, or a retry after a failed apply.
          (data.canApprove || data.canApply) && data.updatesAllowed ? (
            <s-stack direction="inline" gap="small">
              <s-button variant="primary" commandFor={modalId} command="--show" onClick={() => open(data.canApprove ? "approve" : "apply")}>
                Apply now
              </s-button>
            </s-stack>
          ) : null
        ) : data.canApprove || data.canReject || (data.canApply && data.updatesAllowed) ? (
          <s-stack direction="inline" gap="small">
            {data.canApprove ? (
              <s-button variant="primary" commandFor={modalId} command="--show" onClick={() => open("approve")}>
                {data.updatesAllowed ? "Approve and apply" : "Approve"}
              </s-button>
            ) : null}
            {data.canApply && data.updatesAllowed ? (
              <s-button variant="primary" commandFor={modalId} command="--show" onClick={() => open("apply")}>
                Apply changes
              </s-button>
            ) : null}
            {data.canReject ? (
              <s-button commandFor={modalId} command="--show" onClick={() => open("reject")}>
                Reject
              </s-button>
            ) : null}
          </s-stack>
        ) : null}

        {!automatic && data.approvalUrl && data.state === "pending" ? (
          <s-stack direction="inline" gap="small" alignItems="end">
            <s-box inlineSize="100%" maxInlineSize="520px">
              <s-text-field label="Approval link for email" value={data.approvalUrl} readOnly details="Opens a page with Approve and Reject buttons. Valid for 48 hours." />
            </s-box>
            <s-button
              icon="clipboard"
              onClick={() => {
                navigator.clipboard?.writeText(data.approvalUrl);
                shopify.toast.show("Link copied");
              }}
            >
              Copy
            </s-button>
          </s-stack>
        ) : null}

        {undo && undo.runId === data.runId ? <UndoPanel data={undo} mode={mode} embedded /> : null}
      </s-stack>

      <s-modal id={modalId} heading={modalCopy.heading}>
        <s-stack gap="base">
          <s-paragraph>{modalCopy.body}</s-paragraph>
          <s-text-area ref={noteRef} label="Note (optional)" rows={2} />
        </s-stack>
        <s-button
          slot="primary-action"
          variant="primary"
          {...(intent === "reject" ? { tone: "critical" } : {})}
          {...(busy ? { loading: true } : {})}
          commandFor={modalId}
          command="--hide"
          onClick={confirm}
        >
          {modalCopy.action}
        </s-button>
        <s-button slot="secondary-actions" commandFor={modalId} command="--hide">
          Cancel
        </s-button>
      </s-modal>
    </s-section>
  );
}
