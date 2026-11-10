// Undo of one applied update: puts the label tag back the way it was before
// that update. Same safety as applying:
//  - every product is read again first; only the label tag is touched
//    (tagsAdd / tagsRemove, never productUpdate), all other tags stay
//  - a tag that was removed is put back with its exact spelling
//  - products that are already back in their earlier state are left alone,
//    so an interrupted or failed undo can simply be run again
//  - Bulk products never get the tag back
//  - only the latest update that changed the store can be undone

import { DEFAULT_CONFIG } from "../config.js";
import { bestsellerTagsOn, bulkReasons } from "../engine/products.js";
import { toEngineProduct } from "../shopify/catalog.js";
import { PRODUCT_FOR_APPLY, TAGS_ADD, TAGS_REMOVE } from "../shopify/queries.js";
import { mutateTags, planTagChanges } from "./apply.js";

export const UNDO_ACTION = { add: "undo_add", remove: "undo_remove" };

/** Undo outcomes that need no further attempt. FAILED can be retried. */
const SETTLED = new Set(["APPLIED", "NOOP", "SKIPPED"]);

export const UNDO_STATES = {
  available: { label: "Can be undone", tone: "info" },
  undoing: { label: "Undoing…", tone: "info" },
  undone: { label: "Undone", tone: "warning" },
  partly: { label: "Partly undone", tone: "warning" },
  locked: { label: "Can no longer be undone", tone: "neutral" },
  none: { label: "Nothing to undo", tone: "neutral" },
};

const isUndo = (change) => String(change.action).startsWith("undo_");

function tagList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Store changes the update made (one per product, the last applied one wins). */
function appliedChanges(changes) {
  const byProduct = new Map();
  for (const change of changes) {
    if (!isUndo(change) && change.status === "APPLIED") byProduct.set(change.productId, change);
  }
  return [...byProduct.values()];
}

/** Latest undo attempt per product. */
function latestUndoByProduct(changes) {
  return new Map(changes.filter(isUndo).map((c) => [c.productId, c]));
}

/** Applied changes that still have to be reversed. */
export function pendingUndo(changes) {
  const undone = latestUndoByProduct(changes);
  return appliedChanges(changes).filter((c) => !SETTLED.has(undone.get(c.productId)?.status));
}

/**
 * Whether an update (run) can be undone. Pure.
 * latestAppliedId: the newest run of the shop that changed (or tried to change) the store.
 */
export function undoState({ run, latestAppliedId, changes = [] }) {
  const applied = appliedChanges(changes);
  const undone = latestUndoByProduct(changes);
  const outcome = (status) => applied.filter((c) => undone.get(c.productId)?.status === status).length;
  const remaining = applied.filter((c) => !SETTLED.has(undone.get(c.productId)?.status));
  const progress = {
    added: applied.filter((c) => c.action === "add").length,
    removed: applied.filter((c) => c.action === "remove").length,
    reversed: outcome("APPLIED"),
    alreadyBack: outcome("NOOP"),
    skipped: outcome("SKIPPED"),
    failed: outcome("FAILED"),
    remaining: remaining.length,
  };
  const base = { progress, canUndo: false, reason: null };
  const touched = undone.size > 0 || run.applyStatus === "UNDONE" || run.applyStatus === "UNDO_FAILED";

  if (run.status !== "SUCCEEDED" || applied.length === 0) return { ...base, state: "none" };
  if (run.applyStatus === "UNDOING") return { ...base, state: "undoing" };
  if (run.applyStatus === "RUNNING") return { ...base, state: "locked", reason: "The changes are still being applied." };
  if (touched && remaining.length === 0) return { ...base, state: "undone" };
  if (run.id !== latestAppliedId) {
    return {
      ...base,
      state: touched ? "partly" : "locked",
      reason: "A newer update has changed the store since. Only the latest update can be undone.",
    };
  }
  if (touched) {
    return { ...base, state: "partly", canUndo: true, reason: `${remaining.length} change(s) could not be undone yet. You can try again.` };
  }
  return { ...base, state: "available", canUndo: true };
}

/** One line for the history and the toast. */
export function undoStatusText(summary, { by = null, via = "app", paused = false } = {}) {
  const parts = [
    `${summary.reversed} change(s) reversed`,
    summary.noop ? `${summary.noop} already back` : null,
    summary.skipped ? `${summary.skipped} skipped` : null,
    summary.failed ? `${summary.failed} failed` : null,
  ].filter(Boolean);
  const who = `${via === "email" ? " with the email link" : " in the app"}${by ? ` by ${by}` : ""}`;
  return `Undone${who}: ${parts.join(", ")}${paused ? " · automatic updates paused" : ""}`;
}

/**
 * Reverses the applied changes of one run that are not reversed yet.
 * Records every attempt as a tag change (undo_add / undo_remove) and every
 * store change as a history event.
 */
export async function undoRunChanges({ graphql, run, changes, shop, repo, by = null, log = () => {} }) {
  const config = { ...DEFAULT_CONFIG, ...(run.result?.config ?? {}) };
  const tag = config.bestsellerTag;
  const info = new Map((run.result ? planTagChanges(run.result) : []).map((item) => [item.productId, item]));
  const todo = pendingUndo(changes).reverse();
  const summary = { planned: todo.length, reversed: 0, noop: 0, skipped: 0, failed: 0 };
  log("info", "Undoing tag changes", { planned: todo.length, tag });

  for (const change of todo) {
    const action = UNDO_ACTION[change.action];
    const meta = info.get(change.productId) ?? {};
    const record = (status, extra = {}) =>
      repo.recordTagChange(run.id, { productId: change.productId, action, scope: change.scope, status, ...extra });
    let before = null;
    try {
      const data = await graphql(PRODUCT_FOR_APPLY, { id: change.productId });
      if (!data?.product) {
        summary.skipped += 1;
        await record("SKIPPED", { message: "product no longer exists" });
        continue;
      }
      const product = toEngineProduct(data.product);
      before = product.tags;
      const labels = bestsellerTagsOn(product, tag);
      let after;

      if (change.action === "add") {
        // The update added the tag: take it off again.
        if (labels.length === 0) {
          summary.noop += 1;
          await record("NOOP", { tagsBefore: before, tagsAfter: before, message: "tag was already removed" });
          continue;
        }
        after = await mutateTags(graphql, TAGS_REMOVE, "tagsRemove", product.id, labels);
      } else {
        // The update removed the tag: put back the exact tag it removed.
        if (labels.length > 0) {
          summary.noop += 1;
          await record("NOOP", { tagsBefore: before, tagsAfter: before, message: "tag is already back" });
          continue;
        }
        if (bulkReasons(product, config.bulk).length > 0) {
          summary.skipped += 1;
          await record("SKIPPED", { tagsBefore: before, message: "Bulk product: Bulk products never get the tag" });
          continue;
        }
        const removed = bestsellerTagsOn({ tags: tagList(change.tagsBefore) ?? [] }, tag);
        after = await mutateTags(graphql, TAGS_ADD, "tagsAdd", product.id, removed.length ? removed : [tag]);
      }

      summary.reversed += 1;
      await record("APPLIED", { tagsBefore: before, tagsAfter: after });
      await repo.recordEvents(shop, [
        {
          kind: change.action === "add" ? "tag_removed" : "tag_added",
          tag,
          runId: run.id,
          localDate: run.localDate,
          productId: change.productId,
          legacyId: meta.legacyId ?? product.legacyId,
          title: meta.title ?? product.title,
          category: meta.categoryName ?? null,
          netUnits: meta.netUnits ?? null,
          detail: `Undo of the update from ${run.localDate}${by ? ` by ${by}` : ""}`,
        },
      ]);
    } catch (error) {
      summary.failed += 1;
      log("error", "Undo failed for a product", { productId: change.productId, message: error.message });
      await record("FAILED", { tagsBefore: before, message: error.message });
    }
  }

  log("info", "Undo finished", summary);
  return summary;
}
