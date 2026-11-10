// Network failures ("fetch failed", no response) must be retried only where
// repeating the call cannot create duplicates.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGraphqlClient, isRetrySafe } from "../app/bestseller/shopify/graphql.js";

class HttpRequestError extends Error {}
const networkError = () => new HttpRequestError("Http request error, no response available: GraphQL Client: fetch failed");
const ok = (data) => ({ json: async () => ({ data }) });
const noSleep = async () => {};

function flakyAdmin(failuresBefore, data = { ok: true }) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    graphql: async () => {
      calls += 1;
      if (calls <= failuresBefore) throw networkError();
      return ok(data);
    },
  };
}

test("queries and retry-safe mutations are classified correctly", () => {
  assert.equal(isRetrySafe("query BblShopInfo { shop { name } }"), true);
  assert.equal(isRetrySafe("#graphql\n mutation BblTagsAdd($id: ID!) { x }"), true);
  assert.equal(isRetrySafe("mutation BblTagsRemove { x }"), true);
  assert.equal(isRetrySafe("mutation BblStartCatalogExport { x }"), true);
  assert.equal(isRetrySafe("mutation SomethingElse { x }"), false);
  assert.equal(isRetrySafe("mutation BblFlowTrigger { x }"), false);
});

test("a query survives transient network errors", async () => {
  const admin = flakyAdmin(2, { shop: { name: "x" } });
  const graphql = createGraphqlClient(admin, { sleep: noSleep });
  const data = await graphql("query BblShopInfo { shop { name } }");
  assert.equal(data.shop.name, "x");
  assert.equal(admin.calls, 3);
});

test("a non-idempotent mutation is NOT resent after a network error", async () => {
  const admin = flakyAdmin(1);
  const graphql = createGraphqlClient(admin, { sleep: noSleep });
  await assert.rejects(graphql("mutation BblFlowTrigger { x }"), (error) => error.code === "NETWORK_ERROR" && /not safe to repeat/.test(error.message));
  assert.equal(admin.calls, 1);
});

test("a tag change is resent after a network error (repeating it is harmless)", async () => {
  const admin = flakyAdmin(1, { tagsRemove: { node: { id: "1", tags: [] }, userErrors: [] } });
  const graphql = createGraphqlClient(admin, { sleep: noSleep });
  await graphql("mutation BblTagsRemove { x }");
  assert.equal(admin.calls, 2);
});

test("throttling is retried for every operation type", async () => {
  let calls = 0;
  const admin = {
    graphql: async () => {
      calls += 1;
      if (calls === 1) return { json: async () => ({ errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] }) };
      return ok({ flowTriggerReceive: { userErrors: [] } });
    },
  };
  const graphql = createGraphqlClient(admin, { sleep: noSleep });
  await graphql("mutation BblFlowTrigger { x }");
  assert.equal(calls, 2);
});
