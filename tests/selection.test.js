import { test } from "node:test";
import assert from "node:assert/strict";
import { category, compute, ids, product, resetIds } from "./helpers/builders.js";

function pacifierCatalog({ launchCount, launchSales = [], fillerCount = 30 }) {
  resetIds(1000);
  const launch = [];
  for (let i = 0; i < launchCount; i += 1) launch.push(product({ type: "Pacifier", tags: ["AW27"] }));
  const fillers = [];
  for (let i = 0; i < fillerCount; i += 1) fillers.push(product({ type: "Colour Pacifier" }));
  const sales = {};
  launch.forEach((p, i) => {
    if (launchSales[i]) sales[p.legacyId] = launchSales[i];
  });
  fillers.forEach((p, i) => {
    sales[p.legacyId] = 100 - i; // fillers all outsell the launch
  });
  return { launch, fillers, sales };
}

test("three eligible newest-launch pacifiers -> three reserved, remaining 17 from the overall ranking", () => {
  const { launch, fillers, sales } = pacifierCatalog({ launchCount: 3 });
  const pacifiers = category(compute([...launch, ...fillers], sales), "pacifiers");
  assert.equal(pacifiers.launch.chosenSeason, "AW27");
  assert.equal(pacifiers.selected.length, 20);
  const reserved = pacifiers.selected.filter((p) => p.pickedAs === "launch-reserved");
  assert.deepEqual(ids(reserved).sort(), ids(launch).sort());
  assert.equal(pacifiers.launch.launchReservedShortfall, 2);
  const filled = pacifiers.selected.filter((p) => p.pickedAs === "sales-ranking");
  assert.deepEqual(ids(filled), ids(fillers.slice(0, 17)));
});

test("zero-sales launch products can satisfy reserved places", () => {
  const { launch, fillers, sales } = pacifierCatalog({ launchCount: 2, launchSales: [0, 0] });
  const pacifiers = category(compute([...launch, ...fillers], sales), "pacifiers");
  const reserved = pacifiers.selected.filter((p) => p.pickedAs === "launch-reserved");
  assert.equal(reserved.length, 2);
  assert.ok(reserved.every((p) => p.netUnits === 0));
});

test("launch products are not duplicated and may exceed the minimum through sales", () => {
  resetIds(2000);
  const launch = Array.from({ length: 8 }, () => product({ type: "Pacifier", tags: ["SS28"] }));
  const others = Array.from({ length: 20 }, () => product({ type: "Pacifier Glow" }));
  const sales = {};
  launch.forEach((p, i) => (sales[p.legacyId] = 500 - i)); // launch products are the best sellers
  others.forEach((p, i) => (sales[p.legacyId] = 100 - i));
  const pacifiers = category(compute([...launch, ...others], sales), "pacifiers");
  const selectedIds = ids(pacifiers.selected);
  assert.equal(new Set(selectedIds).size, selectedIds.length, "no duplicates");
  assert.equal(pacifiers.selected.filter((p) => p.pickedAs === "launch-reserved").length, 5);
  assert.equal(pacifiers.launch.launchSelectedTotal, 8, "all 8 launch products earn places");
});

test("reserved places go to the highest-ranked launch products", () => {
  resetIds(3000);
  const launch = Array.from({ length: 4 }, () => product({ type: "Baby Bottle", tags: ["AW27"] }));
  const sales = { [launch[0].legacyId]: 1, [launch[1].legacyId]: 9, [launch[2].legacyId]: 5, [launch[3].legacyId]: 0 };
  const bottles = category(compute(launch, sales), "bottles");
  const reserved = bottles.selected.filter((p) => p.pickedAs === "launch-reserved");
  assert.deepEqual(ids(reserved), [launch[1].legacyId, launch[2].legacyId]);
});

test("a launch containing only inactive or Bulk products is skipped for that category", () => {
  resetIds(4000);
  const draft = product({ type: "Pacifier", status: "DRAFT", tags: ["SS28"] });
  const bulk = product({ type: "Pacifier", tags: ["SS28", "label:BULK"] });
  const archived = product({ type: "Pacifier", status: "ARCHIVED", tags: ["SS28"] });
  const aw27 = product({ type: "Pacifier", tags: ["AW27"] });
  const pacifiers = category(compute([draft, bulk, archived, aw27]), "pacifiers");
  assert.equal(pacifiers.launch.chosenSeason, "AW27");
  const ss28 = pacifiers.launch.ladder[0];
  assert.equal(ss28.season, "SS28");
  assert.equal(ss28.decision, "skipped");
  assert.equal(ss28.categoryMembers, 3);
  assert.equal(ss28.eligibleMembers, 0);
});

test("categories choose different newest eligible launches independently", () => {
  resetIds(5000);
  const products = [
    product({ type: "Pacifier", tags: ["SS28"] }),
    product({ type: "Baby Bottle", tags: ["AW27"] }),
    product({ type: "Baby Bottle", status: "DRAFT", tags: ["SS28"] }),
    product({ type: "Loops", tags: ["label:SS26"] }),
  ];
  const result = compute(products);
  assert.equal(category(result, "pacifiers").launch.chosenSeason, "SS28");
  assert.equal(category(result, "bottles").launch.chosenSeason, "AW27");
  assert.equal(category(result, "accessories").launch.chosenSeason, "SS26");
  assert.equal(category(result, "accessories").launch.source, "label");
});

test("small launch: shortfall is filled from the overall ranking, not from older launches", () => {
  resetIds(6000);
  const newest = product({ type: "Baby Bottle", tags: ["SS28"] });
  const older = [product({ type: "Baby Bottle", tags: ["AW27"] }), product({ type: "Baby Bottle", tags: ["AW27"] })];
  const plain = [product({ type: "Baby Bottle" }), product({ type: "Baby Bottle" }), product({ type: "Baby Bottle" })];
  const sales = {
    [plain[0].legacyId]: 50,
    [plain[1].legacyId]: 40,
    [plain[2].legacyId]: 30,
    [older[0].legacyId]: 1,
    [older[1].legacyId]: 2,
  };
  const bottles = category(compute([newest, ...older, ...plain], sales), "bottles");
  assert.equal(bottles.launch.chosenSeason, "SS28");
  assert.equal(bottles.launch.reservedFilled, 1);
  const reserved = bottles.selected.filter((p) => p.pickedAs === "launch-reserved");
  assert.deepEqual(ids(reserved), [newest.legacyId]);
  // remaining 4 places strictly by ranking: 50, 40, 30, then the AW27 product with 2 units
  assert.deepEqual(ids(bottles.selected.slice(1)), [plain[0].legacyId, plain[1].legacyId, plain[2].legacyId, older[1].legacyId]);
});

test("no qualifying season -> overall ranking; fewer eligible than target -> shortfall reported", () => {
  resetIds(7000);
  const products = [product({ type: "Pacifier Clip" }), product({ type: "Loops" }), product({ type: "Loops", status: "DRAFT" })];
  const accessories = category(compute(products, { 7000: 3, 7001: 9 }), "accessories");
  assert.equal(accessories.launch.chosenSeason, null);
  assert.equal(accessories.launch.source, "none");
  assert.deepEqual(ids(accessories.selected), ["7001", "7000"]);
  assert.equal(accessories.shortfall, 3);
});

test("eligible products absent from the sales report have zero sales; ties broken by product ID", () => {
  resetIds(8000);
  const products = [product({ id: 8003, type: "Loops" }), product({ id: 8001, type: "Loops" }), product({ id: 8002, type: "Loops" })];
  const accessories = category(compute(products), "accessories");
  assert.deepEqual(ids(accessories.selected), ["8001", "8002", "8003"]);
  assert.ok(accessories.selected.every((p) => p.netUnits === 0));
});

test("tie-breaker compares IDs numerically, not as text", () => {
  const products = [product({ id: 900, type: "Loops" }), product({ id: 10000, type: "Loops" })];
  const accessories = category(compute(products), "accessories");
  assert.deepEqual(ids(accessories.selected), ["900", "10000"]);
});

test("bottle accessories never occupy bottle places", () => {
  resetIds(9000);
  const accessories = Array.from({ length: 6 }, () => product({ type: "Baby Bottle Accessories", tags: ["SS28"] }));
  const bottle = product({ type: "Baby Bottle" });
  const sales = Object.fromEntries(accessories.map((p) => [p.legacyId, 1000]));
  const result = compute([...accessories, bottle], sales);
  const bottles = category(result, "bottles");
  assert.deepEqual(ids(bottles.selected), [bottle.legacyId]);
  assert.equal(bottles.launch.chosenSeason, null);
  assert.equal(bottles.shortfall, 4);
  assert.ok(category(result, "accessories").selected.every((p) => p.productType === "Baby Bottle Accessories"));
});

test("product-type matching is exact (normalised), never substring", () => {
  resetIds(9500);
  const result = compute([
    product({ type: "baby bottle" }),
    product({ type: "  Baby   Bottle " }),
    product({ type: "Baby Bottles" }),
    product({ type: "Baby Bottle Accessories" }),
  ]);
  assert.equal(category(result, "bottles").counts.inCategory, 2);
});

test("same inputs in any order produce the same selection and hash", () => {
  const { launch, fillers, sales } = pacifierCatalog({ launchCount: 4, launchSales: [3, 0, 7, 1] });
  const all = [...launch, ...fillers];
  const a = compute(all, sales);
  const b = compute([...all].reverse(), new Map([...Object.entries(sales)].reverse()));
  assert.equal(a.resultHash, b.resultHash);
  assert.equal(a.inputHash, b.inputHash);
  assert.deepEqual(ids(category(a, "pacifiers").selected), ids(category(b, "pacifiers").selected));
});
