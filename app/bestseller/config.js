// Business rules for the BIBS bestseller labels integration.
// Pure data: imported by the engine, the server code, and the tests.

export const BESTSELLER_TAG = "label:BESTSELLER";

export const TIME_ZONE = "Europe/Copenhagen";

/** Nightly run starts at 02:00 Copenhagen time. */
export const SCHEDULE = {
  targetHour: 2,
  // A scheduler tick later than this local hour is ignored, so a misconfigured
  // cron cannot start a "nightly" run in the middle of the working day.
  latestHour: 6,
};

/** Previous N complete Copenhagen calendar days, excluding the current day. */
export const SALES_WINDOW_DAYS = 30;

/** The sales period can be changed in Settings (e.g. 14 or 90 days). */
export const SALES_WINDOW_PRESETS = [7, 14, 30, 60, 90];
export const SALES_WINDOW_MIN_DAYS = 1;
export const SALES_WINDOW_MAX_DAYS = 365;

export function validateWindowDays(value) {
  const days = Number(value);
  if (!Number.isInteger(days) || days < SALES_WINDOW_MIN_DAYS || days > SALES_WINDOW_MAX_DAYS) {
    return { ok: false, days: null, problem: `must be a whole number of days between ${SALES_WINDOW_MIN_DAYS} and ${SALES_WINDOW_MAX_DAYS}` };
  }
  return { ok: true, days };
}

export const PREVIEW_RECIPIENT = "mbn@bibsworld.com";

export const CATEGORIES = [
  {
    key: "pacifiers",
    name: "Pacifiers",
    productTypes: [
      "Pacifier",
      "Colour Pacifier",
      "De Lux Pacifier",
      "Pacifier 2 Pack",
      "Pacifier Glow",
      "Pacifier Try-It",
    ],
    total: 20,
    reserved: 5,
  },
  {
    key: "bottles",
    name: "Bottles",
    // Exact match only: "Baby Bottle Accessories" must never land here.
    productTypes: ["Baby Bottle"],
    total: 5,
    reserved: 2,
  },
  {
    key: "accessories",
    name: "Accessories",
    productTypes: [
      "Baby Bottle Accessories",
      "Pacifier Clip",
      "Pacifier Box",
      "Pacifier Case",
      "Loops",
    ],
    total: 5,
    reserved: 2,
  },
];

export const BULK_RULES = {
  // Exact tag matches, case-insensitive.
  tags: ["label:BULK", "Qty:Bulk"],
  // Case-insensitive substring of the product title.
  titleSubstring: "bulk",
};

export const SEASON_RULES = {
  // Accept drop suffixes on label fallbacks too (label:SS27-1 -> SS27).
  // Open question for the merchant; flip to false if only label:SS27 counts.
  allowLabelDropSuffix: true,
};

/** Flow trigger handles (must match the folders in extensions/). */
export const FLOW_TRIGGER_HANDLE = "bestseller-preview-ready";
export const FLOW_SUMMARY_TRIGGER_HANDLE = "bestseller-daily-summary";

/** Which preview emails Flow receives: one per category, one combined, or both. */
export const EMAIL_FORMATS = {
  separate: "One email per category (Pacifiers, Bottles, Accessories, Cleanup and review)",
  combined: "One email with everything",
  both: "Both (separate and combined)",
};

/** Shopify rejects trigger payloads of 50,000 bytes or more (keys included). */
export const FLOW_PAYLOAD_LIMIT_BYTES = 50000;
export const FLOW_PAYLOAD_WARN_BYTES = 40000;

/**
 * The label tag is configurable (BESTSELLER_LABEL_TAG) because the two
 * client briefs differ: "label:BESTSELLER" (detailed spec, the existing tag)
 * vs "label:Trending" (summary brief). Confirm with the merchant.
 */
export const LABEL_TAG_CHOICES = ["label:Trending", "label:BESTSELLER"];

/** The merchant confirmed label:Trending; used when no tag has been chosen yet. */
export const APP_DEFAULT_LABEL_TAG = "label:Trending";

export function validateLabelTag(tag) {
  const value = String(tag ?? "").trim();
  const problems = [];
  if (!value) problems.push("is empty");
  if (value.length > 255) problems.push("is longer than 255 characters");
  if (value.includes(",")) problems.push("contains a comma");
  const lower = value.toLowerCase();
  if (BULK_RULES.tags.some((t) => t.toLowerCase() === lower)) problems.push("is a Bulk marker");
  if (/^(label:)?(aw|ss)\d{2}(-\d{1,3})?$/i.test(value)) problems.push("is a season tag");
  return { ok: problems.length === 0, value, problems };
}

export const DEFAULT_CONFIG = Object.freeze({
  bestsellerTag: BESTSELLER_TAG,
  timeZone: TIME_ZONE,
  salesWindowDays: SALES_WINDOW_DAYS,
  categories: CATEGORIES,
  bulk: BULK_RULES,
  seasons: SEASON_RULES,
});
