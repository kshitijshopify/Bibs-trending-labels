import { DEFAULT_CONFIG } from "../../app/bestseller/config.js";
import { computeBestsellers } from "../../app/bestseller/engine/compute.js";
import { computeSalesWindow } from "../../app/bestseller/engine/time.js";

let nextId = 1000;

export function resetIds(start = 1000) {
  nextId = start;
}

/** Engine-shaped product. */
export function product({ id, title, type = "Pacifier", status = "ACTIVE", tags = [] } = {}) {
  const legacyId = String(id ?? nextId++);
  return {
    id: `gid://shopify/Product/${legacyId}`,
    legacyId,
    title: title ?? `Product ${legacyId}`,
    status,
    productType: type,
    tags,
  };
}

export const WINDOW = computeSalesWindow({
  runLocalDate: "2026-11-06",
  days: 30,
  timeZone: "Europe/Copenhagen",
});

/** sales: { [legacyId]: units } or Map */
export function compute(products, sales = {}, config = DEFAULT_CONFIG) {
  const map = sales instanceof Map ? sales : new Map(Object.entries(sales).map(([k, v]) => [String(k), v]));
  return computeBestsellers({ products, sales: map, window: WINDOW, config });
}

export function category(result, key) {
  return result.categories.find((c) => c.key === key);
}

export const ids = (list) => list.map((p) => p.legacyId);
