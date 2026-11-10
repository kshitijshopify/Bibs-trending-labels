// Change history. Pure functions.
//
// The app keeps the current list per tag (BestsellerListMember). Each run is
// compared with that list, so a product is recorded only when it really
// joins or leaves, never twice in a row:
//   joined  – new in the list, does not have the tag yet
//   already – new in the list, but already carries the tag (no store change)
//   left    – no longer in the list
//   checked – one summary line per run ("No changes" or "2 new, 1 left")
// Applied store changes are recorded as tag_added / tag_removed, also when an
// update is undone ("undone" is the summary line of an undo).

export const EVENT_KINDS = {
  joined: { label: "New in the list", tone: "success" },
  already: { label: "In the list, already tagged", tone: "info" },
  left: { label: "Left the list", tone: "critical" },
  checked: { label: "List checked", tone: "neutral" },
  tag_added: { label: "Tag added in store", tone: "success" },
  tag_removed: { label: "Tag removed in store", tone: "critical" },
  approved: { label: "List approved", tone: "success" },
  rejected: { label: "List rejected", tone: "critical" },
  applied: { label: "Changes applied", tone: "info" },
  undone: { label: "Update undone", tone: "warning" },
  setting: { label: "Setting changed", tone: "info" },
};

const MEMBERSHIP = { joined: "in", already: "in", left: "out" };

/** Compact copy of the selection, stored with each run. */
export function selectionSnapshot(result) {
  return {
    tag: result.config.bestsellerTag,
    categories: result.categories.map((c) => ({
      key: c.key,
      name: c.name,
      season: c.launch.chosenSeason,
      products: c.selected.map((p) => ({
        id: p.id,
        legacyId: p.legacyId,
        title: p.title,
        netUnits: p.netUnits,
        pickedAs: p.pickedAs,
        overallRank: p.overallRank,
      })),
    })),
  };
}

/** Short reason a product is in the list. */
export function joinReason(product, season) {
  if (product.pickedAs === "launch-reserved") return `New launch ${season}`;
  return `Best seller #${product.overallRank} (${product.netUnits} sold)`;
}

/** Short reason a product left the list, looked up in the current result. */
export function leaveReason(productId, category) {
  const removal = category?.wouldRemove?.find((p) => p.id === productId);
  if (removal?.bulkReasons?.length) return "Bulk product";
  if (removal && removal.status !== "ACTIVE") return `Not active (${String(removal.status).toLowerCase()})`;
  const ranked = category?.ranking?.find((p) => p.id === productId);
  if (ranked) return `Dropped to #${ranked.overallRank} (${ranked.netUnits} sold)`;
  return "No longer eligible (inactive, Bulk, deleted or moved to another product type)";
}

/**
 * Compares the run's selection with the stored list members.
 * Returns the history events and the membership changes to save.
 */
export function membershipChanges(members, result, { runId, localDate }) {
  const tag = result.config.bestsellerTag;
  const byId = new Map(members.map((m) => [m.productId, m]));
  const base = { tag, runId, localDate };
  const events = [];
  const joins = [];
  const updates = [];
  const seen = new Set();
  let unchanged = 0;

  for (const category of result.categories) {
    for (const p of category.selected) {
      seen.add(p.id);
      const member = byId.get(p.id);
      const fields = { productId: p.id, legacyId: p.legacyId, title: p.title, category: category.name };
      if (member) {
        unchanged += 1;
        updates.push(fields);
        continue;
      }
      joins.push(fields);
      events.push({
        ...base,
        kind: p.labeled ? "already" : "joined",
        productId: p.id,
        legacyId: p.legacyId,
        title: p.title,
        category: category.name,
        netUnits: p.netUnits,
        detail: `${joinReason(p, category.launch.chosenSeason)} · ${p.labeled ? "already had the tag, nothing to change" : "needs the tag"}`,
      });
    }
  }

  const removals = [];
  for (const member of members) {
    if (seen.has(member.productId)) continue;
    removals.push(member.productId);
    const category = result.categories.find((c) => c.name === member.category);
    const ranked = category?.ranking?.find((r) => r.id === member.productId);
    events.push({
      ...base,
      kind: "left",
      productId: member.productId,
      legacyId: member.legacyId,
      title: member.title,
      category: member.category,
      netUnits: ranked?.netUnits ?? null,
      detail: leaveReason(member.productId, category),
    });
  }

  const joined = events.filter((e) => e.kind === "joined").length;
  const already = events.filter((e) => e.kind === "already").length;
  const left = removals.length;
  const total = unchanged + joins.length;
  const summary =
    joined + already + left === 0
      ? `No changes: all ${total} product(s) stay in the list`
      : [
          joined ? `${joined} new` : null,
          already ? `${already} added to the list (already tagged)` : null,
          left ? `${left} left` : null,
          `${unchanged} unchanged`,
        ]
          .filter(Boolean)
          .join(", ");
  events.push({ ...base, kind: "checked", detail: summary });

  return { events, joins, updates, removals, summary, counts: { joined, already, left, unchanged } };
}

/**
 * Display safety net for older data: drops a membership event that repeats
 * the product's previous state for the same tag (e.g. "joined" twice in a
 * row). Expects events newest first, returns them newest first.
 */
export function collapseHistory(events) {
  const last = new Map();
  const keep = [];
  for (const event of [...events].reverse()) {
    const state = MEMBERSHIP[event.kind];
    if (state && event.productId) {
      const key = `${event.tag}|${event.productId}`;
      if (last.get(key) === state) continue;
      last.set(key, state);
    }
    keep.push(event);
  }
  return keep.reverse();
}
