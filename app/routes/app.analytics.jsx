import { useMemo, useState } from "react";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { prismaRepo } from "../bestseller/jobs/repo.server";
import { formatLocal } from "../bestseller/ui/loaders.server";
import { analyticsView, scopeTotals } from "../bestseller/report/analytics";
import { BarList, InlineBar, Sparkline, TrendChart, VizStyles } from "../bestseller/ui/charts";
import { ProductLink } from "../bestseller/ui/components";
import {
  DetailList,
  IndexTable,
  MetricCard,
  MetricGrid,
  PageBody,
  Section,
  SelectField,
  TwoColumn,
  compareValues,
  dateRange,
  formatCompact,
  formatMoney,
  formatNumber,
} from "../bestseller/ui/kit";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const latest = await prismaRepo.latestSucceededRun(session.shop);
  if (!latest?.result) return { view: null };
  return {
    view: analyticsView(latest.result),
    tag: latest.result.config.bestsellerTag,
    updatedAt: formatLocal(latest.finishedAt),
  };
};

export default function Analytics() {
  const { view, tag, updatedAt } = useLoaderData();
  const [scope, setScope] = useState("all");

  const ranking = useMemo(() => {
    if (!view) return [];
    return scope === "all" ? view.categories.flatMap((c) => c.ranking) : view.categories.find((c) => c.key === scope).ranking;
  }, [view, scope]);

  if (!view) {
    return (
      <s-page heading="Sales analytics">
        <s-section>
          <s-empty-state heading="No sales data yet">
            <s-paragraph slot="subheading">Run the first update from the Overview page.</s-paragraph>
            <s-button slot="primary-action" variant="primary" href="/app">
              Go to Overview
            </s-button>
          </s-empty-state>
        </s-section>
      </s-page>
    );
  }

  const t = scopeTotals(view, scope);
  const money = (n) => formatMoney(n, view.currency);
  const maxUnits = Math.max(1, ...ranking.map((p) => p.netUnits));
  const trendSeries = view.trend ? view.trend.series.filter((s) => scope === "all" || s.key === scope) : [];
  const daily = trendSeries.length ? trendSeries[0].values.map((_, i) => trendSeries.reduce((n, s) => n + (s.values[i] ?? 0), 0)) : null;
  const category = scope === "all" ? null : view.categories.find((c) => c.key === scope);

  const trendCard = (
    <Section heading="Units sold per day" info="Hover over the chart, or focus it and use the arrow keys, to read each day. “Show as table” lists every value.">
      {view.trend ? <TrendChart days={view.trend.days} series={trendSeries} /> : <s-text color="subdued">The daily trend is not available for this update.</s-text>}
    </Section>
  );

  const sideCard = category ? (
    <Section heading={`${category.name} details`}>
      <DetailList
        items={[
          ["Newest launch", category.launchSeason ?? "None"],
          ["Launch products", formatNumber(category.launchProducts)],
          ["Launch units", formatNumber(category.launchUnits)],
          ["Eligible products", formatNumber(category.eligible)],
          ["Without sales", formatNumber(category.productsWithoutSales)],
          ["Lowest units with a place", category.cutOffUnits === null ? "—" : formatNumber(category.cutOffUnits)],
        ]}
      />
    </Section>
  ) : (
    <Section heading="Units by category" info="Net units of each category; the line below shows the units of products in the tag list.">
      <BarList
        rows={view.categories.map((c) => ({
          key: c.key,
          label: c.name,
          sublabel: `${formatNumber(c.selectedUnits)} from the tag list${c.launchSeason ? ` · launch ${c.launchSeason}: ${formatNumber(c.launchUnits)}` : ""}`,
          value: c.units,
          colorKey: c.key,
        }))}
      />
    </Section>
  );

  return (
    <s-page heading="Sales analytics" inlineSize="large">
      <PageBody>
        <VizStyles />

        <s-section>
          <s-grid gridTemplateColumns="minmax(200px, 280px) 1fr" gap="base" alignItems="end">
            <SelectField
              label="Category"
              value={scope}
              onChange={setScope}
              options={[{ value: "all", label: "All categories" }, ...view.categories.map((c) => ({ value: c.key, label: c.name }))]}
            />
            <s-text color="subdued">{`${dateRange(view.window.startDate, view.window.endDate)} · last ${view.window.days} full days · updated ${updatedAt}`}</s-text>
          </s-grid>
        </s-section>

        <MetricGrid>
          <MetricCard
            label="Units sold"
            value={formatCompact(t.units)}
            caption={category ? category.name : "All three categories"}
            info="Units ordered minus units returned, all variants together. Active, non-Bulk products only."
            trend={daily ? <Sparkline values={daily} colorKey={scope === "all" ? "pacifiers" : scope} label="Units sold per day" /> : null}
          />
          <MetricCard
            label="Net sales"
            value={view.revenueAvailable ? money(t.sales) : "—"}
            caption={view.revenueAvailable ? `${money(t.selectedSales)} from the tag list` : "Not available for this update"}
            info="From the Shopify sales report. For information only: the selection uses units."
          />
          <MetricCard
            label="Share from tag list"
            value={t.selectedShare !== null ? `${t.selectedShare}%` : "—"}
            caption={`${formatNumber(t.selectedUnits)} of ${formatNumber(t.units)} units`}
            info={`Part of the units that comes from the products chosen for ${tag}.`}
          />
          <MetricCard
            label="Products with sales"
            value={formatNumber(t.productsWithSales)}
            caption={`of ${formatNumber(t.eligible)} eligible products`}
            info="Active, non-Bulk products that sold at least one unit in the period."
          />
        </MetricGrid>

        <TwoColumn main={trendCard} side={sideCard} />

        <IndexTable
          heading="Products"
          rowKey={(p) => p.id}
          rows={ranking}
          search={{ placeholder: "Search by product or ID", text: (p) => `${p.title} ${p.legacyId}` }}
          filters={[
            {
              key: "list",
              label: "Tag list",
              options: [
                { value: "all", label: "All products" },
                { value: "in", label: "In the tag list" },
                { value: "out", label: "Not in the tag list" },
                { value: "tagged", label: "Tagged now" },
              ],
              match: (p, v) => v === "all" || (v === "in" ? p.inList : v === "out" ? !p.inList : p.tagged),
            },
          ]}
          sorts={[
            { value: "units", label: "Units, high to low", compare: (a, b) => b.netUnits - a.netUnits || compareValues(a.title, b.title) },
            ...(view.revenueAvailable ? [{ value: "sales", label: "Net sales, high to low", compare: (a, b) => b.netSales - a.netSales }] : []),
            { value: "share", label: "Share, high to low", compare: (a, b) => (b.share ?? 0) - (a.share ?? 0) },
            { value: "title", label: "Product A–Z", compare: (a, b) => compareValues(a.title, b.title) },
          ]}
          columns={[
            { key: "rank", label: "Rank", listSlot: "kicker", numeric: true, render: (p) => `#${p.rank}` },
            { key: "title", label: "Product", listSlot: "primary", render: (p) => <ProductLink product={p} /> },
            ...(scope === "all" ? [{ key: "category", label: "Category", listSlot: "labeled" }] : []),
            { key: "netUnits", label: "Units", listSlot: "labeled", numeric: true, render: (p) => <InlineBar value={p.netUnits} max={maxUnits} colorKey={p.categoryKey} /> },
            ...(view.revenueAvailable ? [{ key: "netSales", label: "Net sales", listSlot: "labeled", numeric: true, render: (p) => money(p.netSales) }] : []),
            { key: "share", label: "Share of category", listSlot: "labeled", numeric: true, render: (p) => (p.share === null ? "—" : `${p.share}%`) },
            {
              key: "inList",
              label: "Tag list",
              listSlot: "inline",
              render: (p) => (p.inList ? <s-badge tone="success">{p.isLaunch ? "In list · launch" : "In list"}</s-badge> : <s-text color="subdued">—</s-text>),
            },
            { key: "tagged", label: "Tagged now", listSlot: "labeled", render: (p) => (p.tagged ? "Yes" : "No") },
          ]}
          emptyText="No products match."
        />

        {view.store.units !== null ? (
          <s-text color="subdued">
            {`Whole store in the same period: ${formatNumber(view.store.units)} units${
              view.revenueAvailable && view.store.sales !== null ? `, ${money(view.store.sales)} net sales` : ""
            }, including products outside the three categories.`}
          </s-text>
        ) : null}
      </PageBody>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
