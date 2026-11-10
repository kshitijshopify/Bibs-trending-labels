import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_CONFIG, FLOW_SUMMARY_TRIGGER_HANDLE, FLOW_TRIGGER_HANDLE } from "../app/bestseller/config.js";
import { buildCategoryIndex } from "../app/bestseller/engine/categories.js";
import { buildCategoryTrend } from "../app/bestseller/engine/trend.js";
import { buildEmailBatches, buildSummaryEvent } from "../app/bestseller/flow/payload.js";
import { sendFlowEvents } from "../app/bestseller/flow/send.js";
import { startBestsellerRun } from "../app/bestseller/jobs/run-job.js";
import { analyticsView, scopeTotals } from "../app/bestseller/report/analytics.js";
import { combinedEmail } from "../app/bestseller/report/explain.js";
import { readSales, readSalesTrend } from "../app/bestseller/shopify/sales.js";
import { WINDOW, compute, product, resetIds } from "./helpers/builders.js";
import { createFakeShopify } from "./helpers/fake-shopify.js";
import { createMemoryRepo } from "./helpers/memory-repo.js";

const summaryToml = readFileSync(new URL("../extensions/bestseller-daily-summary/shopify.extension.toml", import.meta.url), "utf8");
const summarySchema = readFileSync(new URL("../extensions/bestseller-daily-summary/schema.graphql", import.meta.url), "utf8");
const summaryKeys = [...summaryToml.matchAll(/^\s*key = "([^"]+)"/gm)].map((m) => m[1]);
const fieldsOf = (schema, type) => {
  const block = new RegExp(`type ${type} \\{([\\s\\S]*?)\\n\\}`).exec(schema)[1];
  return [...block.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]).sort();
};

function sample() {
  resetIds(100000);
  const products = [
    ...Array.from({ length: 6 }, (_, i) => product({ type: "Pacifier", tags: i === 0 ? ["label:BESTSELLER"] : [] })),
    product({ type: "Baby Bottle", tags: ["label:BESTSELLER"] }),
    product({ type: "Loops" }),
    product({ type: "Teether", tags: ["label:BESTSELLER", "label:BULK"] }),
  ];
  const sales = Object.fromEntries(products.map((p, i) => [p.legacyId, 10 - i]));
  return { products, sales };
}

// ---- one combined email ------------------------------------------------------

test("the combined summary event matches its trigger TOML and schema", () => {
  const { products, sales } = sample();
  const event = buildSummaryEvent(compute(products, sales), { runId: "run-1", approvalUrl: "https://app.example/approve/x" });
  assert.equal(event.handle, FLOW_SUMMARY_TRIGGER_HANDLE);
  assert.deepEqual(Object.keys(event.payload).sort(), [...summaryKeys].sort());
  for (const key of summaryKeys) assert.match(key, /^[A-Za-z ]+$/);
  assert.deepEqual(Object.keys(event.payload.Summary).sort(), fieldsOf(summarySchema, "DailySummary"));
  assert.deepEqual(Object.keys(event.payload.Summary.categories[0]).sort(), fieldsOf(summarySchema, "CategoryPreview"));
  assert.equal(event.payload.Summary.categories.length, 3);
  assert.equal(typeof event.payload["Up to date"], "boolean");
  assert.ok(event.withinLimit);
});

test("summary line says 'No changes' when everything is already tagged", () => {
  resetIds(101000);
  const products = [product({ type: "Baby Bottle", tags: ["label:BESTSELLER"] })];
  const event = buildSummaryEvent(compute(products, {}), { runId: "r" });
  assert.equal(event.payload["Up to date"], true);
  assert.match(event.payload.Summary.summaryLine, /^No changes: all 1 selected product\(s\) already have label:BESTSELLER/);
});

test("email format decides which events are sent", () => {
  const { products, sales } = sample();
  const result = compute(products, sales);
  const options = { runId: "r" };
  const sizes = (format) => buildEmailBatches(result, options, format).map((batch) => batch.map((e) => e.handle));
  assert.deepEqual(sizes("separate"), [[FLOW_TRIGGER_HANDLE, FLOW_TRIGGER_HANDLE, FLOW_TRIGGER_HANDLE, FLOW_TRIGGER_HANDLE]]);
  assert.deepEqual(sizes("combined"), [[FLOW_SUMMARY_TRIGGER_HANDLE]]);
  assert.equal(sizes("both").flat().length, 5);
});

test("each event goes to its own trigger handle", async () => {
  const { products, sales } = sample();
  const fake = createFakeShopify();
  const [batch] = buildEmailBatches(compute(products, sales), { runId: "r" }, "combined");
  await sendFlowEvents({ graphql: fake.graphql, events: batch, record: async () => {} });
  assert.equal(fake.flowEvents.length, 1);
  assert.equal(fake.flowEvents[0].handle, FLOW_SUMMARY_TRIGGER_HANDLE);
});

test("a nightly run with the combined format sends exactly one email event", async () => {
  const { products, sales } = sample();
  const fake = createFakeShopify({ products, sales });
  const repo = createMemoryRepo();
  const started = await startBestsellerRun({
    shop: "fake.myshopify.com",
    trigger: "manual",
    localDate: "2026-11-06",
    options: { sendFlow: true },
    deps: {
      graphql: fake.graphql,
      fetchImpl: fake.fetchImpl,
      repo,
      settings: { flowTriggerEnabled: true, applyEnabled: false, applyAllowedShops: [], allowTimeZoneMismatch: false },
      config: DEFAULT_CONFIG,
      sleep: async () => {},
      pollIntervalMs: 0,
      grantedScopes: "read_products,read_reports",
      emailFormat: "combined",
      now: () => new Date("2026-11-06T01:00:00Z"),
    },
  });
  await started.done;
  assert.equal(fake.flowEvents.length, 1);
  assert.equal(fake.flowEvents[0].handle, FLOW_SUMMARY_TRIGGER_HANDLE);
  const result = repo.runs.get(started.runId).result;
  assert.ok(result.flowPayloads.some((p) => p.eventKey === "summary"), "the report shows the combined email size too");
});

test("combined email text lists every category, changes and the approval link", () => {
  const { products, sales } = sample();
  const email = combinedEmail(compute(products, sales), { approvalUrl: "https://app.example/approve/x" });
  assert.match(email.body, /Status: waiting for your approval/);
  assert.match(email.body, /== Pacifiers/);
  assert.match(email.body, /== Bottles/);
  assert.match(email.body, /== Accessories/);
  assert.match(email.body, /NEW/);
  assert.match(email.body, /Bulk products, tag would be removed: /);
  assert.match(email.body, /https:\/\/app.example\/approve\/x/);
  const applied = combinedEmail(compute(products, sales), { mode: "applied" });
  assert.match(applied.body, /Status: applied in the store/);
  assert.doesNotMatch(applied.body, /NEW/);
});

// ---- sales analytics ---------------------------------------------------------------

test("net sales are read next to units and summed per category", async () => {
  const { products, sales } = sample();
  const revenue = Object.fromEntries(products.map((p, i) => [p.legacyId, (10 - i) * 25.5]));
  const fake = createFakeShopify({ sales, revenue });
  const read = await readSales({ graphql: fake.graphql, window: WINDOW });
  assert.equal(read.revenue.get(products[0].legacyId), 255);
  assert.equal(read.completeness.revenueMetric, "net_sales");
  const result = compute(products, read.sales);
  const withRevenue = (await import("../app/bestseller/engine/compute.js")).computeBestsellers({
    products,
    sales: read.sales,
    revenue: read.revenue,
    window: WINDOW,
    currency: "DKK",
  });
  const pacifiers = withRevenue.categories.find((c) => c.key === "pacifiers");
  assert.equal(pacifiers.analytics.totalSales, (10 + 9 + 8 + 7 + 6 + 5) * 25.5);
  assert.equal(withRevenue.currency, "DKK");
  assert.equal(result.categories[0].analytics.totalSales, 0, "without revenue the sales stay 0");
});

test("daily trend maps product types to categories and fills every day", async () => {
  const trendRows = [
    { day: "2026-10-07", product_type: "Pacifier", net_items_sold: "3" },
    { day: "2026-10-07", product_type: "Colour Pacifier", net_items_sold: "2" },
    { day: "2026-10-08", product_type: "Baby Bottle", net_items_sold: "4" },
    { day: "2026-11-05", product_type: "Baby Bottle Accessories", net_items_sold: "1" },
    { day: "2026-11-05", product_type: "Teether", net_items_sold: "9" },
  ];
  const fake = createFakeShopify({ failures: { trendRows } });
  const { byType } = await readSalesTrend({ graphql: fake.graphql, window: WINDOW });
  const trend = buildCategoryTrend(byType, WINDOW, buildCategoryIndex(DEFAULT_CONFIG.categories), DEFAULT_CONFIG.categories);
  assert.equal(trend.days.length, 30);
  assert.equal(trend.days[0], "2026-10-07");
  assert.equal(trend.days[29], "2026-11-05");
  const series = Object.fromEntries(trend.series.map((s) => [s.key, s.values]));
  assert.equal(series.pacifiers[0], 5);
  assert.equal(series.bottles[1], 4);
  assert.equal(series.accessories[29], 1);
  assert.equal(series.pacifiers.reduce((a, b) => a + b, 0), 5, "Teether is outside the categories");
});

test("analytics view totals and per-category scope", () => {
  const { products, sales } = sample();
  const view = analyticsView(compute(products, sales));
  assert.equal(view.categories.length, 3);
  const pacifiers = view.categories.find((c) => c.key === "pacifiers");
  assert.equal(pacifiers.units, 10 + 9 + 8 + 7 + 6 + 5);
  assert.equal(pacifiers.ranking[0].rank, 1);
  assert.equal(view.totals.units, view.categories.reduce((n, c) => n + c.units, 0));
  assert.equal(scopeTotals(view, "pacifiers").units, pacifiers.units);
  assert.ok(pacifiers.ranking.every((p) => p.share !== null));
});
