import prisma from "../../db.server";

const json = (value) => (value === undefined ? undefined : value === null ? null : JSON.stringify(value));
const parse = (text) => (text ? JSON.parse(text) : null);

/** Prisma (SQLite) implementation of the job repository used by run-job.js. */
export const prismaRepo = {
  /** Shops that have installed the app (offline session; removed on uninstall). */
  async installedShops() {
    const rows = await prisma.session.findMany({
      where: { isOnline: false },
      select: { shop: true },
      distinct: ["shop"],
    });
    return rows.map((r) => r.shop);
  },

  async acquireLock(shop, holder, ttlMs, now) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.bestsellerJobLock.findUnique({ where: { shop } });
      if (existing && existing.expiresAt > now) return false;
      const expiresAt = new Date(now.getTime() + ttlMs);
      await tx.bestsellerJobLock.upsert({
        where: { shop },
        create: { shop, holder, acquiredAt: now, expiresAt },
        update: { holder, acquiredAt: now, expiresAt },
      });
      return true;
    });
  },

  async renewLock(shop, holder, ttlMs, now) {
    await prisma.bestsellerJobLock.updateMany({
      where: { shop, holder },
      data: { expiresAt: new Date(now.getTime() + ttlMs) },
    });
  },

  async releaseLock(shop, holder) {
    await prisma.bestsellerJobLock.deleteMany({ where: { shop, holder } });
  },

  async failAbandonedRuns(shop, message) {
    await prisma.bestsellerRun.updateMany({ where: { shop, applyStatus: "RUNNING" }, data: { applyStatus: "FAILED" } });
    // An interrupted undo can be run again; products already back are skipped.
    await prisma.bestsellerRun.updateMany({ where: { shop, applyStatus: "UNDOING" }, data: { applyStatus: "UNDO_FAILED" } });
    await prisma.bestsellerRun.updateMany({
      where: { shop, status: "RUNNING" },
      data: {
        status: "FAILED",
        phase: "abandoned",
        finishedAt: new Date(),
        error: json({ name: "Abandoned", code: "ABANDONED", message }),
      },
    });
  },

  async createRun({ shop, trigger, mode, localDate, requestedBy, options }) {
    return prisma.bestsellerRun.create({
      data: { shop, trigger, mode, localDate, requestedBy, options: json(options), status: "RUNNING", phase: "starting" },
    });
  },

  async updateRun(id, data) {
    await prisma.bestsellerRun.update({
      where: { id },
      data: {
        ...pick(data, ["phase", "windowStart", "windowEnd", "applyStatus", "appliedAt"]),
        ...(data.applySummary !== undefined ? { applySummary: json(data.applySummary) } : {}),
        ...(data.logs !== undefined ? { logs: json(data.logs) } : {}),
      },
    });
  },

  async completeRun(id, { status, phase, result, inputHash, resultHash, error, logs }) {
    await prisma.bestsellerRun.update({
      where: { id },
      data: {
        status,
        phase,
        finishedAt: new Date(),
        result: json(result ?? null),
        inputHash: inputHash ?? null,
        resultHash: resultHash ?? null,
        error: json(error ?? null),
        logs: json(logs ?? []),
      },
    });
  },

  async findRunsForLocalDate(shop, localDate, trigger) {
    return prisma.bestsellerRun.findMany({
      where: { shop, localDate, trigger },
      select: { id: true, status: true },
    });
  },

  async recordFlowEvent(runId, eventKey, { status, bytes, error = null, sentAt = null }) {
    await prisma.bestsellerFlowEvent.upsert({
      where: { runId_eventKey: { runId, eventKey } },
      create: { runId, eventKey, status, bytes, error, sentAt },
      update: { status, bytes, error, sentAt },
    });
  },

  async sentFlowEventKeys(runId) {
    const rows = await prisma.bestsellerFlowEvent.findMany({ where: { runId, status: "SENT" }, select: { eventKey: true } });
    return rows.map((r) => r.eventKey);
  },

  async recordTagChange(runId, change) {
    await prisma.bestsellerTagChange.create({
      data: {
        runId,
        productId: change.productId,
        action: change.action,
        scope: change.scope,
        status: change.status,
        message: change.message ?? null,
        tagsBefore: json(change.tagsBefore ?? null),
        tagsAfter: json(change.tagsAfter ?? null),
      },
    });
  },

  async listRuns(shop, limit = 30) {
    return prisma.bestsellerRun.findMany({
      where: { shop },
      orderBy: { startedAt: "desc" },
      take: limit,
      select: {
        id: true,
        trigger: true,
        mode: true,
        localDate: true,
        status: true,
        phase: true,
        startedAt: true,
        finishedAt: true,
        windowStart: true,
        windowEnd: true,
        resultHash: true,
        error: true,
      },
    });
  },

  async saveRunSelection(runId, { labelTag, selection }) {
    await prisma.bestsellerRun.update({ where: { id: runId }, data: { labelTag, selection: json(selection) } });
  },

  async previousSelection(shop, excludeRunId) {
    const run = await prisma.bestsellerRun.findFirst({
      where: { shop, status: "SUCCEEDED", selection: { not: null }, id: { not: excludeRunId } },
      orderBy: { startedAt: "desc" },
      select: { selection: true },
    });
    return run ? parse(run.selection) : null;
  },

  async listMembers(shop, tag) {
    return prisma.bestsellerListMember.findMany({ where: { shop, tag } });
  },

  /** Applies the membership changes of one run in a single transaction. */
  async saveMembership(shop, tag, { joins, updates, removals, runId }) {
    await prisma.$transaction([
      ...joins.map((m) =>
        prisma.bestsellerListMember.upsert({
          where: { shop_tag_productId: { shop, tag, productId: m.productId } },
          create: { shop, tag, ...m, sinceRunId: runId, lastSeenRunId: runId },
          update: { ...m, lastSeenRunId: runId },
        }),
      ),
      ...updates.map((m) =>
        prisma.bestsellerListMember.update({
          where: { shop_tag_productId: { shop, tag, productId: m.productId } },
          data: { title: m.title, category: m.category, legacyId: m.legacyId, lastSeenRunId: runId },
        }),
      ),
      prisma.bestsellerListMember.deleteMany({ where: { shop, tag, productId: { in: removals } } }),
    ]);
  },

  async tagChangesForRun(runId) {
    const rows = await prisma.bestsellerTagChange.findMany({ where: { runId }, orderBy: { createdAt: "asc" } });
    return rows.map((c) => ({ ...c, tagsBefore: parse(c.tagsBefore), tagsAfter: parse(c.tagsAfter) }));
  },

  /** Newest run that changed (or tried to change) the store. Only that one can be undone. */
  async latestAppliedRunId(shop) {
    const run = await prisma.bestsellerRun.findFirst({
      where: { shop, applyStatus: { not: null } },
      orderBy: { startedAt: "desc" },
      select: { id: true },
    });
    return run?.id ?? null;
  },

  async recordEvents(shop, events) {
    if (!events.length) return;
    await prisma.bestsellerEvent.createMany({
      data: events.map((e) => ({
        shop,
        kind: e.kind,
        tag: e.tag,
        runId: e.runId ?? null,
        localDate: e.localDate ?? null,
        productId: e.productId ?? null,
        legacyId: e.legacyId ?? null,
        title: e.title ?? null,
        category: e.category ?? null,
        netUnits: e.netUnits ?? null,
        detail: e.detail ?? null,
      })),
    });
  },

  async listEvents(shop, limit = 1000) {
    return prisma.bestsellerEvent.findMany({ where: { shop }, orderBy: { at: "desc" }, take: limit });
  },

  async getRunBasic(shop, id) {
    const run = await prisma.bestsellerRun.findFirst({
      where: { shop, id },
      select: {
        id: true,
        shop: true,
        status: true,
        mode: true,
        localDate: true,
        finishedAt: true,
        resultHash: true,
        labelTag: true,
        applyStatus: true,
        appliedAt: true,
        applySummary: true,
        result: true,
      },
    });
    return run ? { ...run, result: parse(run.result), applySummary: parse(run.applySummary) } : null;
  },

  async latestSucceededRunId(shop) {
    const run = await prisma.bestsellerRun.findFirst({
      where: { shop, status: "SUCCEEDED" },
      orderBy: { startedAt: "desc" },
      select: { id: true },
    });
    return run?.id ?? null;
  },

  async approvalsForRun(shop, runId) {
    return prisma.bestsellerApproval.findMany({ where: { shop, runId }, orderBy: { at: "asc" } });
  },

  async recordApproval(shop, { runId, decision, via, by, note }) {
    await prisma.bestsellerApproval.create({ data: { shop, runId, decision, via, by: by ?? null, note: note ?? null } });
  },

  async latestSucceededRun(shop) {
    const run = await prisma.bestsellerRun.findFirst({
      where: { shop, status: "SUCCEEDED" },
      orderBy: { startedAt: "desc" },
      select: { id: true, localDate: true, trigger: true, finishedAt: true, result: true, applyStatus: true, appliedAt: true },
    });
    return run ? { ...run, result: parse(run.result) } : null;
  },

  async getRun(shop, id) {
    const run = await prisma.bestsellerRun.findFirst({
      where: { shop, id },
      include: {
        flowEvents: { orderBy: { eventKey: "asc" } },
        tagChanges: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!run) return null;
    return {
      ...run,
      options: parse(run.options),
      result: parse(run.result),
      error: parse(run.error),
      logs: parse(run.logs) ?? [],
      applySummary: parse(run.applySummary),
      tagChanges: run.tagChanges.map((c) => ({ ...c, tagsBefore: parse(c.tagsBefore), tagsAfter: parse(c.tagsAfter) })),
    };
  },
};

function pick(object, keys) {
  return Object.fromEntries(keys.filter((k) => object[k] !== undefined).map((k) => [k, object[k]]));
}
