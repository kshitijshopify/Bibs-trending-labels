/**
 * Season tag detection.
 *
 * Recognised (case-insensitive, whole tag only):
 *   AW27, SS27              plain season tags
 *   SS27-1, SS27-2          drops, grouped under SS27 (still "plain")
 *   label:AW27              label fallback
 *   label:SS27-1            label fallback with drop (configurable)
 *
 * Not recognised: anything with extra text, e.g. "Nordic-Display-Bundle-SS26",
 * "DelistSS27", "label:Delist-SS27".
 */
const SEASON_TAG_RE = /^(label:)?(aw|ss)(\d{2})(?:-(\d{1,3}))?$/i;

/** Loose detector for audit only: tags that mention a season but are not one. */
const SEASON_LIKE_RE = /(aw|ss)\d{2}/i;

export function parseSeasonTag(tag, { allowLabelDropSuffix = true } = {}) {
  const raw = String(tag ?? "").trim();
  const match = SEASON_TAG_RE.exec(raw);
  if (!match) return null;
  const isLabel = Boolean(match[1]);
  const drop = match[4] !== undefined ? Number(match[4]) : null;
  if (isLabel && drop !== null && !allowLabelDropSuffix) return null;
  const half = match[2].toUpperCase();
  return {
    season: `${half}${match[3]}`,
    half,
    year: Number(match[3]),
    drop,
    source: isLabel ? "label" : "plain",
    tag: raw,
  };
}

export function isSeasonLikeButUnrecognised(tag, options) {
  return SEASON_LIKE_RE.test(String(tag ?? "")) && !parseSeasonTag(tag, options);
}

/** Higher = newer. Year first (numeric), then AW ahead of SS within a year. */
export function seasonSortKey(seasonCode) {
  const match = /^(AW|SS)(\d{2})$/.exec(seasonCode);
  if (!match) throw new Error(`Invalid season code: ${seasonCode}`);
  return Number(match[2]) * 2 + (match[1] === "AW" ? 1 : 0);
}

/** Array.sort comparator: newest season first. */
export function compareSeasonsNewestFirst(a, b) {
  return seasonSortKey(b) - seasonSortKey(a);
}

/**
 * Builds the global season index across the WHOLE catalog (all statuses,
 * all product types). For each season, plain tags (including drops) win
 * globally; label: tags are only used when no plain tag exists anywhere.
 *
 * Returns seasons sorted newest first:
 * {
 *   season, source: "plain" | "label",
 *   members: Set<productGid>,            // products that define membership
 *   plainProductCount, labelProductCount,
 *   ignoredLabelProductIds: string[],    // label-only products ignored because plain won
 *   tagsSeen: { [rawTag]: count }
 * }
 */
export function buildSeasonIndex(products, seasonRules = {}) {
  const bySeason = new Map();

  for (const product of products) {
    for (const tag of product.tags) {
      const parsed = parseSeasonTag(tag, seasonRules);
      if (!parsed) continue;
      let entry = bySeason.get(parsed.season);
      if (!entry) {
        entry = {
          season: parsed.season,
          plain: new Set(),
          label: new Set(),
          tagsSeen: {},
        };
        bySeason.set(parsed.season, entry);
      }
      entry[parsed.source].add(product.id);
      entry.tagsSeen[parsed.tag] = (entry.tagsSeen[parsed.tag] ?? 0) + 1;
    }
  }

  return [...bySeason.values()]
    .sort((a, b) => compareSeasonsNewestFirst(a.season, b.season))
    .map((entry) => {
      const source = entry.plain.size > 0 ? "plain" : "label";
      const members = source === "plain" ? entry.plain : entry.label;
      const ignoredLabelProductIds =
        source === "plain"
          ? [...entry.label].filter((id) => !entry.plain.has(id)).sort()
          : [];
      return {
        season: entry.season,
        source,
        members,
        plainProductCount: entry.plain.size,
        labelProductCount: entry.label.size,
        ignoredLabelProductIds,
        tagsSeen: sortObject(entry.tagsSeen),
      };
    });
}

function sortObject(obj) {
  return Object.fromEntries(
    Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}
