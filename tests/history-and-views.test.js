import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../app/bestseller/config.js";
import { collapseHistory, membershipChanges } from "../app/bestseller/report/history.js";
import { nextNightlyRunLabel, tagListView } from "../app/bestseller/report/views.js";
import { compute, product, resetIds } from "./helpers/builders.js";

function bottles() {
  resetIds(70000);
  return Array.from({ length: 7 }, (_, i) => product({ type: "Baby Bottle", tags: i < 2 ? ["label:BESTSELLER"] : [] }));
}

const meta = { runId: "run-x", localDate: "2026-11-06" };

/** Applies membership changes to an in-memory member list, like the repository. */
function applyMembers(members, changes) {
  const byId = new Map(members.map((m) => [m.productId, m]));
  for (const j of changes.joins) byId.set(j.productId, { ...j, since: "2026-11-06T01:00:00Z" });
  for (const id of changes.removals) byId.delete(id);
  return [...byId.values()];
}

const productEvents = (changes) => changes.events.filter((e) => e.kind !== "checked");

test("first run: untagged products are new, tagged ones are 'already tagged', plus one summary line", () => {
  const products = bottles();
  const result = compute(products, Object.fromEntries(products.map((p, i) => [p.legacyId, 70 - i])));
  const changes = membershipChanges([], result, meta);
  assert.deepEqual(
    productEvents(changes).map((e) => e.kind),
    ["already", "already", "joined", "joined", "joined"],
  );
  assert.equal(productEvents(changes)[0].detail, "Best seller #1 (70 sold) · already had the tag, nothing to change");
  assert.equal(productEvents(changes)[2].detail, "Best seller #3 (68 sold) · needs the tag");
  const summary = changes.events.find((e) => e.kind === "checked");
  assert.equal(summary.detail, "3 new, 2 added to the list (already tagged), 0 unchanged");
});

test("unchanged list: no product lines, only 'No changes'", () => {
  const products = bottles();
  const sales = Object.fromEntries(products.map((p, i) => [p.legacyId, 70 - i]));
  const members = applyMembers([], membershipChanges([], compute(products, sales), meta));
  const again = membershipChanges(members, compute(products, sales), meta);
  assert.deepEqual(productEvents(again), []);
  assert.equal(again.events[0].kind, "checked");
  assert.equal(again.events[0].detail, "No changes: all 5 product(s) stay in the list");
});

test("real changes only: a product joins, another leaves, with reasons", () => {
  const products = bottles();
  const sales = Object.fromEntries(products.map((p, i) => [p.legacyId, 70 - i]));
  const members = applyMembers([], membershipChanges([], compute(products, sales), meta));
  sales[products[6].legacyId] = 500;
  const changes = membershipChanges(members, compute(products, sales), meta);
  assert.deepEqual(
    productEvents(changes).map((e) => [e.kind, e.legacyId]),
    [
      ["joined", products[6].legacyId],
      ["left", products[4].legacyId],
    ],
  );
  assert.match(productEvents(changes)[1].detail, /Dropped to #6 \(66 sold\)/);
  assert.equal(changes.summary, "1 new, 1 left, 4 unchanged");
});

test("running many times never repeats a product", () => {
  const products = bottles();
  const sales = Object.fromEntries(products.map((p, i) => [p.legacyId, 70 - i]));
  let members = [];
  const all = [];
  for (let i = 0; i < 5; i += 1) {
    const changes = membershipChanges(members, compute(products, sales), meta);
    members = applyMembers(members, changes);
    all.push(...productEvents(changes));
  }
  assert.equal(all.length, 5, "each product is recorded once");
  assert.equal(new Set(all.map((e) => e.productId)).size, 5);
});

test("each tag keeps its own list", () => {
  const products = bottles();
  const sales = Object.fromEntries(products.map((p, i) => [p.legacyId, 70 - i]));
  const trending = compute(products, sales, { ...DEFAULT_CONFIG, bestsellerTag: "label:Trending" });
  const changes = membershipChanges([], trending, meta);
  assert.ok(changes.events.every((e) => e.tag === "label:Trending"));
  // none of these products has label:Trending yet, so all are new for that tag
  assert.equal(productEvents(changes).filter((e) => e.kind === "joined").length, 5);
});

test("history display hides repeated entries left over from older versions", () => {
  const e = (kind, productId, at) => ({ kind, productId, tag: "label:BESTSELLER", at });
  const newestFirst = [
    e("joined", "A", 5), // repeat -> hidden
    e("checked", null, 4),
    e("already", "A", 3), // repeat -> hidden
    e("left", "B", 2),
    e("joined", "A", 1),
    e("joined", "B", 0),
  ];
  const kept = collapseHistory(newestFirst);
  assert.deepEqual(
    kept.map((x) => `${x.kind}:${x.productId ?? "-"}`),
    ["checked:-", "left:B", "joined:A", "joined:B"],
  );
});

test("tag list: totals and short reasons are easy to read", () => {
  resetIds(80000);
  const products = [
    product({ type: "Pacifier", tags: ["AW27"] }), // new launch, new
    product({ type: "Pacifier", tags: ["label:BESTSELLER"] }), // best seller, already tagged
    product({ type: "Pacifier", status: "ARCHIVED", tags: ["label:BESTSELLER"] }), // loses: not active
    product({ type: "Teether", tags: ["label:BESTSELLER"] }), // check manually
    product({ type: "Teether", tags: ["label:BESTSELLER", "Qty:Bulk"] }), // cleanup
  ];
  const view = tagListView(compute(products, { [products[1].legacyId]: 12 }));
  assert.equal(view.totals.taggedNow, 4);
  assert.equal(view.totals.afterApproval, 3);
  assert.equal(view.totals.willGet, 1);
  assert.equal(view.totals.willLose, 2);
  assert.equal(view.totals.staying, 1);
  assert.equal(view.totals.toCheck, 1);
  assert.equal(view.totals.waiting, 3);
  assert.equal(view.totals.upToDate, false);
  const pacifiers = view.categories.find((c) => c.key === "pacifiers");
  assert.deepEqual(
    pacifiers.willHave.map((p) => [p.state, p.why]),
    [
      ["new", "New launch AW27"],
      ["already", "Best seller #1"],
    ],
  );
  assert.equal(pacifiers.willLose[0].why, "Not active (archived)");
  assert.equal(view.cleanup[0].state, "pending_remove");
});

test("tag list after applying: added / removed / skipped replace 'waiting', and 'up to date' is shown", () => {
  resetIds(81000);
  const products = [
    product({ type: "Pacifier" }), // add -> applied
    product({ type: "Pacifier" }), // add -> skipped
    product({ type: "Pacifier", status: "DRAFT", tags: ["label:BESTSELLER"] }), // remove -> applied
  ];
  const result = compute(products, { [products[0].legacyId]: 5, [products[1].legacyId]: 4 });
  const changes = [
    { productId: products[0].id, action: "add", status: "APPLIED", createdAt: "2026-11-06T09:00:00Z" },
    { productId: products[1].id, action: "add", status: "SKIPPED", message: "no longer eligible" },
    { productId: products[2].id, action: "remove", status: "APPLIED", createdAt: "2026-11-06T09:00:01Z" },
  ];
  const view = tagListView(result, { changes, members: [{ productId: products[0].id, since: "2026-11-05T01:00:00Z" }] });
  const pacifiers = view.categories.find((c) => c.key === "pacifiers");
  assert.deepEqual(pacifiers.willHave.map((p) => p.state), ["added", "skipped"]);
  assert.equal(pacifiers.willHave[0].since, "2026-11-05T01:00:00.000Z");
  assert.equal(pacifiers.willLose[0].state, "removed");
  assert.equal(view.totals.waiting, 0);
  assert.equal(view.totals.problems, 1);
  assert.equal(view.totals.upToDate, false, "a skipped change is not 'up to date'");

  // Everything applied cleanly -> up to date
  const clean = tagListView(result, { changes: [changes[0], { ...changes[1], status: "APPLIED" }, changes[2]] });
  assert.equal(clean.totals.upToDate, true);
  assert.equal(clean.totals.taggedNow, 2);
});

test("next nightly run label respects Copenhagen time", () => {
  const opts = { timeZone: "Europe/Copenhagen", targetHour: 2 };
  assert.equal(nextNightlyRunLabel(new Date("2026-11-05T23:30:00Z"), opts), "Fri 6 Nov, 02:00");
  assert.equal(nextNightlyRunLabel(new Date("2026-11-06T09:00:00Z"), opts), "Sat 7 Nov, 02:00");
});
