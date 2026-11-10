import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSalesWindow, scheduleDecision, zonedTimeToUtc } from "../app/bestseller/engine/time.js";

const TZ = "Europe/Copenhagen";
const schedule = { timeZone: TZ, targetHour: 2, latestHour: 6 };

test("sales window = previous 30 complete Copenhagen days, today excluded", () => {
  const w = computeSalesWindow({ runLocalDate: "2026-11-06", days: 30, timeZone: TZ });
  assert.equal(w.startDate, "2026-10-07");
  assert.equal(w.endDate, "2026-11-05");
  // 2026-10-07 is summer time (UTC+2); 2026-11-06 is winter time (UTC+1)
  assert.equal(w.startUtc, "2026-10-06T22:00:00.000Z");
  assert.equal(w.endUtcExclusive, "2026-11-05T23:00:00.000Z");
  assert.equal(w.endUtcInclusive, "2026-11-05T22:59:59.999Z");
  assert.equal(w.nonStandard, false);
});

test("window crossing the DST change still covers exactly 30 calendar days", () => {
  const w = computeSalesWindow({ runLocalDate: "2027-04-10", days: 30, timeZone: TZ });
  assert.equal(w.startDate, "2027-03-11");
  assert.equal(w.endDate, "2027-04-09");
});

test("dev override includes today and is flagged", () => {
  const w = computeSalesWindow({ runLocalDate: "2026-11-06", days: 30, timeZone: TZ, includeToday: true });
  assert.equal(w.endDate, "2026-11-06");
  assert.equal(w.startDate, "2026-10-08");
  assert.equal(w.nonStandard, true);
});

test("winter: the 01:00 UTC tick is 02:00 Copenhagen, the 00:00 tick is not", () => {
  assert.equal(scheduleDecision(new Date("2026-11-06T00:00:00Z"), schedule).due, false);
  const d = scheduleDecision(new Date("2026-11-06T01:00:00Z"), schedule);
  assert.equal(d.due, true);
  assert.equal(d.localTime, "02:00:00");
  assert.equal(d.localDate, "2026-11-06");
});

test("summer: the 00:00 UTC tick is 02:00 Copenhagen", () => {
  const d = scheduleDecision(new Date("2027-07-01T00:00:00Z"), schedule);
  assert.equal(d.due, true);
  assert.equal(d.localTime, "02:00:00");
  // the 01:00 UTC tick is also "due" by time; the repository's
  // already-ran-today check prevents the second run (see run-job tests)
  assert.equal(scheduleDecision(new Date("2027-07-01T01:00:00Z"), schedule).localDate, "2027-07-01");
});

test("spring-forward night (02:00 does not exist): the 01:00 UTC tick runs at 03:00", () => {
  assert.equal(scheduleDecision(new Date("2027-03-28T00:00:00Z"), schedule).due, false);
  const d = scheduleDecision(new Date("2027-03-28T01:00:00Z"), schedule);
  assert.equal(d.due, true);
  assert.equal(d.localTime, "03:00:00");
});

test("fall-back night (02:00 happens twice): both ticks map to the same local date", () => {
  const first = scheduleDecision(new Date("2027-10-31T00:00:00Z"), schedule);
  const second = scheduleDecision(new Date("2027-10-31T01:00:00Z"), schedule);
  assert.equal(first.localTime, "02:00:00");
  assert.equal(second.localTime, "02:00:00");
  assert.equal(first.localDate, second.localDate);
});

test("a daytime tick is never treated as the nightly run", () => {
  assert.equal(scheduleDecision(new Date("2026-11-06T11:00:00Z"), schedule).due, false);
});

test("zonedTimeToUtc handles both offsets", () => {
  assert.equal(zonedTimeToUtc("2026-07-01", "00:00:00", TZ).toISOString(), "2026-06-30T22:00:00.000Z");
  assert.equal(zonedTimeToUtc("2026-12-01", "00:00:00", TZ).toISOString(), "2026-11-30T23:00:00.000Z");
});
