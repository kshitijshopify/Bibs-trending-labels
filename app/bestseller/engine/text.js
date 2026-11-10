/**
 * Normalises a tag or product type for comparison: trims, collapses internal
 * whitespace, lower-cases. Raw values are always kept for display.
 */
export function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export const normalizeTag = normalizeText;
export const normalizeProductType = normalizeText;

/** "gid://shopify/Product/123" -> "123". Returns null when not numeric. */
export function legacyIdFromGid(gid) {
  const last = String(gid ?? "").split("/").pop();
  return /^\d+$/.test(last) ? last : null;
}

export function productGid(legacyId) {
  return `gid://shopify/Product/${legacyId}`;
}

/** Numeric comparison of decimal ID strings (IDs can exceed 2^53). */
export function compareNumericIds(a, b) {
  const x = BigInt(a);
  const y = BigInt(b);
  if (x < y) return -1;
  if (x > y) return 1;
  return 0;
}
