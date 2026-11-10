import { DEFAULT_CONFIG } from "../config.js";
import { ConfigurationError } from "../errors.js";
import { buildCatalogAudit } from "./audit.js";
import { buildCategoryIndex } from "./categories.js";
import { categoryDiff, outsideMappingLists } from "./diff.js";
import { hashOf } from "./hash.js";
import { bestsellerTagsOn, bulkReasons, isActive } from "./products.js";
import { buildSeasonIndex, parseSeasonTag } from "./seasons.js";
import { chooseLaunchSeason, rankEligible, selectForCategory } from "./selection.js";
import { compareNumericIds } from "./text.js";
import { buildCategoryTrend } from "./trend.js";

export const RESULT_SCHEMA_VERSION = 1;

/**
 * Pure, deterministic computation of the complete bestseller selection.
 * Same inputs (in any order) -> same result and same resultHash.
 *
 * @param {object}   args
 * @param {object[]} args.products  complete catalog, engine product shape
 * @param {Map<string, number>} args.sales  legacy product ID -> net units sold
 * @param {object}   args.window    sales window (see engine/time.js)
 * @param {object}  [args.config]
 * @param {object}  [args.completeness]  read evidence, stored alongside the result
 * @param {string[]}[args.warnings]      extra warnings from the readers
 */
export function computeBestsellers({
  products,
  sales,
  window,
  config = DEFAULT_CONFIG,
  completeness = null,
  warnings: readerWarnings = [],
  revenue = new Map(),
  trend = null,
  currency = null,
}) {
  validateInputs(products, sales);
  const categoryIndex = buildCategoryIndex(config.categories);
  const sorted = [...products].sort((a, b) => compareNumericIds(a.legacyId, b.legacyId));
  const seasonIndex = buildSeasonIndex(sorted, config.seasons);

  const summaries = sorted.map((product) => summarize(product, sales, config, categoryIndex, revenue));
  const eligibleIds = new Set(
    summaries.filter((s) => s.active && s.bulkReasons.length === 0).map((s) => s.id),
  );

  const categories = config.categories.map((category) => {
    const unranked = summaries.filter((s) => s.categoryKey === category.key);
    const ranked = rankEligible(unranked.filter((s) => eligibleIds.has(s.id)));
    const rankById = new Map(ranked.map((p) => [p.id, p.overallRank]));
    const categoryProducts = unranked.map((s) => ({ ...s, overallRank: rankById.get(s.id) ?? null }));
    const { chosen, ladder } = chooseLaunchSeason({
      seasonIndex,
      categoryProducts,
      eligibleIds,
    });
    const selection = selectForCategory({ category, ranked, launch: chosen });
    const diff = categoryDiff({ categoryProducts, selected: selection.selected });

    return {
      key: category.key,
      name: category.name,
      productTypes: category.productTypes,
      total: category.total,
      reserved: category.reserved,
      counts: {
        inCategory: categoryProducts.length,
        eligible: ranked.length,
        labeled: categoryProducts.filter((s) => s.labeled).length,
        withSales: ranked.filter((s) => s.netUnits !== 0).length,
      },
      launch: {
        chosenSeason: chosen?.season ?? null,
        source: chosen?.source ?? "none",
        ladder,
        candidates: selection.launchCandidates,
        reservedTarget: selection.reservedTarget,
        reservedFilled: selection.reservedFilled,
        launchReservedShortfall: selection.launchReservedShortfall,
        launchSelectedTotal: selection.launchSelectedTotal,
        note: chosen
          ? null
          : "No season contains an active, non-Bulk product of this category; the overall category ranking is used.",
      },
      selected: selection.selected,
      shortfall: selection.shortfall,
      wouldAdd: diff.wouldAdd,
      wouldRemove: diff.wouldRemove,
      wouldKeep: diff.wouldKeep,
      analytics: categoryAnalytics(ranked, selection, chosen),
      // Full eligible ranking (compact) for the dashboard; not sent to Flow.
      ranking: ranked.map((p) => ({
        id: p.id,
        legacyId: p.legacyId,
        title: p.title,
        productType: p.productType,
        netUnits: p.netUnits,
        netSales: p.netSales,
        overallRank: p.overallRank,
        isLaunch: chosen ? chosen.memberIds.has(p.id) : false,
        selected: selection.selected.some((s) => s.id === p.id),
        labeled: p.labeled,
      })),
    };
  });

  const { cleanup, review } = outsideMappingLists(
    summaries.filter((s) => s.categoryKey === null),
  );

  const audit = buildCatalogAudit({
    products: sorted,
    config,
    categoryIndex,
    isBulkFn: (p) => bulkReasons(p, config.bulk).length > 0,
  });

  const warnings = [...readerWarnings, ...collectWarnings({ audit, summaries, sales, categories })];

  const result = {
    schemaVersion: RESULT_SCHEMA_VERSION,
    mode: "preview",
    window,
    config: {
      bestsellerTag: config.bestsellerTag,
      timeZone: config.timeZone,
      salesWindowDays: config.salesWindowDays,
      categories: config.categories,
      bulk: config.bulk,
      seasons: config.seasons,
    },
    catalogSummary: {
      totalProducts: summaries.length,
      eligibleProducts: eligibleIds.size,
      statusCounts: audit.statusCounts,
      labeledProducts: summaries.filter((s) => s.labeled).length,
    },
    salesSummary: salesSummary(summaries, sales),
    seasons: seasonIndex.map((s) => ({
      season: s.season,
      source: s.source,
      plainProductCount: s.plainProductCount,
      labelProductCount: s.labelProductCount,
      ignoredLabelProductCount: s.ignoredLabelProductIds.length,
      tagsSeen: s.tagsSeen,
    })),
    categories,
    cleanup,
    review,
    audit,
    completeness,
    warnings,
    currency,
    salesTrend: trend ? buildCategoryTrend(trend, window, categoryIndex, config.categories) : null,
  };

  result.inputHash = hashOf({
    products: sorted.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      productType: p.productType,
      tags: [...p.tags].sort(),
    })),
    sales: [...sales.entries()].sort(([a], [b]) => compareNumericIds(a, b)),
    window: window ? { startDate: window.startDate, endDate: window.endDate, timeZone: window.timeZone } : null,
    config: result.config,
  });
  result.resultHash = selectionHash(result);
  return result;
}

/** Hash of the decisions only: used to prove repeat runs produce the same selection. */
export function selectionHash(result) {
  return hashOf({
    categories: result.categories.map((c) => ({
      key: c.key,
      season: c.launch.chosenSeason,
      source: c.launch.source,
      selected: c.selected.map((p) => [p.id, p.pickedAs]),
      add: c.wouldAdd.map((p) => p.id),
      remove: c.wouldRemove.map((p) => p.id),
      keep: c.wouldKeep.map((p) => p.id),
      shortfall: c.shortfall,
    })),
    cleanup: result.cleanup.map((p) => p.id),
    review: result.review.map((p) => p.id),
  });
}

function categoryAnalytics(ranked, selection, chosen) {
  const sum = (list) => list.reduce((total, p) => total + p.netUnits, 0);
  const money = (list) => Math.round(list.reduce((total, p) => total + (p.netSales ?? 0), 0) * 100) / 100;
  const totalUnits = sum(ranked);
  const selectedUnits = sum(selection.selected);
  const totalSales = money(ranked);
  const selectedSales = money(selection.selected);
  const launch = chosen ? ranked.filter((p) => chosen.memberIds.has(p.id)) : [];
  return {
    eligibleProducts: ranked.length,
    productsWithSales: ranked.filter((p) => p.netUnits > 0).length,
    productsWithoutSales: ranked.filter((p) => p.netUnits === 0).length,
    productsWithNegativeUnits: ranked.filter((p) => p.netUnits < 0).length,
    totalUnits,
    selectedUnits,
    selectedShareOfUnits: totalUnits > 0 ? Math.round((selectedUnits / totalUnits) * 1000) / 10 : null,
    totalSales,
    selectedSales,
    launchProducts: launch.length,
    launchUnits: sum(launch),
    // Units of the last product that earned its place through sales.
    cutOffUnits: (() => {
      const byRanking = selection.selected.filter((p) => p.pickedAs === "sales-ranking");
      return byRanking.length ? byRanking[byRanking.length - 1].netUnits : null;
    })(),
  };
}

function summarize(product, sales, config, categoryIndex, revenue = new Map()) {
  const tagsOnProduct = bestsellerTagsOn(product, config.bestsellerTag);
  return {
    id: product.id,
    legacyId: product.legacyId,
    title: product.title,
    productType: product.productType,
    status: product.status,
    active: isActive(product),
    bulkReasons: bulkReasons(product, config.bulk),
    labeled: tagsOnProduct.length > 0,
    bestsellerTags: tagsOnProduct,
    seasonTags: product.tags.filter((tag) => parseSeasonTag(tag, config.seasons)),
    netUnits: sales.get(product.legacyId) ?? 0,
    netSales: revenue.get(product.legacyId) ?? 0,
    categoryKey: categoryIndex.categoryKeyFor(product.productType),
  };
}

function salesSummary(summaries, sales) {
  const catalogIds = new Set(summaries.map((s) => s.legacyId));
  let unmatchedProducts = 0;
  let unmatchedUnits = 0;
  for (const [id, units] of sales.entries()) {
    if (!catalogIds.has(id)) {
      unmatchedProducts += 1;
      unmatchedUnits += units;
    }
  }
  return {
    productsWithSalesRows: sales.size,
    catalogProductsWithNonZeroSales: summaries.filter((s) => s.netUnits !== 0).length,
    negativeNetUnitProducts: summaries.filter((s) => s.netUnits < 0).length,
    unmatchedProducts,
    unmatchedUnits,
  };
}

function collectWarnings({ audit, summaries, categories }) {
  const warnings = [];
  for (const category of audit.mappingCheck) {
    for (const type of category.types) {
      if (!type.foundInCatalog) {
        warnings.push(
          `Mapped product type "${type.configured}" (${category.category}) does not exist in the catalog.`,
        );
      }
    }
  }
  for (const type of audit.productTypes) {
    if (type.mappedTo && type.whitespaceOrCaseVariants) {
      warnings.push(
        `Product type "${type.display}" appears with spelling variants: ${Object.keys(type.rawVariants).join(" | ")}.`,
      );
    }
  }
  if (audit.unmappedRelatedTypes.length > 0) {
    warnings.push(
      `Unmapped product types that look related (please confirm they are excluded on purpose): ${audit.unmappedRelatedTypes
        .map((t) => t.display)
        .join(", ")}.`,
    );
  }
  const negatives = summaries.filter((s) => s.netUnits < 0).length;
  if (negatives > 0) {
    warnings.push(
      `${negatives} product(s) have negative net units in the window (returns exceed sales); they rank below zero-sales products.`,
    );
  }
  for (const category of categories) {
    if (category.shortfall > 0) {
      warnings.push(
        `${category.name}: only ${category.selected.length} of ${category.total} places could be filled (shortfall ${category.shortfall}).`,
      );
    }
  }
  return warnings;
}

function validateInputs(products, sales) {
  if (!Array.isArray(products)) {
    throw new ConfigurationError("INVALID_INPUT", "products must be an array");
  }
  if (!(sales instanceof Map)) {
    throw new ConfigurationError("INVALID_INPUT", "sales must be a Map of legacy product ID -> net units");
  }
  const seen = new Set();
  for (const product of products) {
    if (!product || typeof product.id !== "string" || !/^\d+$/.test(product.legacyId ?? "")) {
      throw new ConfigurationError("INVALID_PRODUCT", "Every product needs a gid and a numeric legacyId.", {
        product,
      });
    }
    if (!Array.isArray(product.tags)) {
      throw new ConfigurationError("INVALID_PRODUCT", `Product ${product.id} has no tag array.`);
    }
    if (seen.has(product.id)) {
      throw new ConfigurationError("DUPLICATE_PRODUCT", `Product ${product.id} appears twice in the catalog.`);
    }
    seen.add(product.id);
  }
  for (const [id, units] of sales.entries()) {
    if (!/^\d+$/.test(id) || !Number.isInteger(units)) {
      throw new ConfigurationError("INVALID_SALES", `Invalid sales row for product ${id}: ${units}`);
    }
  }
}
