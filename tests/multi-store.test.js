import { test } from "node:test";
import assert from "node:assert/strict";
import { applyGuard, resolveScheduledShops, shopListed } from "../app/bestseller/jobs/guards.js";
import { triggerScheduledRuns } from "../app/bestseller/jobs/run-job.js";
import { product, resetIds } from "./helpers/builders.js";
import { createFakeShopify } from "./helpers/fake-shopify.js";
import { createMemoryRepo } from "./helpers/memory-repo.js";

// Two live stores, no domain hard-coded anywhere: "*" means every installed shop.
const SHOP_A = "store-a.myshopify.com";
const SHOP_B = "store-b.myshopify.com";

function settings(overrides = {}) {
  return {
    flowTriggerEnabled: false,
    applyEnabled: false,
    applyAllowedShops: [],
    allowTimeZoneMismatch: false,
    devWindowIncludeToday: false,
    cronShops: ["*"],
    cronSecret: "",
    ...overrides,
  };
}

test("shopListed: * matches every shop, an empty list matches none", () => {
  assert.equal(shopListed(["*"], SHOP_A), true);
  assert.equal(shopListed(["*"], SHOP_B), true);
  assert.equal(shopListed([], SHOP_A), false);
  assert.equal(shopListed(undefined, SHOP_A), false);
  assert.equal(shopListed([SHOP_A], SHOP_A), true);
  assert.equal(shopListed([SHOP_A], "Store-A.myshopify.com"), true);
  assert.equal(shopListed([SHOP_A], SHOP_B), false);
});

test("apply guard: * allows both stores; each store still needs its own in-app switch", () => {
  const s = settings({ applyEnabled: true, applyAllowedShops: ["*"] });
  for (const shop of [SHOP_A, SHOP_B]) {
    const on = applyGuard({ settings: s, shop, grantedScopes: "read_products,read_reports,write_products", runSucceeded: true, storeUpdates: true });
    assert.equal(on.allowed, true, shop);
    const off = applyGuard({ settings: s, shop, grantedScopes: "read_products,read_reports,write_products", runSucceeded: true, storeUpdates: false });
    assert.equal(off.allowed, false, shop);
  }
  const none = applyGuard({ settings: settings({ applyEnabled: true }), shop: SHOP_A, grantedScopes: "write_products", runSucceeded: true, storeUpdates: true });
  assert.equal(none.allowed, false);
  assert.ok(none.reasons.some((r) => r.includes("BESTSELLER_APPLY_ALLOWED_SHOPS")));
});

test("scheduled shops: * expands to the installed shops, sorted and without duplicates", () => {
  const installed = [SHOP_B, "Store-A.myshopify.com", SHOP_B, ""];
  assert.deepEqual(resolveScheduledShops(["*"], installed), [SHOP_A, SHOP_B]);
  assert.deepEqual(resolveScheduledShops(["*"], []), []);
  assert.deepEqual(resolveScheduledShops([], installed), []);
  assert.deepEqual(resolveScheduledShops([SHOP_B], installed), [SHOP_B]);
  assert.deepEqual(resolveScheduledShops(["*", "store-c.myshopify.com"], [SHOP_A]), [SHOP_A, "store-c.myshopify.com"]);
});

test("nightly scheduler runs every installed store separately", async () => {
  resetIds(40000);
  const products = Array.from({ length: 10 }, () => product({ type: "Pacifier" }));
  const sales = Object.fromEntries(products.map((p, i) => [p.legacyId, i]));
  const fakes = { [SHOP_A]: createFakeShopify({ products, sales }), [SHOP_B]: createFakeShopify({ products, sales }) };
  const repo = createMemoryRepo();
  const makeDeps = async (shop) => ({
    graphql: fakes[shop].graphql,
    fetchImpl: fakes[shop].fetchImpl,
    sleep: async () => {},
    pollIntervalMs: 0,
    grantedScopes: "read_products,read_reports",
    storeUpdates: false,
    now: () => new Date("2027-07-01T00:00:00Z"),
  });
  // Summer: 00:00 UTC = 02:00 Copenhagen.
  const shops = resolveScheduledShops(["*"], [SHOP_B, SHOP_A]);
  const results = await triggerScheduledRuns({ shops, now: new Date("2027-07-01T00:00:00Z"), repo, settings: settings(), makeDeps });
  assert.deepEqual(results.map((r) => [r.shop, r.started]), [[SHOP_A, true], [SHOP_B, true]]);

  for (let i = 0; i < 100 && [...repo.runs.values()].some((r) => r.status === "RUNNING"); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const runs = [...repo.runs.values()];
  assert.deepEqual(runs.map((r) => r.shop).sort(), [SHOP_A, SHOP_B]);
  assert.ok(runs.every((r) => r.status === "SUCCEEDED"), JSON.stringify(runs.map((r) => [r.shop, r.status, r.error])));
});
