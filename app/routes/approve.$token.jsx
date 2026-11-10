// Public page opened from the email link: approve or reject a waiting list,
// or undo an update that was applied (automatic mode emails link here too).
// Opening the link changes nothing; every action needs a button click (POST),
// so email security scanners that open links cannot approve or undo anything.
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { APPROVAL_STATES } from "../bestseller/approval/state";
import { decideFromEmail, loadFromToken, undoFromEmail, undoPanelData } from "../bestseller/approval/approval.server";
import { tagListView } from "../bestseller/report/views";
import { getShopApprovalMode } from "../bestseller/settings.server";

export const meta = () => [{ title: "Bestseller list" }, { name: "robots", content: "noindex" }];

export const loader = async ({ params }) => {
  const loaded = await loadFromToken(params.token);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };
  const { ctx, shop } = loaded;
  const view = ctx.run.result ? tagListView(ctx.run.result) : null;
  const [undo, approvalMode] = await Promise.all([undoPanelData(shop, null, ctx.run.id), getShopApprovalMode(shop)]);
  return {
    ok: true,
    shop,
    approvalMode,
    undo: undo
      ? {
          state: undo.state,
          label: undo.label,
          canUndo: undo.canUndo,
          reason: undo.reason,
          blocked: undo.blockedReasons.length > 0,
          progress: undo.progress,
          undoneAt: undo.undoneAt,
          undoneBy: undo.undoneBy,
          paused: undo.paused,
        }
      : null,
    localDate: ctx.run.localDate,
    state: ctx.state.state,
    stateLabel: APPROVAL_STATES[ctx.state.state].label,
    reason: ctx.state.reason ?? null,
    canDecide: ctx.state.canApprove,
    decisions: ctx.approvals.map((a) => ({ decision: a.decision, via: a.via, by: a.by, at: a.at.toISOString() })),
    applySummary: ctx.run.applySummary ?? null,
    view: view
      ? {
          tag: view.tag,
          window: view.window.label,
          totals: view.totals,
          categories: view.categories.map((c) => ({
            name: c.name,
            season: c.season,
            add: c.willHave.filter((p) => p.state === "new").map((p) => `${p.title} (${p.netUnits})`),
            remove: c.willLose.map((p) => `${p.title}: ${p.why}`),
            keep: c.willHave.filter((p) => p.state === "already").length,
          })),
          cleanup: view.cleanup.map((p) => p.title),
        }
      : null,
  };
};

export const action = async ({ request, params }) => {
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim().slice(0, 120);
  const note = String(form.get("note") ?? "").trim().slice(0, 500) || null;
  if (!name) return { ok: false, error: "Please enter your name so the decision can be recorded." };
  if (form.get("decision") === "undo") {
    const outcome = await undoFromEmail({ token: params.token, by: name, note, pause: form.get("pause") === "on" });
    if (!outcome.started) return { ok: false, error: `The update was not undone: ${outcome.reasons.join("; ")}` };
    return {
      ok: true,
      message: `Thank you. The update is being undone now${
        outcome.paused ? " and automatic updates are paused, so the next nightly update waits for approval" : ""
      }. You can follow it under History in the app.`,
    };
  }
  const decision = form.get("decision") === "approve" ? "approved" : "rejected";
  const outcome = await decideFromEmail({ token: params.token, decision, by: name, note });
  if (!outcome.ok) return outcome;
  if (decision === "rejected") return { ok: true, message: "Thank you. The list was rejected; nothing was changed in the store." };
  return {
    ok: true,
    message: outcome.apply?.started
      ? "Thank you. The list is approved and the changes are being applied now. You can follow them under History in the app."
      : "Thank you. Your approval is recorded. The store will be updated once updates are switched on.",
  };
};

const page = {
  fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'San Francisco', 'Segoe UI', Roboto, sans-serif",
  maxWidth: 720,
  margin: "0 auto",
  padding: "40px 16px",
  color: "#303030",
  fontSize: 14,
  lineHeight: 1.5,
};
const card = { borderRadius: 12, padding: 16, margin: "16px 0", background: "#fff", boxShadow: "0 1px 0 rgba(26,26,26,0.07), 0 0 0 1px rgba(26,26,26,0.06)" };
const button = (primary) => ({
  padding: "10px 18px",
  borderRadius: 8,
  border: primary ? "0" : "1px solid #d4d4d4",
  background: primary ? "#303030" : "#fff",
  color: primary ? "#fff" : "#303030",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
  marginRight: 8,
});
const input = { width: "100%", padding: "8px 12px", border: "1px solid #8a8a8a", borderRadius: 8, marginTop: 4, boxSizing: "border-box", fontSize: 14 };

export default function ApprovePage() {
  const data = useLoaderData();
  const result = useActionData();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  if (!data.ok) {
    return (
      <main style={page}>
        <h1>Bestseller list</h1>
        <div style={card}>{data.reason}</div>
      </main>
    );
  }

  const v = data.view;
  const applied = ["applied", "undoing", "undone"].includes(data.state);
  const u = data.undo;
  return (
    <main style={page}>
      <h1 style={{ marginBottom: 4, fontSize: 20, fontWeight: 650 }}>
        {applied ? `Review the ${v?.tag ?? "bestseller"} update` : `Approve the ${v?.tag ?? "bestseller"} list`}
      </h1>
      <p style={{ marginTop: 0, color: "#616161" }}>{`${data.shop} · list from ${data.localDate} · ${v?.window ?? ""}`}</p>

      <div style={card}>
        <strong>Status: {data.stateLabel}</strong>
        {data.reason ? <p>{data.reason}</p> : null}
        {data.decisions.map((d) => (
          <p key={d.at} style={{ color: "#616161", margin: "4px 0" }}>
            {`${d.decision === "approved" ? "Approved" : "Rejected"}${d.by ? ` by ${d.by}` : ""} on ${new Date(d.at).toLocaleString()}`}
          </p>
        ))}
        {data.applySummary && !data.applySummary.blocked && !data.applySummary.error ? (
          <p>{`${data.applySummary.applied} change(s) made in the store.`}</p>
        ) : null}
        {u && (u.state === "undone" || u.state === "partly") ? (
          <p>{`Undone${u.undoneAt ? ` on ${u.undoneAt}` : ""}${u.undoneBy ? ` by ${u.undoneBy}` : ""}: ${u.progress.reversed} change(s) reversed.`}</p>
        ) : null}
        {u?.paused && data.approvalMode === "manual" ? (
          <p>Automatic updates are paused: the next nightly update waits for approval. Switch back in the app under Settings.</p>
        ) : null}
      </div>

      {v ? (
        <div style={card}>
          <p style={{ marginTop: 0 }}>
            {applied
              ? `This update: ${v.totals.willGet} product(s) got ${v.tag}, ${v.totals.willLose} lost it, ${v.totals.staying} kept it. All other tags stayed as they were.`
              : `After approval: ${v.totals.willGet} product(s) get ${v.tag}, ${v.totals.willLose} lose it, ${v.totals.staying} keep it. All other tags stay as they are.`}
          </p>
          {v.categories.map((c) => (
            <div key={c.name} style={{ marginTop: 12 }}>
              <strong>{`${c.name}${c.season ? ` · newest launch ${c.season}` : ""}`}</strong>
              <div style={{ color: "#616161" }}>{`${c.keep} keep the tag`}</div>
              {c.add.length ? <div>{`${applied ? "Got" : "Get"} the tag: ${c.add.join(", ")}`}</div> : null}
              {c.remove.length ? <div>{`${applied ? "Lost" : "Lose"} the tag: ${c.remove.join("; ")}`}</div> : null}
            </div>
          ))}
          {v.cleanup.length ? <div style={{ marginTop: 12 }}>{`Bulk products losing the tag: ${v.cleanup.join(", ")}`}</div> : null}
        </div>
      ) : null}

      {result?.ok ? (
        <div style={{ ...card, background: "#cdfee1" }}>{result.message}</div>
      ) : data.canDecide ? (
        <Form method="post" style={card}>
          {result?.ok === false ? <p style={{ color: "#8e1f0b" }}>{result.error}</p> : null}
          <label htmlFor="approver-name">Your name</label>
          <input id="approver-name" name="name" required style={input} autoComplete="name" />
          <label htmlFor="approver-note" style={{ display: "block", marginTop: 12 }}>
            Note (optional)
          </label>
          <input id="approver-note" name="note" style={input} />
          <div style={{ marginTop: 16 }}>
            <button type="submit" name="decision" value="approve" style={button(true)} disabled={busy}>
              Approve
            </button>
            <button type="submit" name="decision" value="reject" style={button(false)} disabled={busy}>
              Reject
            </button>
          </div>
        </Form>
      ) : u?.canUndo ? (
        <Form method="post" style={card}>
          <strong>Spotted a mistake?</strong>
          <p style={{ marginTop: 4 }}>
            {`Undo puts ${v?.tag ?? "the tag"} back the way it was before this update: it is removed from the ${u.progress.added} product(s) that got it and put back on the ${u.progress.removed} that lost it. Other tags are not touched.`}
          </p>
          {result?.ok === false ? <p style={{ color: "#8e1f0b" }}>{result.error}</p> : null}
          <label htmlFor="undo-name">Your name</label>
          <input id="undo-name" name="name" required style={input} autoComplete="name" />
          <label htmlFor="undo-note" style={{ display: "block", marginTop: 12 }}>
            What was wrong? (optional)
          </label>
          <input id="undo-note" name="note" style={input} />
          {data.approvalMode === "automatic" ? (
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12 }}>
              <input type="checkbox" name="pause" defaultChecked style={{ marginTop: 3 }} />
              <span>Pause automatic updates, so the next nightly update waits for approval and does not make the same changes again.</span>
            </label>
          ) : null}
          <div style={{ marginTop: 16 }}>
            <button type="submit" name="decision" value="undo" style={{ ...button(true), background: "#8e1f0b" }} disabled={busy}>
              Undo this update
            </button>
          </div>
        </Form>
      ) : u?.reason && u.state !== "undone" ? (
        <div style={card}>{u.reason}</div>
      ) : u?.blocked ? (
        <div style={card}>Store updates are switched off, so the update cannot be undone from here.</div>
      ) : null}
    </main>
  );
}
