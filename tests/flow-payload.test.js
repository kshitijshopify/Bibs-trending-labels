import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FLOW_PAYLOAD_LIMIT_BYTES } from "../app/bestseller/config.js";
import { buildFlowEvents } from "../app/bestseller/flow/payload.js";
import { sendFlowEvents } from "../app/bestseller/flow/send.js";
import { compute, product, resetIds } from "./helpers/builders.js";
import { createFakeShopify } from "./helpers/fake-shopify.js";

const toml = readFileSync(new URL("../extensions/bestseller-preview-ready/shopify.extension.toml", import.meta.url), "utf8");
const schema = readFileSync(new URL("../extensions/bestseller-preview-ready/schema.graphql", import.meta.url), "utf8");
const tomlKeys = [...toml.matchAll(/^\s*key = "([^"]+)"/gm)].map((m) => m[1]);

function sampleResult() {
  resetIds(40000);
  const products = Array.from({ length: 40 }, (_, i) =>
    product({ type: i % 2 ? "Pacifier" : "Loops", tags: i % 5 === 0 ? ["label:BESTSELLER", "AW27"] : [] }),
  );
  return compute(products, Object.fromEntries(products.map((p, i) => [p.legacyId, i])));
}

test("every event carries exactly the fields declared in the trigger TOML", () => {
  const events = buildFlowEvents(sampleResult(), { runId: "run-1" });
  assert.equal(events.length, 4);
  for (const event of events) {
    assert.deepEqual(Object.keys(event.payload).sort(), [...tomlKeys].sort());
  }
  for (const key of tomlKeys) assert.match(key, /^[A-Za-z ]+$/, `Flow keys allow letters and spaces only: ${key}`);
});

test("every trigger description fits Shopify's 140-character limit", () => {
  for (const folder of ["bestseller-preview-ready", "bestseller-daily-summary"]) {
    const text = readFileSync(new URL(`../extensions/${folder}/shopify.extension.toml`, import.meta.url), "utf8");
    for (const [, description] of text.matchAll(/^\s*description = "([^"]*)"/gm)) {
      assert.ok(description.length <= 140, `${folder}: ${description.length} characters: ${description}`);
    }
  }
});

test("report objects match the schema.graphql field names", () => {
  const events = buildFlowEvents(sampleResult(), { runId: "run-1" });
  const typeFields = (name) => {
    const block = new RegExp(`type ${name} \\{([\\s\\S]*?)\\n\\}`).exec(schema)[1];
    return [...block.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]).sort();
  };
  assert.deepEqual(Object.keys(events[0].payload.Report).sort(), typeFields("CategoryPreview"));
  assert.deepEqual(Object.keys(events[0].payload.Report.selected[0]).sort(), typeFields("PreviewProduct"));
});

test("payload sizes are measured; realistic payloads fit under the limit", () => {
  const events = buildFlowEvents(sampleResult(), { runId: "run-1" });
  for (const event of events) {
    assert.equal(event.bytes, Buffer.byteLength(JSON.stringify(event.payload)));
    assert.ok(event.withinLimit);
  }
});

test("if any event is over the limit nothing is sent (no truncation)", async () => {
  const events = buildFlowEvents(sampleResult(), { runId: "run-1" });
  events[1] = { ...events[1], bytes: FLOW_PAYLOAD_LIMIT_BYTES + 1, withinLimit: false };
  const fake = createFakeShopify();
  const records = [];
  const outcome = await sendFlowEvents({ graphql: fake.graphql, events, record: async (k, d) => records.push([k, d.status]) });
  assert.equal(outcome.blocked, true);
  assert.equal(fake.flowEvents.length, 0);
  assert.ok(records.every(([, status]) => status === "BLOCKED_PAYLOAD_TOO_LARGE"));
});

test("already-sent events are not resent", async () => {
  const events = buildFlowEvents(sampleResult(), { runId: "run-1" });
  const fake = createFakeShopify();
  await sendFlowEvents({ graphql: fake.graphql, events, alreadySent: new Set(["pacifiers", "bottles"]), record: async () => {} });
  assert.deepEqual(fake.flowEvents.map((e) => e.payload.Category), ["Accessories", "Cleanup and review"]);
});
