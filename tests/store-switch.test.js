// The in-app "Store updates" switch: while it is off, nothing in the store
// changes (nightly apply, Apply now, undo), whatever the server settings say.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../app/bestseller/config.js";
import { STORE_UPDATES_OFF, applyGuard } from "../app/bestseller/jobs/guards.js";
import { decideRun, startApprovedApply } from "../app/bestseller/jobs/approval-job.js";
import { startBestsellerRun, triggerScheduledRuns } from "../app/bestseller/jobs/run-job.js";
import { startUndo } from "../app/bestseller/jobs/undo-job.js";
import { product, resetIds } from "./helpers/builders.js";
import { createFakeShopify } from "./helpers/fake-shopify.js";
import { createMemoryRepo } from "./helpers/memory-repo.js";

const SHOP = "fake.myshopify.com";
const SCOPES = "read_products,write_products,read_reports";
const NOW = () => new Date("2026-11-06T01:00:00Z"); // 02:00 Copenhagen
const CHANGING = ["BblTagsAdd", "BblTagsRemove"];

/** The server is fully ready: only the in-app switch decides. */
const SERVER_READY = {
  flowTriggerEnabled: true,
  applyEnabled: true,
  applyAllowedShops: [SHOP],
  allowTimeZoneMismatch: false,
  devWindowIncludeToday: false,
  cronShops: [SHOP],
  cronSecret: "",
};

function store() {
  resetIds(140000);
  const products = Array.from({ length: 5 }, (_, i) => product({ type: "Pacifier", tags: i === 0 ? ["label:Trending"] : [] }));
  const sales = Object.fromEntries(products.map((p, i) => [p.legacyId, 20 - i]));
  return createFakeShopify({ products, sales });
}

function deps(fake, repo, storeUpdates) {
  return {
    graphql: fake.graphql,
    fetchImpl: fake.fetchImpl,
    repo,
    settings: SERVER_READY,
    config: { ...DEFAULT_CONFIG, bestsellerTag: "label:Trending" },
    sleep: async () => {},
    pollIntervalMs: 0,
    grantedScopes: SCOPES,
    storeUpdates,
    now: NOW,
    approvalUrl: () => "https://app.example/approve/x",
  };
}

const changes = (fake) => fake.operationNames().filter((n) => CHANGING.includes(n));

async function waitForRuns(repo) {
  for (let i = 0; i < 100 && [...repo.runs.values()].some((r) => r.status === "RUNNING"); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("the guard blocks unless the switch is exactly on", () => {
  for (const value of [undefined, null, false, "true", 1]) {
    const guard = applyGuard({ settings: SERVER_READY, shop: SHOP, grantedScopes: SCOPES, runSucceeded: true, storeUpdates: value });
    assert.equal(guard.allowed, false, String(value));
    assert.equal(guard.reasons[0], STORE_UPDATES_OFF);
  }
  assert.equal(applyGuard({ settings: SERVER_READY, shop: SHOP, grantedScopes: SCOPES, runSucceeded: true, storeUpdates: true }).allowed, true);
  const both = applyGuard({ settings: { ...SERVER_READY, applyEnabled: false }, shop: SHOP, grantedScopes: SCOPES, runSucceeded: true, storeUpdates: false });
  assert.deepEqual(both.reasons, [STORE_UPDATES_OFF, "BESTSELLER_APPLY_ENABLED is not true"]);
});

test("switch off: the nightly automatic update changes nothing and the email says so", async () => {
  const fake = store();
  const repo = createMemoryRepo();
  const results = await triggerScheduledRuns({
    shops: [SHOP],
    now: NOW(),
    repo,
    settings: SERVER_READY,
    config: { ...DEFAULT_CONFIG, bestsellerTag: "label:Trending" },
    approvalModeForShop: async () => "automatic",
    makeDeps: async () => deps(fake, repo, false),
  });
  assert.equal(results[0].started, true);
  await waitForRuns(repo);
  const run = [...repo.runs.values()][0];
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.mode, "preview");
  assert.equal(run.applyStatus, undefined);
  assert.deepEqual(changes(fake), []);
  assert.ok(fake.flowEvents.length > 0, "the review email is still sent");
  assert.ok(fake.flowEvents.every((e) => e.payload.Status === "Preview: store updates are off, nothing was changed"));
});

test("switch on: the same nightly update applies the list", async () => {
  const fake = store();
  const repo = createMemoryRepo();
  await triggerScheduledRuns({
    shops: [SHOP],
    now: NOW(),
    repo,
    settings: SERVER_READY,
    config: { ...DEFAULT_CONFIG, bestsellerTag: "label:Trending" },
    approvalModeForShop: async () => "automatic",
    makeDeps: async () => deps(fake, repo, true),
  });
  await waitForRuns(repo);
  assert.equal([...repo.runs.values()][0].applyStatus, "DONE");
  assert.ok(changes(fake).includes("BblTagsAdd"));
});

test("switch off: Apply now, approval and undo are refused with the reason", async () => {
  const fake = store();
  const repo = createMemoryRepo();
  // Apply once with the switch on, so there is an update to undo.
  const started = await startBestsellerRun({
    shop: SHOP,
    trigger: "manual",
    localDate: "2026-11-06",
    options: { apply: true, approvalMode: "automatic" },
    deps: deps(fake, repo, true),
  });
  await started.done;
  assert.equal(repo.runs.get(started.runId).applyStatus, "DONE");
  const before = changes(fake).length;

  const undo = await startUndo({ shop: SHOP, runId: started.runId, requestedBy: "Mette", deps: deps(fake, repo, false) });
  assert.equal(undo.started, false);
  assert.deepEqual(undo.reasons, [STORE_UPDATES_OFF]);

  // A new list in manual mode: approving records the decision but changes nothing.
  const preview = await startBestsellerRun({
    shop: SHOP,
    trigger: "manual",
    localDate: "2026-11-07",
    options: { approvalMode: "manual" },
    deps: deps(fake, repo, false),
  });
  await preview.done;
  fake.editProduct([...fake.store.values()][1].id, { tags: [] });
  const approved = await decideRun({ shop: SHOP, runId: preview.runId, decision: "approved", via: "app", by: "Mette", deps: deps(fake, repo, false) });
  assert.equal(approved.ok, true);
  assert.equal(approved.apply.started, false);
  assert.deepEqual(approved.apply.reasons, [STORE_UPDATES_OFF]);
  const apply = await startApprovedApply({ shop: SHOP, runId: preview.runId, deps: deps(fake, repo, false) });
  assert.equal(apply.started, false);
  assert.equal(changes(fake).length, before, "no tag was changed while the switch was off");
});
