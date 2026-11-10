import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../app/bestseller/config.js";
import { approvalState } from "../app/bestseller/approval/state.js";
import { signApprovalToken, verifyApprovalToken } from "../app/bestseller/approval/token.js";
import { decideRun, startApprovedApply } from "../app/bestseller/jobs/approval-job.js";
import { startBestsellerRun } from "../app/bestseller/jobs/run-job.js";
import { previewEmail } from "../app/bestseller/report/explain.js";
import { PRODUCT_CHANGING_OPERATIONS } from "../app/bestseller/shopify/queries.js";
import { category, compute, product, resetIds } from "./helpers/builders.js";
import { createFakeShopify } from "./helpers/fake-shopify.js";
import { createMemoryRepo } from "./helpers/memory-repo.js";

const SHOP = "fake.myshopify.com";
const SECRET = "test-secret-0123456789";
const NOW = new Date("2026-11-06T01:00:00Z");

// ---- signed email links ------------------------------------------------------

test("approval links are signed, bound to one run and expire", () => {
  const expiresAt = new Date("2026-11-08T01:00:00Z");
  const token = signApprovalToken({ runId: "run-1", shop: SHOP, resultHash: "abcdef0123456789ffff", expiresAt }, SECRET);
  const ok = verifyApprovalToken(token, SECRET, NOW);
  assert.equal(ok.ok, true);
  assert.equal(ok.runId, "run-1");
  assert.equal(ok.shop, SHOP);
  assert.equal(ok.hashPrefix, "abcdef0123456789");
  assert.equal(verifyApprovalToken(token, "another-secret-xxxxxx", NOW).ok, false);
  assert.equal(verifyApprovalToken(`${token}x`, SECRET, NOW).ok, false);
  const [body, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ r: "run-2", s: SHOP, h: "x", e: 9999999999 })).toString("base64url");
  assert.equal(verifyApprovalToken(`${forged}.${sig}`, SECRET, NOW).ok, false, "payload cannot be swapped");
  assert.ok(body);
  const late = verifyApprovalToken(token, SECRET, new Date("2026-11-09T00:00:00Z"));
  assert.equal(late.ok, false);
  assert.match(late.reason, /expired/);
});

// ---- approval state ------------------------------------------------------------

const succeeded = (id, finishedAt = "2026-11-06T00:30:00Z", extra = {}) => ({ id, status: "SUCCEEDED", finishedAt, ...extra });

test("only the newest successful list, within 48 hours, can be approved", () => {
  assert.equal(approvalState({ run: succeeded("a"), latestSucceededId: "a", now: NOW }).state, "pending");
  assert.equal(approvalState({ run: succeeded("a"), latestSucceededId: "b", now: NOW }).state, "superseded");
  assert.equal(approvalState({ run: succeeded("a"), latestSucceededId: "a", now: new Date("2026-11-09T00:00:00Z") }).state, "expired");
  assert.equal(approvalState({ run: { id: "a", status: "FAILED" }, latestSucceededId: "a", now: NOW }).state, "unavailable");
});

test("decisions are final: approved can be applied once, rejected cannot be approved", () => {
  const approved = approvalState({ run: succeeded("a"), latestSucceededId: "a", approvals: [{ decision: "approved" }], now: NOW });
  assert.equal(approved.state, "approved");
  assert.equal(approved.canApply, true);
  assert.equal(approved.canApprove, false);
  const rejected = approvalState({ run: succeeded("a"), latestSucceededId: "a", approvals: [{ decision: "rejected" }], now: NOW });
  assert.equal(rejected.state, "rejected");
  assert.equal(rejected.canApprove || rejected.canApply, false);
  const applied = approvalState({ run: succeeded("a", undefined, { applyStatus: "DONE" }), latestSucceededId: "a", approvals: [{ decision: "approved" }], now: NOW });
  assert.equal(applied.state, "applied");
  assert.equal(applied.canApply, false);
  const failed = approvalState({ run: succeeded("a", undefined, { applyStatus: "FAILED" }), latestSucceededId: "a", approvals: [{ decision: "approved" }], now: NOW });
  assert.equal(failed.canApply, true, "a failed apply can be retried");
});

// ---- end to end: preview -> approve (app or email) -> apply --------------------

function settings(overrides = {}) {
  return {
    flowTriggerEnabled: false,
    applyEnabled: false,
    applyAllowedShops: [],
    allowTimeZoneMismatch: false,
    devWindowIncludeToday: false,
    cronShops: [],
    cronSecret: "",
    ...overrides,
  };
}

function storeCatalog() {
  resetIds(90000);
  const products = [];
  for (let i = 0; i < 25; i += 1) products.push(product({ type: "Pacifier", tags: i === 24 ? ["label:BESTSELLER", "Keep:Me"] : ["Keep:Me"] }));
  products.push(product({ type: "Teether", tags: ["label:BESTSELLER", "label:BULK"] }));
  const sales = Object.fromEntries(products.map((p, i) => [p.legacyId, 100 - i]));
  return { products, sales };
}

async function previewRun(fake, repo, s = settings(), localDate = "2026-11-06") {
  const started = await startBestsellerRun({
    shop: SHOP,
    trigger: "manual",
    localDate,
    options: { sendFlow: s.flowTriggerEnabled, approvalMode: "manual" },
    deps: {
      graphql: fake.graphql,
      fetchImpl: fake.fetchImpl,
      repo,
      settings: s,
      config: DEFAULT_CONFIG,
      sleep: async () => {},
      pollIntervalMs: 0,
      grantedScopes: "read_products,read_reports",
      now: () => NOW,
      approvalUrl: (run) => `https://app.example/approve/token-for-${run.id}`,
    },
  });
  await started.done;
  return started.runId;
}

const deps = (fake, repo, s, scopes = "read_products,write_products,read_reports") => ({
  repo,
  settings: s,
  graphql: fake.graphql,
  grantedScopes: scopes,
  storeUpdates: true,
  now: () => NOW,
  approvalUrl: (run) => `https://app.example/approve/token-for-${run.id}`,
});

const changingCalls = (fake) => fake.operationNames().filter((n) => PRODUCT_CHANGING_OPERATIONS.includes(n));

test("approving in the app while updates are off records the approval but changes nothing", async () => {
  const { products, sales } = storeCatalog();
  const fake = createFakeShopify({ products, sales });
  const repo = createMemoryRepo();
  const runId = await previewRun(fake, repo);

  const outcome = await decideRun({ shop: SHOP, runId, decision: "approved", via: "app", by: "mbn@bibsworld.com", deps: deps(fake, repo, settings()) });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.apply.started, false);
  assert.ok(outcome.apply.reasons.some((r) => /BESTSELLER_APPLY_ENABLED/.test(r)));
  assert.deepEqual(changingCalls(fake), []);
  assert.equal(repo.approvals.length, 1);
  assert.match(repo.events.find((e) => e.kind === "approved").detail, /via the app by mbn@bibsworld.com/);

  // Later, updates are switched on -> "Apply now"
  const on = settings({ applyEnabled: true, applyAllowedShops: [SHOP] });
  const apply = await startApprovedApply({ shop: SHOP, runId, requestedBy: "developer", deps: deps(fake, repo, on) });
  assert.equal(apply.started, true);
  const done = await apply.done;
  assert.equal(done.status, "DONE");
  assert.ok(changingCalls(fake).length > 0);
  // unrelated tags survive, Bulk lost the tag
  for (const p of fake.store.values()) if (p.productType === "Pacifier") assert.ok(p.tags.includes("Keep:Me"));
  const teether = [...fake.store.values()].find((p) => p.productType === "Teether");
  assert.ok(!teether.tags.includes("label:BESTSELLER"));
  assert.ok(repo.events.some((e) => e.kind === "tag_added"));
  assert.ok(repo.events.some((e) => e.kind === "applied"));

  // Applying the same list again is refused
  const again = await startApprovedApply({ shop: SHOP, runId, deps: deps(fake, repo, on) });
  assert.equal(again.started, false);
});

test("approving with the email link applies at once when updates are on", async () => {
  const { products, sales } = storeCatalog();
  const fake = createFakeShopify({ products, sales });
  const repo = createMemoryRepo();
  const on = settings({ applyEnabled: true, applyAllowedShops: [SHOP] });
  const runId = await previewRun(fake, repo, on);
  assert.deepEqual(changingCalls(fake), [], "the preview itself changes nothing");

  const outcome = await decideRun({ shop: SHOP, runId, decision: "approved", via: "email", by: "Mette (email link)", deps: deps(fake, repo, on) });
  assert.equal(outcome.apply.started, true);
  await outcome.done;
  assert.ok(changingCalls(fake).length > 0);
  assert.match(repo.events.find((e) => e.kind === "approved").detail, /via the email link by Mette/);
  assert.equal(repo.runs.get(runId).applyStatus, "DONE");
});

test("a rejected list can never be applied", async () => {
  const { products, sales } = storeCatalog();
  const fake = createFakeShopify({ products, sales });
  const repo = createMemoryRepo();
  const on = settings({ applyEnabled: true, applyAllowedShops: [SHOP] });
  const runId = await previewRun(fake, repo, on);
  const rejected = await decideRun({ shop: SHOP, runId, decision: "rejected", via: "email", by: "Mette", note: "wait for AW27", deps: deps(fake, repo, on) });
  assert.equal(rejected.ok, true);
  const approve = await decideRun({ shop: SHOP, runId, decision: "approved", via: "app", deps: deps(fake, repo, on) });
  assert.equal(approve.ok, false);
  const apply = await startApprovedApply({ shop: SHOP, runId, deps: deps(fake, repo, on) });
  assert.equal(apply.started, false);
  assert.deepEqual(changingCalls(fake), []);
});

test("an older list cannot be approved once a newer list exists", async () => {
  const { products, sales } = storeCatalog();
  const fake = createFakeShopify({ products, sales });
  const repo = createMemoryRepo();
  const on = settings({ applyEnabled: true, applyAllowedShops: [SHOP] });
  const first = await previewRun(fake, repo, on, "2026-11-06");
  await previewRun(fake, repo, on, "2026-11-07");
  const outcome = await decideRun({ shop: SHOP, runId: first, decision: "approved", via: "email", deps: deps(fake, repo, on) });
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /newer list/);
});

test("without write_products the approved list is not applied", async () => {
  const { products, sales } = storeCatalog();
  const fake = createFakeShopify({ products, sales });
  const repo = createMemoryRepo();
  const on = settings({ applyEnabled: true, applyAllowedShops: [SHOP] });
  const runId = await previewRun(fake, repo, on);
  const outcome = await decideRun({ shop: SHOP, runId, decision: "approved", via: "app", deps: deps(fake, repo, on, "read_products,read_reports") });
  assert.equal(outcome.apply.started, false);
  assert.ok(outcome.apply.reasons.some((r) => /write_products/.test(r)));
  assert.deepEqual(changingCalls(fake), []);
});

test("preview Flow events carry the approval link and the waiting status", async () => {
  const { products, sales } = storeCatalog();
  const fake = createFakeShopify({ products, sales });
  const repo = createMemoryRepo();
  const runId = await previewRun(fake, repo, settings({ flowTriggerEnabled: true }));
  assert.equal(fake.flowEvents.length, 4);
  for (const e of fake.flowEvents) {
    assert.equal(e.payload.Mode, "preview");
    assert.equal(e.payload.Status, "Preview: approval needed");
    assert.equal(e.payload["Approval link"], `https://app.example/approve/token-for-${runId}`);
  }
});

test("after an approved apply, confirmation events say what was changed", async () => {
  const { products, sales } = storeCatalog();
  const fake = createFakeShopify({ products, sales });
  const repo = createMemoryRepo();
  const on = settings({ applyEnabled: true, applyAllowedShops: [SHOP], flowTriggerEnabled: true });
  const runId = await previewRun(fake, repo, on);
  const outcome = await decideRun({ shop: SHOP, runId, decision: "approved", via: "app", deps: deps(fake, repo, on) });
  await outcome.done;
  const applied = fake.flowEvents.filter((e) => e.payload.Mode === "applied");
  assert.equal(applied.length, 4);
  assert.match(applied[0].payload.Status, /^Applied: \d+ change\(s\) made/);
});

test("the email text switches from 'would' to what was done", () => {
  resetIds(95000);
  const products = [product({ type: "Pacifier" }), product({ type: "Pacifier", status: "DRAFT", tags: ["label:BESTSELLER"] })];
  const result = compute(products, { [products[0].legacyId]: 3 });
  const pacifiers = category(result, "pacifiers");
  const preview = previewEmail(result, pacifiers, { mode: "preview", approvalUrl: "https://app.example/approve/x" }).body;
  assert.match(preview, /Status: waiting for your approval/);
  assert.match(preview, /Would add the tag \(1\)/);
  assert.match(preview, /Approve or reject this list \(valid for 48 hours\): https:\/\/app.example\/approve\/x/);
  const applied = previewEmail(result, pacifiers, { mode: "applied" }).body;
  assert.match(applied, /Status: applied in the store/);
  assert.match(applied, /Tag added \(1\)/);
  assert.match(applied, /Tag removed \(1\)/);
  assert.doesNotMatch(applied, /Would/);
});

