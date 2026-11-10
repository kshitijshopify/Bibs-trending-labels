import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, validateLabelTag } from "../app/bestseller/config.js";
import { actionCounts, actionList, previewEmail, removalReason, seasonStory, selectionReason } from "../app/bestseller/report/explain.js";
import { category, compute, product, resetIds } from "./helpers/builders.js";

function sample(config) {
  resetIds(60000);
  const tag = config?.bestsellerTag ?? "label:BESTSELLER";
  const products = [
    product({ type: "Pacifier", status: "DRAFT", tags: ["SS28"] }), // SS28 skipped
    product({ type: "Pacifier", tags: ["AW27"] }), // launch, zero sales
    product({ type: "Pacifier", tags: [tag] }), // top seller, keep
    product({ type: "Pacifier", tags: [] }), // add
    product({ type: "Pacifier", tags: [tag, "Qty:Bulk"] }), // remove (Bulk)
    product({ type: "Teether", tags: [tag] }), // review
    product({ type: "Teether", tags: [tag, "label:BULK"] }), // cleanup
  ];
  const sales = { [products[2].legacyId]: 50, [products[3].legacyId]: 20 };
  return { products, result: compute(products, sales, config) };
}

test("the label tag is configurable and drives add/remove/keep", () => {
  const trending = { ...DEFAULT_CONFIG, bestsellerTag: "label:Trending" };
  const { result } = sample(trending);
  const pacifiers = category(result, "pacifiers");
  assert.equal(result.config.bestsellerTag, "label:Trending");
  assert.equal(pacifiers.wouldKeep.length, 1);
  assert.equal(pacifiers.wouldRemove.length, 1);
  assert.equal(result.cleanup.length, 1);
  assert.equal(result.review.length, 1);
  // label:BESTSELLER is now just an unrelated tag
  const { result: other } = sample(DEFAULT_CONFIG);
  assert.equal(category(other, "pacifiers").wouldKeep.length, 1);
});

test("label tag validation rejects unsafe values", () => {
  assert.equal(validateLabelTag("label:Trending").ok, true);
  assert.equal(validateLabelTag("label:BESTSELLER").ok, true);
  for (const bad of ["", "a,b", "label:BULK", "Qty:Bulk", "AW27", "label:SS27-1"]) {
    assert.equal(validateLabelTag(bad).ok, false, bad);
  }
});

test("action list explains every proposed change in plain words", () => {
  const { result } = sample();
  const rows = actionList(result);
  const counts = actionCounts(result);
  assert.equal(rows.length, counts.add + counts.remove + counts.keep + counts.cleanup + counts.review);
  const byAction = (a) => rows.filter((r) => r.action === a);
  assert.match(byAction("keep")[0].why, /Top seller: #1 in Pacifiers with 50 units; already tagged/);
  assert.ok(byAction("add").some((r) => /Newest launch AW27: reserved place \(no sales yet\)/.test(r.why)));
  assert.match(byAction("remove")[0].why, /Bulk product/);
  assert.match(byAction("cleanup")[0].why, /Bulk product/);
  assert.match(byAction("review")[0].why, /not in any category/);
});

test("season story says why newer seasons were skipped", () => {
  const { result } = sample();
  const story = seasonStory(category(result, "pacifiers"));
  assert.match(story[0], /SS28 skipped: all 1 pacifiers in this season are inactive or Bulk/);
  assert.match(story[1], /AW27 chosen/);
});

test("removal reason for a product that dropped out of the top places", () => {
  const pacifiers = { name: "Pacifiers", total: 20 };
  assert.equal(
    removalReason({ status: "ACTIVE", bulkReasons: [], overallRank: 27, netUnits: 3 }, pacifiers),
    "No longer in the top 20 (rank #27, 3 units)",
  );
  assert.match(removalReason({ status: "ARCHIVED", bulkReasons: [] }, pacifiers), /archived/);
});

test("selection reason distinguishes reserved launch places and sales ranking", () => {
  const cat = { name: "Bottles", launch: { chosenSeason: "SS27" } };
  assert.equal(selectionReason({ pickedAs: "launch-reserved", netUnits: 4 }, cat), "Newest launch SS27: reserved place (4 units sold)");
  assert.equal(
    selectionReason({ pickedAs: "sales-ranking", netUnits: 9, overallRank: 2, isLaunch: true }, cat),
    "Top seller: #2 in Bottles with 9 units (also from launch SS27)",
  );
});

test("preview email shows season, source, window, products with sales, changes and shortfall", () => {
  const { result } = sample();
  const email = previewEmail(result, category(result, "bottles"));
  assert.match(email.subject, /label:BESTSELLER preview – Bottles/);
  assert.match(email.body, /Sales window: 2026-10-07 00:00:00 – 2026-11-05 23:59:59 \(Europe\/Copenhagen\)/);
  assert.match(email.body, /Newest eligible launch: none qualifies/);
  assert.match(email.body, /Selected: 0 of 5 \(shortfall 5\)/);
  const pacifierEmail = previewEmail(result, category(result, "pacifiers")).body;
  assert.match(pacifierEmail, /AW27 \(plain season tags\)/);
  assert.match(pacifierEmail, /Would remove the tag \(1\)/);
  assert.match(pacifierEmail, /Preview only/);
});

test("category analytics and ranking are part of the result", () => {
  const { result } = sample();
  const pacifiers = category(result, "pacifiers");
  assert.equal(pacifiers.analytics.totalUnits, 70);
  assert.equal(pacifiers.analytics.productsWithSales, 2);
  assert.equal(pacifiers.analytics.launchProducts, 1);
  assert.equal(pacifiers.ranking.length, pacifiers.counts.eligible);
  assert.ok(pacifiers.ranking.every((p, i) => p.overallRank === i + 1));
});
