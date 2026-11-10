import { compareNumericIds } from "./text.js";

const byLegacyId = (a, b) => compareNumericIds(a.legacyId, b.legacyId);

/**
 * Proposed label changes for one category.
 *  - wouldAdd:    selected, not labeled
 *  - wouldKeep:   selected, already labeled
 *  - wouldRemove: labeled products of this category that are not selected,
 *                 including inactive and Bulk products
 */
export function categoryDiff({ categoryProducts, selected }) {
  const selectedIds = new Set(selected.map((p) => p.id));

  const wouldAdd = selected.filter((p) => !p.labeled);
  const wouldKeep = selected.filter((p) => p.labeled);
  const wouldRemove = categoryProducts
    .filter((p) => p.labeled && !selectedIds.has(p.id))
    .map((p) => ({ ...p, removeReasons: removeReasons(p) }))
    .sort(byLegacyId);

  return { wouldAdd, wouldKeep, wouldRemove };
}

function removeReasons(product) {
  const reasons = [];
  if (!product.active) reasons.push(`status ${product.status}`);
  for (const reason of product.bulkReasons) reasons.push(`Bulk: ${reason}`);
  if (reasons.length === 0) reasons.push("not selected");
  return reasons;
}

/**
 * Labeled products whose product type is outside all three mappings.
 *  - cleanup: Bulk products (Bulk must never keep the label), deduplicated
 *  - review:  everything else, flagged for a human, never auto-removed
 */
export function outsideMappingLists(outsideProducts) {
  const cleanup = new Map();
  const review = new Map();

  for (const product of outsideProducts) {
    if (!product.labeled) continue;
    if (product.bulkReasons.length > 0) {
      cleanup.set(product.id, {
        ...product,
        removeReasons: product.bulkReasons.map((r) => `Bulk: ${r}`),
      });
    } else {
      review.set(product.id, {
        ...product,
        reviewReason: product.productType
          ? `product type "${product.productType}" is outside the three category mappings`
          : "product has no product type, so it is outside the category mappings",
      });
    }
  }

  return {
    cleanup: [...cleanup.values()].sort(byLegacyId),
    review: [...review.values()].sort(byLegacyId),
  };
}
