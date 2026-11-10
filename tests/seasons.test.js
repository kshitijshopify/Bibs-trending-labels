import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSeasonIndex,
  compareSeasonsNewestFirst,
  parseSeasonTag,
  seasonSortKey,
} from "../app/bestseller/engine/seasons.js";
import { category, compute, product, resetIds } from "./helpers/builders.js";

test("AW27 outranks SS27; SS28 outranks AW27; SS27 outranks AW26", () => {
  assert.ok(seasonSortKey("AW27") > seasonSortKey("SS27"));
  assert.ok(seasonSortKey("SS28") > seasonSortKey("AW27"));
  assert.ok(seasonSortKey("SS27") > seasonSortKey("AW26"));
  assert.deepEqual(["SS27", "AW26", "SS28", "AW27"].sort(compareSeasonsNewestFirst), ["SS28", "AW27", "SS27", "AW26"]);
});

test("two-digit years compare numerically", () => {
  assert.ok(seasonSortKey("SS10") > seasonSortKey("AW09"));
});

test("letter case does not affect season detection", () => {
  for (const tag of ["AW27", "aw27", "Aw27", "aW27"]) {
    assert.equal(parseSeasonTag(tag).season, "AW27", tag);
    assert.equal(parseSeasonTag(tag).source, "plain", tag);
  }
  assert.equal(parseSeasonTag("LABEL:ss26").season, "SS26");
  assert.equal(parseSeasonTag("LABEL:ss26").source, "label");
});

test("SS27-1 and SS27-2 are drops of one plain SS27 season", () => {
  resetIds();
  const a = product({ tags: ["SS27-1"] });
  const b = product({ tags: ["ss27-2"] });
  const index = buildSeasonIndex([a, b]);
  assert.equal(index.length, 1);
  assert.equal(index[0].season, "SS27");
  assert.equal(index[0].source, "plain");
  assert.deepEqual([...index[0].members].sort(), [a.id, b.id].sort());
});

test("embedded season text is not a season tag", () => {
  for (const tag of ["Nordic-Display-Bundle-SS26", "DelistSS27", "label:Delist-SS27", "SS27x", "XSS27", "SS2027", "SS27-", "AW 27"]) {
    assert.equal(parseSeasonTag(tag), null, tag);
  }
});

test("embedded text does not establish plain-season membership; label fallback stays in use", () => {
  resetIds();
  const embedded = product({ tags: ["Nordic-Display-Bundle-SS26"] });
  const labelOnly = product({ type: "Pacifier Clip", tags: ["label:SS26"] });
  const index = buildSeasonIndex([embedded, labelOnly]);
  const ss26 = index.find((s) => s.season === "SS26");
  assert.equal(ss26.source, "label");
  assert.ok(!ss26.members.has(embedded.id));
  assert.ok(ss26.members.has(labelOnly.id));
});

test("label:AW27 is used only when no plain AW27 tag exists anywhere in the catalog", () => {
  resetIds();
  const labelPacifier = product({ type: "Pacifier", tags: ["label:AW27"] });
  // Without any plain AW27: label fallback defines membership.
  let result = compute([labelPacifier]);
  assert.equal(category(result, "pacifiers").launch.chosenSeason, "AW27");
  assert.equal(category(result, "pacifiers").launch.source, "label");

  // A plain AW27 anywhere (even an archived product of another category) wins globally.
  const archivedBottle = product({ type: "Baby Bottle", status: "ARCHIVED", tags: ["AW27"] });
  result = compute([labelPacifier, archivedBottle]);
  const aw27 = result.seasons.find((s) => s.season === "AW27");
  assert.equal(aw27.source, "plain");
  assert.equal(aw27.ignoredLabelProductCount, 1);
  // The label-only pacifier is no longer an AW27 launch member.
  const pacifiers = category(result, "pacifiers");
  assert.equal(pacifiers.launch.chosenSeason, null);
  assert.equal(pacifiers.launch.ladder[0].ignoredLabelMembers, 1);
});

test("label drop suffix is configurable", () => {
  assert.equal(parseSeasonTag("label:SS27-1", { allowLabelDropSuffix: true }).season, "SS27");
  assert.equal(parseSeasonTag("label:SS27-1", { allowLabelDropSuffix: false }), null);
});
