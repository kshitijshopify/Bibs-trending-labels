import { ConfigurationError } from "../errors.js";
import { normalizeProductType } from "./text.js";

/**
 * Maps a product type to its category key using an EXACT (normalised)
 * comparison. No substring or prefix matching, so "Baby Bottle Accessories"
 * can never be classified as "Baby Bottle".
 */
export function buildCategoryIndex(categories) {
  const byType = new Map();
  const keys = new Set();

  for (const category of categories) {
    if (keys.has(category.key)) {
      throw new ConfigurationError(
        "DUPLICATE_CATEGORY",
        `Category key "${category.key}" is defined twice.`,
      );
    }
    keys.add(category.key);
    if (!(category.total > 0) || !(category.reserved >= 0)) {
      throw new ConfigurationError(
        "INVALID_QUOTA",
        `Category "${category.key}" has an invalid total/reserved quota.`,
      );
    }
    for (const type of category.productTypes) {
      const normalised = normalizeProductType(type);
      const existing = byType.get(normalised);
      if (existing && existing !== category.key) {
        throw new ConfigurationError(
          "OVERLAPPING_PRODUCT_TYPE",
          `Product type "${type}" is mapped to both "${existing}" and "${category.key}".`,
        );
      }
      byType.set(normalised, category.key);
    }
  }

  return {
    categoryKeyFor(productType) {
      return byType.get(normalizeProductType(productType)) ?? null;
    },
    mappedTypes: byType,
  };
}
