import { compareNumericIds } from "./text.js";

/**
 * Ranking: net units sold (desc), then numeric product ID (asc) as a stable,
 * consistent tie-breaker. Eligible products without sales have netUnits = 0.
 */
export function compareByRanking(a, b) {
  if (b.netUnits !== a.netUnits) return b.netUnits - a.netUnits;
  return compareNumericIds(a.legacyId, b.legacyId);
}

/** Returns a new array of eligible summaries sorted by rank, with overallRank set. */
export function rankEligible(eligibleSummaries) {
  return [...eligibleSummaries]
    .sort(compareByRanking)
    .map((summary, index) => ({ ...summary, overallRank: index + 1 }));
}

/**
 * Walks the global season list newest -> oldest and picks the first season
 * that contains at least one eligible product of this category.
 *
 * @param seasonIndex  output of buildSeasonIndex (whole catalog)
 * @param categoryProducts summaries of ALL products in the category (any status)
 * @param eligibleIds  Set of product gids that are active and non-Bulk
 */
export function chooseLaunchSeason({ seasonIndex, categoryProducts, eligibleIds }) {
  const ladder = [];

  for (const season of seasonIndex) {
    const members = categoryProducts.filter((p) => season.members.has(p.id));
    const eligibleMembers = members.filter((p) => eligibleIds.has(p.id));
    const inactiveMembers = members.filter((p) => !p.active).length;
    const bulkMembers = members.filter((p) => p.bulkReasons.length > 0).length;
    const ignoredLabelMembers = categoryProducts.filter((p) =>
      season.ignoredLabelProductIds.includes(p.id),
    ).length;

    const entry = {
      season: season.season,
      source: season.source,
      categoryMembers: members.length,
      eligibleMembers: eligibleMembers.length,
      inactiveMembers,
      bulkMembers,
      ignoredLabelMembers,
      decision: "skipped",
      reason: "",
    };

    if (eligibleMembers.length > 0) {
      entry.decision = "chosen";
      entry.reason = `${eligibleMembers.length} active, non-Bulk product(s) in this category`;
      ladder.push(entry);
      return {
        chosen: {
          season: season.season,
          source: season.source,
          memberIds: new Set(eligibleMembers.map((p) => p.id)),
        },
        ladder,
      };
    }

    entry.reason =
      members.length === 0
        ? "no products from this category carry this season"
        : `all ${members.length} product(s) from this category are inactive or Bulk`;
    ladder.push(entry);
  }

  return { chosen: null, ladder };
}

/**
 * Builds one category's selection.
 *  1. Reserve up to `reserved` places for the highest-ranked launch products
 *     (zero-sales launch products qualify).
 *  2. Fill the remaining places from the overall category ranking, excluding
 *     products already selected (launch products may appear again here).
 *  3. A launch smaller than `reserved` leaves its shortfall to step 2.
 *  4. Fewer eligible products than `total` -> report the shortfall.
 */
export function selectForCategory({ category, ranked, launch }) {
  const reservedTarget = Math.min(category.reserved, category.total);
  const launchIds = launch?.memberIds ?? new Set();

  const launchRanked = ranked.filter((p) => launchIds.has(p.id));
  const reservedPicks = launchRanked.slice(0, reservedTarget);
  const pickedIds = new Set(reservedPicks.map((p) => p.id));

  const remainingPlaces = category.total - reservedPicks.length;
  const fillPicks = ranked
    .filter((p) => !pickedIds.has(p.id))
    .slice(0, remainingPlaces);

  const selected = [
    ...reservedPicks.map((p) => ({ ...p, pickedAs: "launch-reserved", isLaunch: true })),
    ...fillPicks.map((p) => ({
      ...p,
      pickedAs: "sales-ranking",
      isLaunch: launchIds.has(p.id),
    })),
  ].map((p, index) => ({ ...p, position: index + 1 }));

  return {
    selected,
    shortfall: Math.max(0, category.total - selected.length),
    launchCandidates: launchRanked,
    reservedTarget,
    reservedFilled: reservedPicks.length,
    launchReservedShortfall: launch ? reservedTarget - reservedPicks.length : 0,
    launchSelectedTotal: selected.filter((p) => p.isLaunch).length,
  };
}
