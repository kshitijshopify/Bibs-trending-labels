import { test } from "node:test";
import assert from "node:assert/strict";
import { BULK_RULES } from "../app/bestseller/config.js";
import { bulkReasons } from "../app/bestseller/engine/products.js";
import { category, compute, ids, product, resetIds } from "./helpers/builders.js";

test("every Bulk marker excludes a product (case-insensitive)", () => {
  resetIds(100);
  const cases = [
    product({ tags: ["label:BULK"] }),
    product({ tags: ["LABEL:bulk"] }),
    product({ tags: ["Qty:Bulk"] }),
    product({ tags: ["qty:BULK"] }),
    product({ title: "Pacifier Bulk 50 pcs" }),
    product({ title: "pacifier BULK" }),
  ];
  for (const p of cases) assert.ok(bulkReasons(p, BULK_RULES).length > 0, `${p.title} ${p.tags}`);
  const clean = product({ tags: ["label:BESTSELLER", "Qty:10"] });
  assert.equal(bulkReasons(clean, BULK_RULES).length, 0);

  const pacifiers = category(compute([...cases, clean]), "pacifiers");
  assert.deepEqual(ids(pacifiers.selected), [clean.legacyId]);
});

test("labeled Bulk and inactive products of a category appear in would-remove", () => {
  resetIds(200);
  const bulkLabeled = product({ tags: ["label:BESTSELLER", "Qty:Bulk"] });
  const draftLabeled = product({ status: "DRAFT", tags: ["label:BESTSELLER"] });
  const keep = product({ tags: ["label:BESTSELLER"] });
  const add = product({ tags: [] });
  const pacifiers = category(compute([bulkLabeled, draftLabeled, keep, add]), "pacifiers");
  assert.deepEqual(ids(pacifiers.wouldKeep), [keep.legacyId]);
  assert.deepEqual(ids(pacifiers.wouldAdd), [add.legacyId]);
  assert.deepEqual(ids(pacifiers.wouldRemove), [bulkLabeled.legacyId, draftLabeled.legacyId]);
  assert.match(pacifiers.wouldRemove[0].removeReasons.join(" "), /Bulk/);
  assert.match(pacifiers.wouldRemove[1].removeReasons.join(" "), /DRAFT/);
});

test("labeled products no longer selected are proposed for removal", () => {
  resetIds(300);
  const products = Array.from({ length: 7 }, () => product({ type: "Baby Bottle", tags: ["label:BESTSELLER"] }));
  const sales = Object.fromEntries(products.map((p, i) => [p.legacyId, 70 - i]));
  const bottles = category(compute(products, sales), "bottles");
  assert.equal(bottles.wouldKeep.length, 5);
  assert.deepEqual(ids(bottles.wouldRemove), [products[5].legacyId, products[6].legacyId]);
  assert.deepEqual(bottles.wouldRemove[0].removeReasons, ["not selected"]);
});

test("labeled Bulk products outside the mappings go to a deduplicated cleanup list; others to review", () => {
  resetIds(400);
  const bulkTwice = product({ type: "Teether", title: "Bulk teether", tags: ["label:BESTSELLER", "label:BULK", "LABEL:bestseller"] });
  const bulkTag = product({ type: "Teether", tags: ["label:BESTSELLER", "Qty:Bulk"] });
  const review = product({ type: "Teether", tags: ["label:BESTSELLER"] });
  const noType = product({ type: "", tags: ["label:BESTSELLER"] });
  const unlabeled = product({ type: "Teether", tags: ["label:BULK"] });
  const result = compute([bulkTwice, bulkTag, review, noType, unlabeled]);
  assert.deepEqual(ids(result.cleanup), [bulkTwice.legacyId, bulkTag.legacyId]);
  assert.deepEqual(ids(result.review), [review.legacyId, noType.legacyId]);
  assert.deepEqual(result.cleanup[0].bestsellerTags, ["label:BESTSELLER", "LABEL:bestseller"]);
});

test("bestseller tag detection is case-insensitive and keeps the stored spelling", () => {
  resetIds(500);
  const p = product({ tags: ["Label:Bestseller", "Colour:Ivory"] });
  const pacifiers = category(compute([p]), "pacifiers");
  assert.deepEqual(ids(pacifiers.wouldKeep), [p.legacyId]);
  assert.deepEqual(pacifiers.wouldKeep[0].bestsellerTags, ["Label:Bestseller"]);
});
