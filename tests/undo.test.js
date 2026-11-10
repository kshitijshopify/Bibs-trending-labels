import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../app/bestseller/config.js";
import { pendingUndo, undoState } from "../app/bestseller/apply/undo.js";
import { approvalState } from "../app/bestseller/approval/state.js";
import { combinedEmail } from "../app/bestseller/report/explain.js";
import { startBestsellerRun } from "../app/bestseller/jobs/run-job.js";
import { loadUndoContext, startUndo } from "../app/bestseller/jobs/undo-job.js";
import { tagListView } from "../app/bestseller/report/views.js";
import { operationName } from "../app/bestseller/shopify/queries.js";
import { product, resetIds } from "./helpers/builders.js";
import { createFakeShopify } from "./helpers/fake-shopify.js";
import { createMemoryRepo } from "./helpers/memory-repo.js";

const SHOP = "fake.myshopify.com";
const TAG = "label:Trending";
const SCOPES = "read_products,write_products,read_reports";
const NOW = () => new Date("2026-11-06T01:00:00Z");

const LIVE = {
  flowTriggerEnabled: false,
  applyEnabled: true,
  applyAllowedShops: [SHOP],
  allowTimeZoneMismatch: false,
  devWindowIncludeToday: false,
  cronShops: [SHOP],
  cronSecret: "",
};

/**
 * 6 active pacifiers (the first one already tagged), a draft pacifier tagged
 * with an unusual spelling, and a Bulk pacifier that is tagged. Every product
 * also has an unrelated tag that must never change.
 */
function shop() {
  resetIds(130000);
  const active = Array.from({ length: 6 }, (_, i) => product({ type: "Pacifier", tags: i === 0 ? [TAG, "summer"] : ["summer"] }));
  const draft = product({ type: "Pacifier", status: "DRAFT", tags: ["Label:Trending", "summer"] });
  const bulk = product({ type: "Pacifier", title: "Bulk pacifier 50 pcs", tags: [TAG, "summer"] });
  const products = [...active, draft, bulk];
  const sales = Object.fromEntries(active.map((p, i) => [p.legacyId, 30 - i]));
  return { active, draft, bulk, products, sales };
}

function deps(fake, repo, overrides = {}) {
  return {
    graphql: fake.graphql,
    fetchImpl: fake.fetchImpl,
    repo,
    settings: LIVE,
    config: { ...DEFAULT_CONFIG, bestsellerTag: TAG },
    sleep: async () => {},
    pollIntervalMs: 0,
    grantedScopes: SCOPES,
    storeUpdates: true,
    now: NOW,
    approvalUrl: () => "https://app.example/approve/x",
    ...overrides,
  };
}

async function applyUpdate(fake, repo, localDate = "2026-11-06") {
  const started = await startBestsellerRun({
    shop: SHOP,
    trigger: "schedule",
    localDate,
    options: { apply: true, approvalMode: "automatic" },
    deps: deps(fake, repo),
  });
  await started.done;
  return started.runId;
}

async function undo(fake, repo, runId, extra = {}) {
  const started = await startUndo({ shop: SHOP, runId, requestedBy: "Mette", deps: deps(fake, repo, extra.deps), ...extra.options });
  if (started.started) await started.done;
  return started;
}

const tagsOf = (fake, p) => fake.store.get(p.id).tags;

test("undo reverses every tag change of the update and leaves other tags alone", async () => {
  const s = shop();
  const fake = createFakeShopify({ products: s.products, sales: s.sales });
  const repo = createMemoryRepo();
  const runId = await applyUpdate(fake, repo);

  assert.equal(repo.runs.get(runId).applyStatus, "DONE");
  for (const p of s.active) assert.ok(tagsOf(fake, p).includes(TAG), "every active pacifier got the tag");
  assert.ok(!tagsOf(fake, s.draft).includes("Label:Trending"), "the draft lost the tag");
  assert.ok(!tagsOf(fake, s.bulk).includes(TAG), "the Bulk product lost the tag");

  const before = await loadUndoContext({ repo, shop: SHOP, runId });
  assert.equal(before.state.state, "available");
  assert.equal(before.state.canUndo, true);
  assert.deepEqual([before.state.progress.added, before.state.progress.removed], [5, 2]);

  const started = await undo(fake, repo, runId, { options: { paused: true, note: "wrong product type" } });
  assert.equal(started.started, true);

  // Added tags are gone again; the product that already had the tag keeps it.
  assert.deepEqual(tagsOf(fake, s.active[0]), [TAG, "summer"]);
  for (const p of s.active.slice(1)) assert.deepEqual(tagsOf(fake, p), ["summer"]);
  // The removed tag is back with its exact spelling.
  assert.deepEqual(tagsOf(fake, s.draft), ["summer", "Label:Trending"]);
  // Bulk products never get the tag back.
  assert.deepEqual(tagsOf(fake, s.bulk), ["summer"]);

  const run = repo.runs.get(runId);
  assert.equal(run.applyStatus, "UNDONE");
  assert.equal(run.applySummary.undo.reversed, 6);
  assert.equal(run.applySummary.undo.skipped, 1);
  assert.equal(run.applySummary.undo.paused, true);
  assert.equal(run.applySummary.undo.by, "Mette");

  const undone = repo.events.find((e) => e.kind === "undone");
  assert.match(undone.detail, /Undone in the app by Mette: 6 change\(s\) reversed, 1 skipped · automatic updates paused · “wrong product type”/);
  const reverts = repo.events.filter((e) => /^Undo of the update from 2026-11-06/.test(e.detail ?? ""));
  assert.equal(reverts.filter((e) => e.kind === "tag_removed").length, 5);
  assert.equal(reverts.filter((e) => e.kind === "tag_added").length, 1);
  assert.ok(reverts.every((e) => e.title && e.legacyId), "history rows name the product");

  const after = await loadUndoContext({ repo, shop: SHOP, runId });
  assert.equal(after.state.state, "undone");
  assert.equal(after.state.canUndo, false);
  const again = await undo(fake, repo, runId);
  assert.equal(again.started, false, "an undone update cannot be undone twice");
});

test("the tag list shows undone changes and is not reported as up to date", async () => {
  const s = shop();
  const fake = createFakeShopify({ products: s.products, sales: s.sales });
  const repo = createMemoryRepo();
  const runId = await applyUpdate(fake, repo);
  const applied = tagListView(repo.runs.get(runId).result, { changes: await repo.tagChangesForRun(runId) });
  assert.equal(applied.totals.upToDate, true);

  await undo(fake, repo, runId);
  const view = tagListView(repo.runs.get(runId).result, { changes: await repo.tagChangesForRun(runId) });
  assert.equal(view.totals.undone, 6);
  assert.equal(view.totals.added, 0);
  assert.equal(view.totals.upToDate, false);
  const pacifiers = view.categories.find((c) => c.key === "pacifiers");
  assert.equal(pacifiers.upToDate, false);
  assert.equal(pacifiers.undone, 6);
  assert.equal(pacifiers.willLose.find((p) => p.id === s.bulk.id).state, "skipped");
  assert.match(pacifiers.willLose.find((p) => p.id === s.bulk.id).message, /Bulk products never get the tag/);
  assert.equal(approvalState({ run: repo.runs.get(runId), latestSucceededId: runId }).state, "undone");
});

test("only the latest update that changed the store can be undone", async () => {
  const s = shop();
  const fake = createFakeShopify({ products: s.products, sales: s.sales });
  const repo = createMemoryRepo();
  const first = await applyUpdate(fake, repo, "2026-11-05");
  fake.editProduct(s.active[1].id, { tags: ["summer"] }); // someone removed a tag by hand
  const second = await applyUpdate(fake, repo, "2026-11-06");
  assert.equal(repo.runs.get(second).applyStatus, "DONE");

  const older = await undo(fake, repo, first);
  assert.equal(older.started, false);
  assert.match(older.reasons[0], /newer update/);
  assert.equal((await loadUndoContext({ repo, shop: SHOP, runId: first })).state.state, "locked");

  const latest = await undo(fake, repo, second);
  assert.equal(latest.started, true);
  assert.deepEqual(tagsOf(fake, s.active[1]), ["summer"], "the second update's own change was reversed");
  assert.ok(tagsOf(fake, s.active[2]).includes(TAG), "changes of the first update stay");
});

test("a failed undo can be tried again and only retries what is left", async () => {
  const s = shop();
  const fake = createFakeShopify({ products: s.products, sales: s.sales });
  const repo = createMemoryRepo();
  const runId = await applyUpdate(fake, repo);

  let broken = true;
  const flaky = async (query, variables) => {
    if (broken && operationName(query) === "BblTagsRemove" && variables.id === s.active[3].id) throw new Error("fetch failed");
    return fake.graphql(query, variables);
  };
  await undo(fake, repo, runId, { deps: { graphql: flaky } });
  assert.equal(repo.runs.get(runId).applyStatus, "UNDO_FAILED");
  assert.ok(tagsOf(fake, s.active[3]).includes(TAG));
  const partly = await loadUndoContext({ repo, shop: SHOP, runId });
  assert.equal(partly.state.state, "partly");
  assert.equal(partly.state.canUndo, true);
  assert.equal(partly.state.progress.failed, 1);
  assert.equal(pendingUndo(partly.changes).length, 1);

  broken = false;
  const reads = fake.calls.length;
  const retry = await undo(fake, repo, runId);
  assert.equal(retry.started, true);
  const productReads = fake.calls.slice(reads).filter((c) => c.name === "BblProductForApply");
  assert.equal(productReads.length, 1, "only the failed product is read again");
  assert.deepEqual(tagsOf(fake, s.active[3]), ["summer"]);
  assert.equal(repo.runs.get(runId).applyStatus, "UNDONE");
  assert.equal((await loadUndoContext({ repo, shop: SHOP, runId })).state.state, "undone");
});

test("products already back in their earlier state are left alone", async () => {
  const s = shop();
  const fake = createFakeShopify({ products: s.products, sales: s.sales });
  const repo = createMemoryRepo();
  const runId = await applyUpdate(fake, repo);
  fake.editProduct(s.active[2].id, { tags: ["summer"] }); // tag already taken off by hand
  fake.store.delete(s.active[4].id); // product deleted since

  await undo(fake, repo, runId);
  const summary = repo.runs.get(runId).applySummary.undo;
  assert.equal(summary.noop, 1);
  assert.equal(summary.skipped, 2); // deleted product + Bulk product
  assert.equal(summary.reversed, 4);
  const mutations = fake.calls.filter((c) => c.name === "BblTagsRemove" && c.variables.id === s.active[2].id);
  assert.equal(mutations.length, 0, "no store call for a product that is already right");
});

test("undo is blocked while store updates are off", async () => {
  const s = shop();
  const fake = createFakeShopify({ products: s.products, sales: s.sales });
  const repo = createMemoryRepo();
  const runId = await applyUpdate(fake, repo);
  const blocked = await undo(fake, repo, runId, { deps: { settings: { ...LIVE, applyEnabled: false } } });
  assert.equal(blocked.started, false);
  assert.ok(blocked.reasons.some((r) => /BESTSELLER_APPLY_ENABLED/.test(r)));
  const noScope = await undo(fake, repo, runId, { deps: { grantedScopes: "read_products,read_reports" } });
  assert.equal(noScope.started, false);
  assert.ok(noScope.reasons.some((r) => /write_products/.test(r)));
  assert.equal(repo.runs.get(runId).applyStatus, "DONE");
});

test("a preview that changed nothing has nothing to undo", async () => {
  const s = shop();
  const fake = createFakeShopify({ products: s.products, sales: s.sales });
  const repo = createMemoryRepo();
  const started = await startBestsellerRun({ shop: SHOP, trigger: "manual", localDate: "2026-11-06", options: {}, deps: deps(fake, repo) });
  await started.done;
  const ctx = await loadUndoContext({ repo, shop: SHOP, runId: started.runId });
  assert.equal(ctx.state.state, "none");
  const result = await undo(fake, repo, started.runId);
  assert.equal(result.started, false);
});

test("an interrupted undo can be finished later", () => {
  const run = { id: "run-1", status: "SUCCEEDED", applyStatus: "UNDO_FAILED" };
  const changes = [
    { productId: "a", action: "add", status: "APPLIED", scope: "pacifiers" },
    { productId: "b", action: "remove", status: "APPLIED", scope: "pacifiers" },
    { productId: "a", action: "undo_add", status: "APPLIED", scope: "pacifiers" },
  ];
  const state = undoState({ run, latestAppliedId: "run-1", changes });
  assert.equal(state.state, "partly");
  assert.equal(state.canUndo, true);
  assert.deepEqual(pendingUndo(changes).map((c) => c.productId), ["b"]);
  assert.equal(undoState({ run: { ...run, applyStatus: "UNDOING" }, latestAppliedId: "run-1", changes }).state, "undoing");
});

test("the applied email offers the review and undo link", async () => {
  const s = shop();
  const repo = createMemoryRepo();
  const runId = await applyUpdate(createFakeShopify({ products: s.products, sales: s.sales }), repo);
  const email = combinedEmail(repo.runs.get(runId).result, { mode: "applied", approvalUrl: "https://app.example/approve/x" });
  assert.match(email.body, /Spotted a mistake\? Review or undo this update \(valid for 48 hours\): https:\/\/app.example\/approve\/x/);
  const preview = combinedEmail(repo.runs.get(runId).result, { mode: "preview", approvalUrl: "https://app.example/approve/x" });
  assert.doesNotMatch(preview.body, /undo/i);
});
