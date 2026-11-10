import { test } from "node:test";
import assert from "node:assert/strict";
import { IncompleteReadError } from "../app/bestseller/errors.js";
import { readCatalog } from "../app/bestseller/shopify/catalog.js";
import { readSales } from "../app/bestseller/shopify/sales.js";
import { ALL_STATUSES_QUERY, CATALOG_BULK_QUERY } from "../app/bestseller/shopify/queries.js";
import { WINDOW, product, resetIds } from "./helpers/builders.js";
import { createFakeShopify } from "./helpers/fake-shopify.js";

const noSleep = async () => {};

function bigCatalog(n) {
  resetIds(10000);
  const statuses = ["ACTIVE", "DRAFT", "ARCHIVED", "UNLISTED"];
  return Array.from({ length: n }, (_, i) => product({ status: statuses[i % 4], tags: [`t${i}`] }));
}

test("catalog export requests every status (the API defaults to ACTIVE only)", () => {
  assert.equal(ALL_STATUSES_QUERY, "status:active,archived,draft,unlisted");
  assert.ok(CATALOG_BULK_QUERY.includes(ALL_STATUSES_QUERY));
});

test("a catalog of more than 100 products (all statuses) is read completely", async () => {
  const products = bigCatalog(1234);
  const fake = createFakeShopify({ products });
  const { products: read, completeness } = await readCatalog({ graphql: fake.graphql, fetchImpl: fake.fetchImpl, sleep: noSleep });
  assert.equal(read.length, 1234);
  assert.equal(completeness.productsCountBefore, 1234);
  assert.equal(completeness.productsCountAfter, 1234);
  assert.equal(new Set(read.map((p) => p.status)).size, 4);
});

for (const [name, failures, code] of [
  ["bulk operation FAILED", { bulkStatus: "FAILED" }, "CATALOG_EXPORT_FAILED"],
  ["bulk operation CANCELED", { bulkStatus: "CANCELED" }, "CATALOG_EXPORT_FAILED"],
  ["partial data", { partialData: true }, "CATALOG_EXPORT_FAILED"],
  ["a missing JSONL line", { dropJsonlLine: true }, "CATALOG_COUNT_MISMATCH"],
  ["catalog changing during the read", { countDrift: true }, "CATALOG_COUNT_MISMATCH"],
  ["download error", { downloadHttpStatus: 500 }, "CATALOG_DOWNLOAD_FAILED"],
]) {
  test(`incomplete catalog read fails: ${name}`, async () => {
    const fake = createFakeShopify({ products: bigCatalog(150), failures });
    await assert.rejects(
      readCatalog({ graphql: fake.graphql, fetchImpl: fake.fetchImpl, sleep: noSleep }),
      (error) => error instanceof IncompleteReadError && error.code === code,
    );
  });
}

test("sales result sets larger than one page are read completely", async () => {
  const sales = {};
  for (let i = 0; i < 2345; i += 1) sales[String(50000 + i)] = (i % 17) - 2; // includes negatives
  const fake = createFakeShopify({ sales, unattributedUnits: 7 });
  const { sales: read, completeness } = await readSales({ graphql: fake.graphql, window: WINDOW, pageSize: 1000 });
  assert.equal(read.size, 2345);
  assert.equal(completeness.pages, 3);
  assert.equal(completeness.unattributedUnits, 7);
  assert.equal(read.get("50003"), 1);
});

test("ShopifyQL queries use the exact window dates", async () => {
  const fake = createFakeShopify({ sales: { 1: 1 } });
  await readSales({ graphql: fake.graphql, window: WINDOW });
  const queries = fake.calls.filter((c) => c.name === "BblShopifyql").map((c) => c.variables.query);
  assert.ok(queries.every((q) => q.includes("SINCE 2026-10-07 UNTIL 2026-11-05")));
  assert.ok(queries.some((q) => q.includes("GROUP BY product_id")));
});

test("silently truncated sales pages are detected by the total check", async () => {
  const sales = {};
  for (let i = 0; i < 300; i += 1) sales[String(70000 + i)] = 1;
  const fake = createFakeShopify({ sales, failures: { shopifyqlPageCap: 100 } });
  await assert.rejects(
    readSales({ graphql: fake.graphql, window: WINDOW, pageSize: 250 }),
    (error) => error.code === "SALES_TOTAL_MISMATCH",
  );
});

test("a window without sales succeeds (ShopifyQL returns an empty result without columns)", async () => {
  const fake = createFakeShopify({ sales: {} });
  const { sales, completeness } = await readSales({ graphql: fake.graphql, window: WINDOW });
  assert.equal(sales.size, 0);
  assert.equal(completeness.grandTotal, 0);
  assert.equal(completeness.rowsRead, 0);
});

test("an empty grouped result while the report total has sales fails", async () => {
  const fake = createFakeShopify({ sales: { 1: 4, 2: 1 }, failures: { groupedAlwaysEmpty: true } });
  await assert.rejects(
    readSales({ graphql: fake.graphql, window: WINDOW }),
    (error) => error.code === "SALES_TOTAL_MISMATCH",
  );
});

test("rows without the expected columns fail", async () => {
  const fake = createFakeShopify({ sales: { 1: 4 }, failures: { wrongColumnName: true } });
  await assert.rejects(
    readSales({ graphql: fake.graphql, window: WINDOW }),
    (error) => error.code === "SALES_COLUMN_MISSING",
  );
});

test("ShopifyQL parse errors fail the read", async () => {
  const fake = createFakeShopify({ sales: { 1: 1 }, failures: { shopifyqlParseError: true } });
  await assert.rejects(readSales({ graphql: fake.graphql, window: WINDOW }), (error) => error.code === "SALES_PARSE_ERROR");
});
