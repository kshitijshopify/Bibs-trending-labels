/**
 * Time-zone helpers built on Intl only (no dependencies). All "dates" are
 * plain calendar strings "YYYY-MM-DD" in the given time zone.
 */

const formatterCache = new Map();

function formatterFor(timeZone) {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** Wall-clock parts of an instant in a time zone. */
export function zonedParts(date, timeZone) {
  const parts = {};
  for (const { type, value } of formatterFor(timeZone).formatToParts(date)) {
    if (type !== "literal") parts[type] = Number(value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

export function localDateString(date, timeZone) {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function localTimeString(date, timeZone) {
  const p = zonedParts(date, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/** Calendar arithmetic on "YYYY-MM-DD" strings (time-zone independent). */
export function addDays(dateString, days) {
  const [y, m, d] = parseDate(dateString);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** UTC offset (ms) of a time zone at a given instant. */
function offsetAt(timestamp, timeZone) {
  const p = zonedParts(new Date(timestamp), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(timestamp / 1000) * 1000;
}

/** Instant at which the wall clock in `timeZone` shows dateString + timeString. */
export function zonedTimeToUtc(dateString, timeString, timeZone) {
  const [y, m, d] = parseDate(dateString);
  const [hh, mm, ss] = timeString.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm, ss || 0);
  const first = offsetAt(wall, timeZone);
  let result = wall - first;
  const second = offsetAt(result, timeZone);
  if (second !== first) result = wall - second;
  return new Date(result);
}

/**
 * Sales window: the previous `days` complete calendar days in `timeZone`,
 * excluding the run's own (partial) local day.
 *
 * Example: run on 2026-11-06 -> 2026-10-07 00:00:00 .. 2026-11-05 23:59:59 local.
 *
 * `includeToday` exists ONLY for development-store testing (orders created
 * today are otherwise outside the window). It is flagged as non-standard.
 */
export function computeSalesWindow({ runLocalDate, days, timeZone, includeToday = false }) {
  const endDate = includeToday ? runLocalDate : addDays(runLocalDate, -1);
  const startDate = addDays(endDate, -(days - 1));
  const startUtc = zonedTimeToUtc(startDate, "00:00:00", timeZone);
  const endExclusiveUtc = zonedTimeToUtc(addDays(endDate, 1), "00:00:00", timeZone);
  return {
    timeZone,
    days,
    runLocalDate,
    startDate,
    endDate,
    startUtc: startUtc.toISOString(),
    endUtcInclusive: new Date(endExclusiveUtc.getTime() - 1).toISOString(),
    endUtcExclusive: endExclusiveUtc.toISOString(),
    label: `${startDate} 00:00:00 – ${endDate} 23:59:59 (${timeZone})`,
    nonStandard: includeToday,
  };
}

/**
 * Decides whether a scheduler tick should start the nightly run.
 * The external cron fires at 00:00 and 01:00 UTC; exactly one of them is
 * 02:00 Copenhagen time, whatever the DST state:
 *   winter (CET, UTC+1):  01:00 UTC = 02:00 local
 *   summer (CEST, UTC+2): 00:00 UTC = 02:00 local
 *   spring-forward day:   02:00 does not exist -> 01:00 UTC = 03:00 local runs
 *   fall-back day:        02:00 occurs twice -> second tick sees the run done
 * The "already ran for this local date" check lives in the job repository.
 */
export function scheduleDecision(now, { timeZone, targetHour, latestHour }) {
  const parts = zonedParts(now, timeZone);
  const localDate = localDateString(now, timeZone);
  const localTime = localTimeString(now, timeZone);
  if (parts.hour < targetHour) {
    return { due: false, localDate, localTime, reason: `local time ${localTime} is before ${pad(targetHour)}:00` };
  }
  if (parts.hour >= latestHour) {
    return {
      due: false,
      localDate,
      localTime,
      reason: `local time ${localTime} is after the ${pad(latestHour)}:00 cut-off for nightly runs`,
    };
  }
  return { due: true, localDate, localTime, reason: "inside the nightly run window" };
}

function parseDate(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) throw new Error(`Invalid date string: ${dateString}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function pad(n) {
  return String(n).padStart(2, "0");
}
