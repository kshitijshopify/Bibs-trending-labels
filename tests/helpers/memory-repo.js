/** In-memory job repository with the same interface as repo.server.js. */
export function createMemoryRepo() {
  const runs = new Map();
  const locks = new Map();
  const flowEvents = new Map();
  const tagChanges = [];
  const events = [];
  const approvals = [];
  const members = new Map();
  let seq = 0;

  return {
    runs,
    locks,
    flowEvents,
    tagChanges,
    events,
    approvals,
    members,

    async acquireLock(shop, holder, ttlMs, now) {
      const existing = locks.get(shop);
      if (existing && existing.expiresAt > now) return false;
      locks.set(shop, { holder, expiresAt: new Date(now.getTime() + ttlMs) });
      return true;
    },
    async renewLock(shop, holder, ttlMs, now) {
      const lock = locks.get(shop);
      if (lock?.holder === holder) lock.expiresAt = new Date(now.getTime() + ttlMs);
    },
    async releaseLock(shop, holder) {
      if (locks.get(shop)?.holder === holder) locks.delete(shop);
    },
    async failAbandonedRuns(shop, message) {
      for (const run of runs.values()) {
        if (run.shop === shop && run.applyStatus === "RUNNING") run.applyStatus = "FAILED";
        if (run.shop === shop && run.applyStatus === "UNDOING") run.applyStatus = "UNDO_FAILED";
        if (run.shop === shop && run.status === "RUNNING") {
          run.status = "FAILED";
          run.error = { code: "ABANDONED", message };
        }
      }
    },
    async getRunBasic(shop, id) {
      const run = runs.get(id);
      return run && run.shop === shop ? { ...run } : null;
    },
    async latestSucceededRunId(shop) {
      const done = [...runs.values()].filter((r) => r.shop === shop && r.status === "SUCCEEDED");
      return done.length ? done[done.length - 1].id : null;
    },
    async approvalsForRun(shop, runId) {
      return approvals.filter((a) => a.shop === shop && a.runId === runId);
    },
    async recordApproval(shop, data) {
      approvals.push({ shop, at: new Date(), ...data });
    },
    async createRun(data) {
      seq += 1;
      const run = { id: `run-${seq}`, status: "RUNNING", ...data, startedAt: new Date() };
      runs.set(run.id, run);
      return run;
    },
    async updateRun(id, data) {
      Object.assign(runs.get(id), data);
    },
    async completeRun(id, data) {
      Object.assign(runs.get(id), data, { finishedAt: new Date() });
    },
    async findRunsForLocalDate(shop, localDate, trigger) {
      return [...runs.values()].filter((r) => r.shop === shop && r.localDate === localDate && r.trigger === trigger);
    },
    async recordFlowEvent(runId, eventKey, data) {
      flowEvents.set(`${runId}:${eventKey}`, { runId, eventKey, ...data });
    },
    async sentFlowEventKeys(runId) {
      return [...flowEvents.values()].filter((e) => e.runId === runId && e.status === "SENT").map((e) => e.eventKey);
    },
    async recordTagChange(runId, change) {
      tagChanges.push({ runId, createdAt: new Date(), ...change });
    },
    async saveRunSelection(runId, { labelTag, selection }) {
      Object.assign(runs.get(runId), { labelTag, selection });
    },
    async previousSelection(shop, excludeRunId) {
      const done = [...runs.values()].filter(
        (r) => r.shop === shop && r.status === "SUCCEEDED" && r.selection && r.id !== excludeRunId,
      );
      return done.length ? done[done.length - 1].selection : null;
    },
    async listMembers(shop, tag) {
      return [...members.values()].filter((m) => m.shop === shop && m.tag === tag);
    },
    async saveMembership(shop, tag, { joins, updates, removals, runId }) {
      const key = (id) => `${shop}|${tag}|${id}`;
      for (const m of joins) members.set(key(m.productId), { shop, tag, ...m, sinceRunId: runId, lastSeenRunId: runId });
      for (const m of updates) Object.assign(members.get(key(m.productId)), m, { lastSeenRunId: runId });
      for (const id of removals) members.delete(key(id));
    },
    async tagChangesForRun(runId) {
      return tagChanges.filter((c) => c.runId === runId);
    },
    async latestAppliedRunId(shop) {
      const touched = [...runs.values()].filter((r) => r.shop === shop && r.applyStatus);
      return touched.length ? touched[touched.length - 1].id : null;
    },
    async recordEvents(shop, list) {
      for (const e of list) events.push({ shop, at: new Date(), ...e });
    },
    async listEvents(shop) {
      return events.filter((e) => e.shop === shop).reverse();
    },
  };
}
