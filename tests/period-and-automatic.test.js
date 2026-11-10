import { test } from "node:test";
import assert from "node:assert/strict";
import { APP_DEFAULT_LABEL_TAG, DEFAULT_CONFIG, LABEL_TAG_CHOICES, validateWindowDays } from "../app/bestseller/config.js";
import { startBestsellerRun, triggerScheduledRuns } from "../app/bestseller/jobs/run-job.js";
import { tagListView } from "../app/bestseller/report/views.js";
import { compute, product, resetIds } from "./helpers/builders.js";
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
  resetIds(110000);
  const products = Array.from({ length: 8 }, (_, i) => product({ type: "Pacifier", tags: i === 0 ? ["label:Trending"] : [] }));
  return { products, sales: Object.fromEntries(products.map((p, i) => [p.legacyId, 20 - i])) };
}

async function run({ days = 30, options = {}, s = settings(), fake, repo }) {
  const started = await startBestsellerRun({
    shop: SHOP,
    trigger: "manual",
    localDate: "2026-11-06",
    options,
    deps: {
      graphql: fake.graphql,
      fetchImpl: fake.fetchImpl,
      repo,
      settings: s,
      config: { ...DEFAULT_CONFIG, bestsellerTag: "label:Trending", salesWindowDays: days },
      sleep: async () => {},
      pollIntervalMs: 0,
      grantedScopes: "read_products,write_products,read_reports",
      storeUpdates: true,
      now: () => new Date("2026-11-06T01:00:00Z"),
      approvalUrl: () => "https://app.example/approve/x",
    },
  });
  await started.done;
  return repo.runs.get(started.runId);
}

test("the sales period accepts 1 to 365 whole days", () => {
  for (const ok of [1, 7, 14, 30, 90, 365]) assert.equal(validateWindowDays(ok).ok, true, String(ok));
  for (const bad of [0, -3, 1.5, 366, "abc", null]) assert.equal(validateWindowDays(bad).ok, false, String(bad));
});

test("the merchant-confirmed tag label:Trending is the default choice", () => {
  assert.equal(APP_DEFAULT_LABEL_TAG, "label:Trending");
  assert.equal(LABEL_TAG_CHOICES[0], "label:Trending");
});

for (const [days, start] of [
  [14, "2026-10-23"],
  [30, "2026-10-07"],
  [90, "2026-08-08"],
]) {
  test(`a ${days}-day period is used for the window and the ShopifyQL dates`, async () => {
    const { products, sales } = catalog();
    const fake = createFakeShopify({ products, sales });
    const record = await run({ days, fake, repo: createMemoryRepo() });
    assert.equal(record.status, "SUCCEEDED");
    assert.equal(record.result.window.days, days);
    assert.equal(record.result.window.startDate, start);
    assert.equal(record.result.window.endDate, "2026-11-05");
    const queries = fake.calls.filter((c) => c.name === "BblShopifyql").map((c) => c.variables.query);
    assert.ok(queries.some((q) => q.includes(`SINCE ${start} UNTIL 2026-11-05`)));
    assert.equal(tagListView(record.result).window.days, days);
  });
}

test("automatic mode: the nightly run applies by itself and emails what changed", async () => {
  const { products, sales } = catalog();
  const fake = createFakeShopify({ products, sales });
  const repo = createMemoryRepo();
  const live = settings({ applyEnabled: true, applyAllowedShops: [SHOP], flowTriggerEnabled: true });
  const results = await triggerScheduledRuns({
    shops: [SHOP],
    now: new Date("2026-11-06T01:00:00Z"), // 02:00 Copenhagen
    repo,
    settings: live,
    config: { ...DEFAULT_CONFIG, bestsellerTag: "label:Trending" },
    approvalModeForShop: async () => "automatic",
    makeDeps: async () => ({
      graphql: fake.graphql,
      fetchImpl: fake.fetchImpl,
      sleep: async () => {},
      pollIntervalMs: 0,
      grantedScopes: "read_products,write_products,read_reports",
      storeUpdates: true,
      now: () => new Date("2026-11-06T01:00:00Z"),
      approvalUrl: () => "https://app.example/approve/x",
    }),
  });
  assert.equal(results[0].started, true);
  for (let i = 0; i < 100 && [...repo.runs.values()].some((r) => r.status === "RUNNING"); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const record = [...repo.runs.values()][0];
  assert.equal(record.applyStatus, "DONE");
  assert.ok(fake.operationNames().includes("BblTagsAdd"), "tags were added without an approval step");
  assert.equal(repo.approvals[0].via, "automatic");
  assert.ok(fake.flowEvents.length > 0);
  assert.ok(fake.flowEvents.every((e) => e.payload.Mode === "applied"), "the email reports what was changed");
});

test("automatic mode before go-live: nothing changes and the email says updates are off", async () => {
  const { products, sales } = catalog();
  const fake = createFakeShopify({ products, sales });
  await run({ options: { sendFlow: true, approvalMode: "automatic" }, s: settings({ flowTriggerEnabled: true }), fake, repo: createMemoryRepo() });
  assert.ok(!fake.operationNames().includes("BblTagsAdd"));
  assert.ok(fake.flowEvents.every((e) => e.payload.Status === "Preview: store updates are off, nothing was changed"));
});

test("manual mode keeps asking for approval in the email", async () => {
  const { products, sales } = catalog();
  const fake = createFakeShopify({ products, sales });
  await run({ options: { sendFlow: true, approvalMode: "manual" }, s: settings({ flowTriggerEnabled: true }), fake, repo: createMemoryRepo() });
  assert.ok(fake.flowEvents.every((e) => e.payload.Status === "Preview: approval needed"));
});

test("tag list exposes products to add, remove and keep", () => {
  resetIds(120000);
  const products = [
    product({ type: "Baby Bottle" }), // add
    product({ type: "Baby Bottle", tags: ["label:Trending"] }), // keep
    product({ type: "Baby Bottle", status: "DRAFT", tags: ["label:Trending"] }), // remove
  ];
  const view = tagListView(compute(products, { [products[0].legacyId]: 3 }, { ...DEFAULT_CONFIG, bestsellerTag: "label:Trending" }));
  assert.equal(view.totals.willGet, 1);
  assert.equal(view.totals.staying, 1);
  assert.equal(view.totals.willLose, 1);
});
