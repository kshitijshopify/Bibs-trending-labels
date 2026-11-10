import { useEffect, useId, useRef, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { InfoTip, useElementEvent } from "./kit.jsx";

/**
 * "Undo this update" for the latest update that changed the store.
 * data: output of undoPanelData() on the server.
 * embedded: rendered inside the approval card of the same update (no own card).
 */
export function UndoPanel({ data, mode = "automatic", embedded = false }) {
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [note, setNote] = useState("");
  const [pause, setPause] = useState(true);
  const noteRef = useRef(null);
  const pauseRef = useRef(null);
  useElementEvent(noteRef, "input", (event) => setNote(event.target.value ?? ""));
  useElementEvent(pauseRef, "change", (event) => setPause(Boolean(event.currentTarget?.checked ?? event.target?.checked)));
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.ok === false) shopify.toast.show(fetcher.data.error, { isError: true });
    else if (fetcher.data.message) shopify.toast.show(fetcher.data.message);
  }, [fetcher.data, shopify]);

  useEffect(() => {
    // The approval card already refreshes the page while it is busy.
    if (embedded || data?.state !== "undoing") return undefined;
    const timer = setInterval(() => revalidator.revalidate(), 3000);
    return () => clearInterval(timer);
  }, [embedded, data?.state, revalidator]);

  if (!data) return null;
  const automatic = mode === "automatic";
  const p = data.progress;
  const modalId = `undo-modal-${uid}`;
  const confirm = () =>
    fetcher.submit({ intent: "undo", runId: data.runId, note, pause: automatic && pause ? "true" : "false" }, { method: "POST", action: "/app/approval" });
  const what = `${p.added} product(s) got ${data.tag} and ${p.removed} lost it`;
  const outcome = [
    `${p.reversed} change(s) reversed`,
    p.alreadyBack ? `${p.alreadyBack} were already back` : null,
    p.skipped ? `${p.skipped} skipped` : null,
    p.failed ? `${p.failed} failed` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const content = (
    <s-stack gap="small">
      {embedded ? null : (
        <s-text>{`${data.appliedAt ? `${data.appliedAt}: ` : ""}${what}${data.approvedBy ? ` (${data.approvedBy === "Automatic mode" ? "automatic" : `approved by ${data.approvedBy}`})` : ""}.`}</s-text>
      )}

      {data.state === "available" ? (
        <s-text color="subdued">
          {`Spotted a mistake in the email? Undo puts ${data.tag} back the way it was before this update. Other tags are not touched.`}
        </s-text>
      ) : null}

      {data.state === "undoing" ? <s-text color="subdued">Undoing the changes…</s-text> : null}

      {data.state === "undone" || data.state === "partly" ? (
        <s-banner tone={data.state === "undone" && !p.failed ? "info" : "warning"} heading={data.state === "undone" ? "This update was undone" : "Partly undone"}>
          <s-paragraph>
            {data.error
              ? `The undo stopped: ${data.error}.`
              : `${data.undoneAt ? `${data.undoneAt}` : "Undone"}${data.undoneBy ? ` by ${data.undoneBy}` : ""}: ${outcome}.`}
            {p.skipped ? " Skipped products are listed in the tag list (status “Skipped or failed”)." : ""}
          </s-paragraph>
        </s-banner>
      ) : null}

      {data.paused && mode === "manual" ? (
        <s-banner tone="warning" heading="Automatic updates are paused">
          <s-paragraph>
            The next nightly update waits for approval, so the undone changes are not made again. Switch back under Settings → Updates once the cause is fixed.
          </s-paragraph>
          <s-button slot="secondary-actions" href="/app/settings">
            Open Settings
          </s-button>
        </s-banner>
      ) : null}

      {data.reason && data.state !== "available" ? <s-text color="subdued">{data.reason}</s-text> : null}

      {data.blockedReasons.length ? (
        <s-banner tone="info" heading="Store updates are off">
          <s-paragraph>{`Undo needs store updates switched on. ${data.blockedReasons.join(". ")}.`}</s-paragraph>
        </s-banner>
      ) : null}

      {data.canUndo ? (
        <s-stack direction="inline" gap="small">
          <s-button tone="critical" commandFor={modalId} command="--show">
            {data.state === "partly" ? "Try the undo again" : "Undo this update"}
          </s-button>
        </s-stack>
      ) : null}
    </s-stack>
  );

  const modal = (
    <s-modal id={modalId} heading="Undo this update?">
      <s-stack gap="base">
        <s-paragraph>
          {`${data.tag} is removed again from the ${p.added} product(s) that got it and put back on the ${p.removed} product(s) that lost it. Other tags are not changed. Each product is checked first; Bulk products never get the tag back.`}
        </s-paragraph>
        {automatic ? (
          <s-checkbox
            ref={pauseRef}
            label="Pause automatic updates"
            details="The next nightly update then waits for approval, so the same changes are not made again. Switch back in Settings."
            {...(pause ? { checked: true } : {})}
          />
        ) : (
          <s-text color="subdued">The next list waits for approval as usual.</s-text>
        )}
        <s-text-area ref={noteRef} label="What was wrong? (optional)" rows={2} />
      </s-stack>
      <s-button
        slot="primary-action"
        variant="primary"
        tone="critical"
        {...(busy ? { loading: true } : {})}
        commandFor={modalId}
        command="--hide"
        onClick={confirm}
      >
        Undo update
      </s-button>
      <s-button slot="secondary-actions" commandFor={modalId} command="--hide">
        Cancel
      </s-button>
    </s-modal>
  );

  if (embedded) {
    return (
      <>
        <s-divider />
        {content}
        {modal}
      </>
    );
  }

  return (
    <s-section>
      <s-stack gap="base">
        <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
          <s-stack direction="inline" gap="small-300" alignItems="center">
            <s-heading>Last store update</s-heading>
            <InfoTip>Only the latest update that changed the store can be undone. The next update recalculates the list as usual.</InfoTip>
          </s-stack>
          <s-badge tone={data.tone}>{data.label}</s-badge>
        </s-stack>
        {content}
      </s-stack>
      {modal}
    </s-section>
  );
}
