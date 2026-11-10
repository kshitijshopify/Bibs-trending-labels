import { normalizeProductType, normalizeTag } from "./text.js";
import { isSeasonLikeButUnrecognised, parseSeasonTag } from "./seasons.js";

const RELATED_TYPE_RE =
  /pacifier|soother|dummy|bottle|teat|nipple|clip|loop|teether|case|box/i;

/**
 * Catalog audit used to validate the product-type mappings and the season /
 * label tags against the COMPLETE catalog. Purely informational: it never
 * changes the selection.
 */
export function buildCatalogAudit({ products, config, categoryIndex, isBulkFn }) {
  const types = new Map();
  const statusCounts = {};
  const bestsellerVariants = {};
  const bulkMarkerHits = {};
  const bulkNearMisses = {};
  const rejectedSeasonLike = {};
  const seasonTags = {};
  const bestsellerNorm = normalizeTag(config.bestsellerTag);
  const bulkMarkers = new Set(config.bulk.tags.map(normalizeTag));
  let bulkTitleHits = 0;
  const bulkTitleExamples = [];

  for (const product of products) {
    statusCounts[product.status] = (statusCounts[product.status] ?? 0) + 1;

    const typeKey = normalizeProductType(product.productType);
    let type = types.get(typeKey);
    if (!type) {
      type = { normalized: typeKey, rawVariants: {}, total: 0, active: 0, activeNonBulk: 0 };
      types.set(typeKey, type);
    }
    type.total += 1;
    type.rawVariants[product.productType] = (type.rawVariants[product.productType] ?? 0) + 1;
    const bulk = isBulkFn(product);
    if (String(product.status).toUpperCase() === "ACTIVE") {
      type.active += 1;
      if (!bulk) type.activeNonBulk += 1;
    }

    for (const tag of product.tags) {
      const norm = normalizeTag(tag);
      if (norm === bestsellerNorm) {
        bestsellerVariants[tag] = (bestsellerVariants[tag] ?? 0) + 1;
      }
      if (bulkMarkers.has(norm)) {
        bulkMarkerHits[tag] = (bulkMarkerHits[tag] ?? 0) + 1;
      } else if (norm.includes("bulk")) {
        bulkNearMisses[tag] = (bulkNearMisses[tag] ?? 0) + 1;
      }
      const parsed = parseSeasonTag(tag, config.seasons);
      if (parsed) {
        const key = `${parsed.season} (${parsed.source})`;
        seasonTags[key] = seasonTags[key] ?? {};
        seasonTags[key][parsed.tag] = (seasonTags[key][parsed.tag] ?? 0) + 1;
      } else if (isSeasonLikeButUnrecognised(tag, config.seasons)) {
        rejectedSeasonLike[tag] = (rejectedSeasonLike[tag] ?? 0) + 1;
      }
    }

    if (normalizeTag(product.title).includes(normalizeTag(config.bulk.titleSubstring))) {
      bulkTitleHits += 1;
      if (bulkTitleExamples.length < 25) bulkTitleExamples.push(product.title);
    }
  }

  const productTypes = [...types.values()]
    .map((t) => ({
      ...t,
      display: Object.keys(t.rawVariants)[0] || "(blank)",
      mappedTo: categoryIndex.categoryKeyFor(t.normalized),
      whitespaceOrCaseVariants: Object.keys(t.rawVariants).length > 1,
      looksRelated: RELATED_TYPE_RE.test(t.normalized),
    }))
    .sort((a, b) => b.total - a.total || (a.normalized < b.normalized ? -1 : 1));

  const mappingCheck = config.categories.map((category) => ({
    category: category.key,
    types: category.productTypes.map((configured) => {
      const found = types.get(normalizeProductType(configured));
      return {
        configured,
        foundInCatalog: Boolean(found),
        rawVariants: found ? found.rawVariants : {},
        total: found?.total ?? 0,
        activeNonBulk: found?.activeNonBulk ?? 0,
      };
    }),
  }));

  const unmappedRelatedTypes = productTypes
    .filter((t) => !t.mappedTo && t.looksRelated)
    .map((t) => ({ display: t.display, rawVariants: t.rawVariants, total: t.total }));

  return {
    totalProducts: products.length,
    statusCounts: sortObject(statusCounts),
    productTypes,
    mappingCheck,
    unmappedRelatedTypes,
    seasonTags: sortObject(seasonTags),
    rejectedSeasonLikeTags: topEntries(rejectedSeasonLike, 100),
    bestsellerTagVariants: sortObject(bestsellerVariants),
    bulk: {
      markerHits: sortObject(bulkMarkerHits),
      nearMissTags: topEntries(bulkNearMisses, 50),
      titleHits: bulkTitleHits,
      titleExamples: bulkTitleExamples,
    },
  };
}

function sortObject(obj) {
  return Object.fromEntries(
    Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

function topEntries(obj, limit) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
}
