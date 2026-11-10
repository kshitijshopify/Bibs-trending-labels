import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { applyFromApp, decideFromApp, undoFromApp } from "../bestseller/approval/approval.server";

/** POST-only endpoint for the approval and undo panels (approve / reject / apply / undo). */
export const loader = () => redirect("/app");

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const runId = String(form.get("runId") ?? "");
  const note = String(form.get("note") ?? "").trim().slice(0, 500) || null;
  const by = session.onlineAccessInfo?.associated_user?.email ?? "app user";

  if (intent === "approve" || intent === "reject") {
    const outcome = await decideFromApp({ shop: session.shop, runId, decision: intent === "approve" ? "approved" : "rejected", by, note });
    if (!outcome.ok) return outcome;
    if (intent === "reject") return { ok: true, message: "List rejected. Nothing was changed." };
    return {
      ok: true,
      message: outcome.apply?.started
        ? "Applying the changes now. This page updates when it is done."
        : `Recorded. The store was not changed: ${(outcome.apply?.reasons ?? []).join("; ")}`,
    };
  }

  if (intent === "apply") {
    const outcome = await applyFromApp({ shop: session.shop, runId, by });
    return outcome.started
      ? { ok: true, message: "Applying the approved changes now." }
      : { ok: false, error: `Not applied: ${(outcome.reasons ?? []).join("; ")}` };
  }

  if (intent === "undo") {
    const outcome = await undoFromApp({ shop: session.shop, runId, by, note, pause: form.get("pause") === "true" });
    if (!outcome.started) return { ok: false, error: `Not undone: ${outcome.reasons.join("; ")}` };
    return {
      ok: true,
      message: outcome.paused ? "Undoing the update now. Automatic updates are paused." : "Undoing the update now.",
    };
  }

  return { ok: false, error: "Unknown action." };
};
