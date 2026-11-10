import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../app/bestseller/config.js";
import { startBestsellerRun, triggerScheduledRuns } from "../app/bestseller/jobs/run-job.js";
import { PRODUCT_CHANGING_OPERATIONS } from "../app/bestseller/shopify/queries.js";
import { product, resetIds } from "./helpers/builders.js";
import { createFakeShopify } from "./helpers/fake-shopify.js";
import { createMemoryRepo } from "./helpers/memory-repo.js";

const SHOP = "fake.myshopify.com";

function settings(overrides = {}) {
  return {
    flowTriggerEnabled: false,
    applyEnabled: false,
    applyAllowedShops: [],
    allowTimeZoneMismatch: false,
    devWindowIncludeToday: false,
    cronShops: [SHOP],
    cronSecret: "",
    ...overrides,
  };
}

function catalog() {
  resetIds(20000);
  const products = [];
  // 120 pacifiers so the catalog exceeds 100 products
  for (let i = 0; i < 120; i += 1) {
    products.push(product({ type: "Pacifier", tags: i < 3 ? ["AW27", "Colour:Ivory"] : ["Colour:Ivory"] }));
  }
  products.push(product({ type: "Pacifier", tags: ["label:BESTSELLER", "Qty:Bulk", "Keep:Me"] })); // remove (Bulk)
  products.push(product({ type: "Baby Bottle", tags: ["label:BESTSELLER", "Unrelated:Tag"] }));
  products.push(product({ type: "Teether", tags: ["label:BESTSELLER", "label:BULK"] })); // cleanup
  products.push(product({ type: "Teether", tags: ["label:BESTSELLER"] })); // review, never removed
  const sales = Object.fromEntries(products.map((p, i) => [p.legacyId, i % 9]));
  return { products, sales };
}

async function run(fake, repo, opts = {}) {
  const started = await startBestsellerRun({
    shop: SHOP,
    trigger: opts.trigger ?? "manual",
    localDate: opts.localDate ?? "2026-11-06",
    options: opts.options ?? {},
    deps: {
      graphql: fake.graphql,
      fetchImpl: fake.fetchImpl,
      repo,
      settings: opts.settings ?? settings(),
      config: DEFAULT_CONFIG,
      sleep: async () => {},
      pollIntervalMs: 0,
      grantedScopes: opts.grantedScopes ?? "read_products,read_reports",
      storeUpdates: opts.storeUpdates ?? true,
      now: () => new Date("2026-11-06T01:00:00Z"),
    },
  });
  if (!started.started) return started;
  const outcome = await started.done;
  return { ...started, ...outcome, run: repo.runs.get(started.runId) };
}

const productChangingCalls = (fake) => fake.operationNames().filter((n) => PRODUCT_CHANGING_OPERATIONS.includes(n));

test("preview runs make no product changes and send no Flow events by default", async () => {
  const { products, sales } = catalog();
  const fake = createFakeShopify({ products, sales });
  const repo = createMemoryRepo();
  const before = JSON.stringify([...fake.store.values()]);
  const outcome = await run(fake, repo);
  assert.equal(outcome.status, "SUCCEEDED");
  assert.deepEqual(productChangingCalls(fake), []);
  assert.equal(fake.flowEvents.length, 0);
  assert.equal(JSON.stringify([...fake.store.values()]), before);
  const result = outcome.run.result;
  assert.equal(result.completeness.catalog.productsRead, products.length);
  assert.equal(result.categories.find((c) => c.key === "pacifiers").launch.chosenSeason, "AW27");
  assert.ok(result.flowPayloads.every((p) => p.withinLimit));
});

test("apply requested without approval flags is blocked (no product changes)", async () => {
  const { products, sales } = catalog();
  const fake = createFakeShopify({ products, sales });
  const repo = createMemoryRepo();
  const outcome = await run(fake, repo, { options: { apply: true }, grantedScopes: "read_products,read_reports" });
  assert.equal(outcome.status, "SUCCEEDED");
  assert.deepEqual(productChangingCalls(fake), []);
  assert.equal(outcome.run.applySummary.blocked, true);
  assert.ok(outcome.run.applySummary.reasons.some((r) => /write_products/.test(r)));
});

for (const [name, failures] of [
  ["bulk export failure", { bulkStatus: "FAILED" }],
  ["missing catalog line", { dropJsonlLine: true }],
  ["reporting parse error", { shopifyqlParseError: true }],
  ["reporting access denied", { accessDenied: "BblShopifyql" }],
  ["truncated sales pages", { shopifyqlPageCap: 10 }],
  ["shop time zone mismatch", { timezone: "Asia/Kolkata" }],
]) {
  test(`partial reads or reporting failures produce no tag updates and no previews: ${name}`, async () => {
    const { products, sales } = catalog();
    const fake = createFakeShopify({ products, sales, failures });
    const repo = createMemoryRepo();
    const fullyEnabled = settings({ flowTriggerEnabled: true, applyEnabled: true, applyAllowedShops: [SHOP] });
    const outcome = await run(fake, repo, {
      options: { apply: true, sendFlow: true },
      settings: fullyEnabled,
      grantedScopes: "read_products,write_products,read_reports",
    });
    assert.equal(outcome.status, "FAILED");
    assert.equal(outcome.run.status, "FAILED");
    assert.deepEqual(productChangingCalls(fake), []);
    assert.equal(fake.flowEvents.length, 0);
    assert.equal(repo.tagChanges.length, 0);
  });
}

test("missing read_reports fails fast with a clear message, before any store read", async () => {
  const { products, sales } = catalog();
  const fake = createFakeShopify({ products, sales });
  const repo = createMemoryRepo();
  // the template's old scopes, as found on the dev store
  const outcome = await run(fake, repo, { grantedScopes: "write_metaobject_definitions,write_metaobjects,write_products" });
  assert.equal(outcome.status, "FAILED");
  assert.equal(outcome.run.error.code, "MISSING_SCOPES");
  assert.match(outcome.run.error.message, /read_reports/);
  assert.doesNotMatch(outcome.run.error.message, /read_products,/, "write_products implies read_products");
  assert.deepEqual(fake.operationNames(), [], "no Admin API call was made");
});

test("overlapping runs are prevented by the shop lock", async () => {
  const { products, sales } = catalog();
  const fake = createFakeShopify({ products, sales });
  const repo = createMemoryRepo();
  const deps = {
    graphql: fake.graphql,
    fetchImpl: fake.fetchImpl,
    repo,
    settings: settings(),
    sleep: async () => {},
    pollIntervalMs: 0,
    grantedScopes: "read_products,read_reports",
    now: () => new Date("2026-11-06T01:00:00Z"),
  };
  const first = await startBestsellerRun({ shop: SHOP, trigger: "manual", deps });
  const second = await startBestsellerRun({ shop: SHOP, trigger: "manual", deps });
  assert.equal(first.started, true);
  assert.equal(second.started, false);
  await first.done;
  const third = await startBestsellerRun({ shop: SHOP, trigger: "manual", deps });
  assert.equal(third.started, true);
  await third.done;
});

test("Flow events: one per category plus cleanup, sent once, never resent on retry", async () => {
  const { products, sales } = catalog();
  const fake = createFakeShopify({ products, sales });
  const repo = createMemoryRepo();
  const outcome = await run(fake, repo, { options: { sendFlow: true }, settings: settings({ flowTriggerEnabled: true }) });
  assert.equal(outcome.status, "SUCCEEDED");
  assert.deepEqual(
    fake.flowEvents.map((e) => e.payload.Category),
    ["Pacifiers", "Bottles", "Accessories", "Cleanup and review"],
  );
  assert.ok(fake.flowEvents.every((e) => e.handle === "bestseller-preview-ready"));
  assert.deepEqual((await repo.sentFlowEventKeys(outcome.runId)).sort(), ["accessories", "bottles", "cleanup", "pacifiers"]);
});

test("nightly scheduler: one run per Copenhagen date, second tick skipped", async () => {
  const { products, sales } = catalog();
  const fake = createFakeShopify({ products, sales });
  const repo = createMemoryRepo();
  const makeDeps = async () => ({
    graphql: fake.graphql,
    fetchImpl: fake.fetchImpl,
    sleep: async () => {},
    pollIntervalMs: 0,
    grantedScopes: "read_products,read_reports",
    now: () => new Date("2027-07-01T00:00:00Z"),
  });
  const s = settings();
  // Summer: 00:00 UTC = 02:00 Copenhagen -> run
  const first = await triggerScheduledRuns({ shops: [SHOP], now: new Date("2027-07-01T00:00:00Z"), repo, settings: s, makeDeps });
  assert.equal(first[0].started, true);
  // wait for it to finish
  await new Promise((resolve) => setTimeout(resolve, 50));
  for (let i = 0; i < 50 && [...repo.runs.values()].some((r) => r.status === "RUNNING"); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  // 01:00 UTC = 03:00 Copenhagen, same date -> skipped
  const second = await triggerScheduledRuns({ shops: [SHOP], now: new Date("2027-07-01T01:00:00Z"), repo, settings: s, makeDeps });
  assert.equal(second[0].started, false);
  assert.match(second[0].reason, /already succeeded/);
  // Daytime tick -> never a nightly run
  const day = await triggerScheduledRuns({ shops: [SHOP], now: new Date("2027-07-01T10:00:00Z"), repo, settings: s, makeDeps });
  assert.equal(day[0].started, false);
});

test("approved update runs preserve unrelated tags, recheck tags, and are idempotent", async () => {
  const { products, sales } = catalog();
  const fake = createFakeShopify({ products, sales });
  const repo = createMemoryRepo();
  const approved = settings({ applyEnabled: true, applyAllowedShops: [SHOP] });
  const scopes = "read_products,write_products,read_reports";

  const unrelatedBefore = new Map(
    [...fake.store.values()].map((p) => [p.id, p.tags.filter((t) => t.toLowerCase() !== "label:bestseller")]),
  );

  const first = await run(fake, repo, { options: { apply: true }, settings: approved, grantedScopes: scopes });
  assert.equal(first.status, "SUCCEEDED");
  assert.equal(first.run.applySummary.failed, 0);
  assert.ok(first.run.applySummary.applied > 0);

  // Unrelated tags untouched on every product
  for (const p of fake.store.values()) {
    assert.deepEqual(
      p.tags.filter((t) => t.toLowerCase() !== "label:bestseller"),
      unrelatedBefore.get(p.id),
      `unrelated tags changed on ${p.id}`,
    );
  }
  // Bulk products lost the label; review product kept it
  const teethers = [...fake.store.values()].filter((p) => p.productType === "Teether");
  const bulkTeether = teethers.find((p) => p.tags.includes("label:BULK"));
  const reviewTeether = teethers.find((p) => !p.tags.includes("label:BULK"));
  assert.ok(!bulkTeether.tags.includes("label:BESTSELLER"));
  assert.ok(reviewTeether.tags.includes("label:BESTSELLER"));

  // A merchant edits an unrelated tag between runs: it must survive the next run.
  const edited = [...fake.store.values()][0];
  fake.editProduct(edited.id, { tags: [...edited.tags, "Merchant:Edit"] });

  const second = await run(fake, repo, {
    options: { apply: true },
    settings: approved,
    grantedScopes: scopes,
    localDate: "2026-11-07",
  });
  assert.equal(second.status, "SUCCEEDED");
  assert.equal(second.run.applySummary.applied, 0, "second run is a no-op");
  assert.ok(fake.store.get(edited.id).tags.includes("Merchant:Edit"));

  // Same inputs -> same selection (the labels are now in place, so compare the selection hash of
  // two preview runs on the same state)
  const p1 = await run(fake, repo, { localDate: "2026-11-08" });
  const p2 = await run(fake, repo, { localDate: "2026-11-08" });
  assert.equal(p1.run.result.resultHash, p2.run.result.resultHash);
});

test("history: runs record joins/leaves; applied changes record when the tag changed in the store", async () => {
  const { products, sales } = catalog();
  const fake = createFakeShopify({ products, sales });
  const repo = createMemoryRepo();

  const first = await run(fake, repo);
  const productEvents = () => repo.events.filter((e) => ["joined", "already", "left"].includes(e.kind));
  assert.equal(first.status, "SUCCEEDED");
  assert.equal(repo.events.filter((e) => e.kind === "joined").length, 20, "20 untagged pacifiers are new");
  assert.equal(repo.events.filter((e) => e.kind === "already").length, 1, "the tagged bottle was already tagged");
  assert.equal(repo.members.size, 21);
  assert.equal(first.run.labelTag, "label:BESTSELLER");
  const afterFirst = productEvents().length;

  // Identical second run: no product is repeated, one "No changes" line
  await run(fake, repo, { localDate: "2026-11-07" });
  assert.equal(productEvents().length, afterFirst);
  const checked = repo.events.filter((e) => e.kind === "checked");
  assert.equal(checked.length, 2);
  assert.match(checked[1].detail, /^No changes: all 21 product\(s\) stay in the list/);

  // Approved update: each applied change is recorded with product, category and reason
  const approved = settings({ applyEnabled: true, applyAllowedShops: [SHOP] });
  await run(fake, repo, { options: { apply: true }, settings: approved, grantedScopes: "read_products,write_products,read_reports", localDate: "2026-11-08" });
  const applied = repo.events.filter((e) => e.kind === "tag_added" || e.kind === "tag_removed");
  assert.ok(applied.length > 0);
  assert.ok(applied.every((e) => e.title && e.category && e.legacyId && e.tag === "label:BESTSELLER"));
  assert.ok(applied.some((e) => e.kind === "tag_removed" && e.detail === "Bulk product"));
});

test("an add is skipped if the product became ineligible after the calculation", async () => {
  resetIds(30000);
  const target = product({ type: "Baby Bottle", tags: ["Unrelated"] });
  const fake = createFakeShopify({ products: [target], sales: { [target.legacyId]: 5 } });
  const { executeTagChanges } = await import("../app/bestseller/apply/apply.js");
  fake.editProduct(target.id, { status: "DRAFT" });
  const records = [];
  const summary = await executeTagChanges({
    graphql: fake.graphql,
    plan: [{ action: "add", productId: target.id, scope: "bottles" }],
    config: DEFAULT_CONFIG,
    record: async (r) => records.push(r),
  });
  assert.equal(summary.skipped, 1);
  assert.deepEqual(fake.store.get(target.id).tags, ["Unrelated"]);
});
