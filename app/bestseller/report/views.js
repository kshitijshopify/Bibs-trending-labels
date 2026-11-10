// Simple, client-friendly views of a run result. Pure functions.

/** Short reason shown next to a product that will carry the tag. */
export function shortKeepReason(product, category) {
  if (product.pickedAs === "launch-reserved") return `New launch ${category.launch.chosenSeason}`;
  return product.isLaunch
    ? `Best seller #${product.overallRank} · new launch ${category.launch.chosenSeason}`
    : `Best seller #${product.overallRank}`;
}

/** Short reason shown next to a product that will lose the tag. */
export function shortRemoveReason(product, category) {
  if (product.bulkReasons?.length) return "Bulk product";
  if (product.status && product.status !== "ACTIVE") return `Not active (${product.status.toLowerCase()})`;
  return product.overallRank ? `Not in the top ${category.total} anymore (#${product.overallRank})` : `Not in the top ${category.total} anymore`;
}

const line = (p) => ({
  id: p.id,
  legacyId: p.legacyId,
  title: p.title,
  productType: p.productType,
  status: p.status,
  netUnits: p.netUnits ?? 0,
});

/** Status of one product in the tag list, with its badge. */
export const ITEM_STATES = {
  new: { label: "Gets the tag", tone: "info", group: "waiting" },
  already: { label: "Already tagged", tone: "neutral", group: "nochange" },
  added: { label: "Tag added", tone: "success", group: "done" },
  pending_remove: { label: "Loses the tag", tone: "warning", group: "waiting" },
  removed: { label: "Tag removed", tone: "success", group: "done" },
  skipped: { label: "Skipped", tone: "neutral", group: "problem" },
  failed: { label: "Failed", tone: "critical", group: "problem" },
  review: { label: "Check manually", tone: "warning", group: "review" },
  undone: { label: "Change undone", tone: "warning", group: "undone" },
};

const ADD_OUTCOME = { APPLIED: "added", NOOP: "already", SKIPPED: "skipped", FAILED: "failed" };
const REMOVE_OUTCOME = { APPLIED: "removed", NOOP: "removed", SKIPPED: "skipped", FAILED: "failed" };
// After "Undo this update": the product is back in its earlier state.
const UNDO_OUTCOME = { APPLIED: "undone", NOOP: "undone", SKIPPED: "skipped", FAILED: "failed" };
const stateOf = (change, outcomes) => (String(change.action).startsWith("undo_") ? UNDO_OUTCOME : outcomes)[change.status];

/**
 * The tag list: per category, which products carry the tag and which lose it,
 * with each product's status. When the list has been applied, the outcome of
 * every change (added / removed / skipped / failed) replaces "waiting".
 *
 * options.changes: tag changes recorded for this run (apply outcomes)
 * options.members: stored list members (for "in the list since")
 */
export function tagListView(result, { changes = [], members = [], appliedAt = null } = {}) {
  const changeById = new Map(changes.map((c) => [c.productId, c]));
  const sinceById = new Map(members.map((m) => [m.productId, m.since ? new Date(m.since).toISOString() : null]));
  const outcome = (p, action) => {
    const change = changeById.get(p.id);
    return change && (change.action === action || change.action === `undo_${action}`) ? change : null;
  };
  const lose = (p, c) => {
    const change = outcome(p, "remove");
    return {
      ...line(p),
      state: change ? stateOf(change, REMOVE_OUTCOME) ?? "pending_remove" : "pending_remove",
      changedAt: change?.createdAt ? new Date(change.createdAt).toISOString() : null,
      message: change?.status === "SKIPPED" || change?.status === "FAILED" ? change.message ?? null : null,
      why: c ? shortRemoveReason(p, c) : "Bulk product",
    };
  };

  const categories = result.categories.map((c) => {
    const willHave = c.selected.map((p) => {
      const change = outcome(p, "add");
      const state = p.labeled ? "already" : change ? stateOf(change, ADD_OUTCOME) ?? "new" : "new";
      return {
        ...line(p),
        position: p.position,
        state,
        since: sinceById.get(p.id) ?? null,
        changedAt: change?.createdAt ? new Date(change.createdAt).toISOString() : null,
        message: change?.status === "SKIPPED" || change?.status === "FAILED" ? change.message ?? null : null,
        why: shortKeepReason(p, c),
      };
    });
    const willLose = c.wouldRemove.map((p) => lose(p, c));
    const waiting = [...willHave, ...willLose].filter((p) => ITEM_STATES[p.state].group === "waiting").length;
    const undone = [...willHave, ...willLose].filter((p) => p.state === "undone").length;
    return {
      key: c.key,
      name: c.name,
      total: c.total,
      shortfall: c.shortfall,
      season: c.launch.chosenSeason,
      seasonSource: c.launch.source,
      willHave,
      willLose,
      waiting,
      undone,
      upToDate: waiting === 0 && undone === 0 && ![...willHave, ...willLose].some((p) => ITEM_STATES[p.state].group === "problem"),
    };
  });

  const cleanup = result.cleanup.map((p) => lose(p, null));
  const review = result.review.map((p) => ({
    ...line(p),
    state: "review",
    why: `Product type “${p.productType || "none"}” is not in a category`,
  }));

  const all = [...categories.flatMap((c) => [...c.willHave, ...c.willLose]), ...cleanup];
  const count = (state) => all.filter((p) => p.state === state).length;
  const lostStillTagged = [...categories.flatMap((c) => c.willLose), ...cleanup].filter((p) => p.state !== "removed").length;
  const totals = {
    willGet: count("new"),
    willLose: count("pending_remove"),
    staying: count("already"),
    added: count("added"),
    removed: count("removed"),
    problems: count("skipped") + count("failed"),
    undone: count("undone"),
    toCheck: review.length,
    taggedNow: count("already") + count("added") + review.length + lostStillTagged,
    afterApproval: categories.reduce((n, c) => n + c.willHave.length, 0) + review.length,
  };
  totals.waiting = totals.willGet + totals.willLose;
  totals.upToDate = totals.waiting === 0 && totals.problems === 0 && totals.undone === 0;

  return {
    tag: result.config.bestsellerTag,
    window: { startDate: result.window.startDate, endDate: result.window.endDate, label: result.window.label, days: result.window.days ?? 30 },
    appliedAt: appliedAt ? new Date(appliedAt).toISOString() : null,
    totals,
    categories,
    cleanup,
    review,
  };
}

/** "Fri 7 Nov, 02:00" in the given zone for the next nightly run. */
export function nextNightlyRunLabel(now, { timeZone, targetHour }) {
  const local = (date) =>
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(date);
  const hour = Number(local(now));
  const dayOffset = hour < targetHour ? 0 : 1;
  const target = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short" }).format(target);
  return `${day}, ${String(targetHour).padStart(2, "0")}:00`;
}
