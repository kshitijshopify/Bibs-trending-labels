import { addDays } from "./time.js";

/**
 * Daily net units per category for the analytics chart. Pure.
 * byType: Map(productType -> Map("YYYY-MM-DD" -> units)) from readSalesTrend.
 * Every day of the window is present (missing days are 0).
 */
export function buildCategoryTrend(byType, window, categoryIndex, categories) {
  const days = [];
  for (let day = window.startDate; day <= window.endDate; day = addDays(day, 1)) days.push(day);
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const series = categories.map((c) => ({ key: c.key, name: c.name, values: days.map(() => 0) }));
  const byKey = new Map(series.map((s) => [s.key, s]));

  for (const [type, perDay] of byType) {
    const key = categoryIndex.categoryKeyFor(type);
    if (!key) continue;
    const target = byKey.get(key);
    for (const [day, units] of perDay) {
      const i = dayIndex.get(day);
      if (i !== undefined) target.values[i] += units;
    }
  }
  return { days, series };
}
