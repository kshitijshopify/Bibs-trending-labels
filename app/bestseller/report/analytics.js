// Sales analytics view of a run result. Pure.

const round1 = (n) => Math.round(n * 10) / 10;

export function analyticsView(result) {
  const sales = result.completeness?.sales ?? {};
  const categories = result.categories.map((c) => {
    const a = c.analytics ?? {};
    const units = a.totalUnits ?? 0;
    return {
      key: c.key,
      name: c.name,
      units,
      sales: a.totalSales ?? 0,
      eligible: a.eligibleProducts ?? c.counts?.eligible ?? 0,
      productsWithSales: a.productsWithSales ?? 0,
      productsWithoutSales: a.productsWithoutSales ?? 0,
      selectedUnits: a.selectedUnits ?? 0,
      selectedSales: a.selectedSales ?? 0,
      selectedShare: a.selectedShareOfUnits ?? null,
      cutOffUnits: a.cutOffUnits ?? null,
      launchSeason: c.launch.chosenSeason,
      launchUnits: a.launchUnits ?? 0,
      launchProducts: a.launchProducts ?? 0,
      ranking: (c.ranking ?? []).map((p) => ({
        id: p.id,
        legacyId: p.legacyId,
        title: p.title,
        productType: p.productType,
        category: c.name,
        categoryKey: c.key,
        rank: p.overallRank,
        netUnits: p.netUnits,
        netSales: p.netSales ?? 0,
        share: units > 0 ? round1((p.netUnits / units) * 100) : null,
        isLaunch: p.isLaunch,
        inList: p.selected,
        tagged: p.labeled,
      })),
    };
  });

  const sum = (key) => categories.reduce((n, c) => n + (c[key] ?? 0), 0);
  const totals = {
    units: sum("units"),
    sales: Math.round(sum("sales") * 100) / 100,
    productsWithSales: sum("productsWithSales"),
    eligible: sum("eligible"),
    selectedUnits: sum("selectedUnits"),
    selectedSales: Math.round(sum("selectedSales") * 100) / 100,
  };
  totals.selectedShare = totals.units > 0 ? round1((totals.selectedUnits / totals.units) * 100) : null;

  return {
    currency: result.currency ?? null,
    window: { startDate: result.window.startDate, endDate: result.window.endDate, label: result.window.label, days: result.window.days ?? 30 },
    revenueAvailable: Boolean(sales.revenueMetric),
    store: { units: sales.grandTotal ?? null, sales: sales.grandTotalSales ?? null },
    totals,
    categories,
    trend: result.salesTrend ?? null,
  };
}

/** Totals for one category, or for all three when key is "all". */
export function scopeTotals(view, key) {
  if (key === "all") return view.totals;
  const c = view.categories.find((x) => x.key === key);
  return {
    units: c.units,
    sales: c.sales,
    productsWithSales: c.productsWithSales,
    eligible: c.eligible,
    selectedUnits: c.selectedUnits,
    selectedSales: c.selectedSales,
    selectedShare: c.selectedShare,
  };
}
