import { normalizeTag, normalizeText } from "./text.js";

/**
 * Engine product shape (produced by the catalog reader):
 * { id: "gid://shopify/Product/1", legacyId: "1", title, status, productType, tags: string[] }
 */

export function isActive(product) {
  return String(product.status).toUpperCase() === "ACTIVE";
}

/** Returns the list of Bulk markers found on a product (empty = not Bulk). */
export function bulkReasons(product, bulkRules) {
  const markers = new Set(bulkRules.tags.map(normalizeTag));
  const reasons = [];
  for (const tag of product.tags) {
    if (markers.has(normalizeTag(tag))) reasons.push(`tag "${tag}"`);
  }
  const needle = normalizeText(bulkRules.titleSubstring);
  if (needle && normalizeText(product.title).includes(needle)) {
    reasons.push(`title contains "${bulkRules.titleSubstring}"`);
  }
  return reasons;
}

export function isBulk(product, bulkRules) {
  return bulkReasons(product, bulkRules).length > 0;
}

export function isEligible(product, bulkRules) {
  return isActive(product) && !isBulk(product, bulkRules);
}

/** Exact stored variants of the bestseller tag on a product (case-insensitive match). */
export function bestsellerTagsOn(product, bestsellerTag) {
  const target = normalizeTag(bestsellerTag);
  return product.tags.filter((tag) => normalizeTag(tag) === target);
}

export function hasBestseller(product, bestsellerTag) {
  return bestsellerTagsOn(product, bestsellerTag).length > 0;
}
