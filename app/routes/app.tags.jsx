import { useMemo } from "react";
import { useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { automationStatus, loadLatestView } from "../bestseller/ui/loaders.server";
import { getShopLabelSetting } from "../bestseller/settings.server";
import { approvalPanelData, undoPanelData } from "../bestseller/approval/approval.server";
import { ApprovalPanel } from "../bestseller/ui/approval-panel";
import { ITEM_STATES } from "../bestseller/report/views";
import { ProductLink, downloadText } from "../bestseller/ui/components";
import { CardGrid, IndexTable, Meter, PageBody, compareValues, dateRange, formatNumber, shortDate } from "../bestseller/ui/kit";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const [latest, setting] = await Promise.all([loadLatestView(session.shop), getShopLabelSetting(session.shop)]);
  const status = automationStatus(session.shop, session.scope, setting.storeUpdates);
  return {
    ...latest,
    approvalMode: setting.approvalMode,
    nextRun: status.nightly ? status.nextRun : null,
    approval: latest.latestRun ? await approvalPanelData(session.shop, latest.latestRun.id, session.scope) : null,
    undo: latest.latestRun ? await undoPanelData(session.shop, session.scope, latest.latestRun.id) : null,
  };
};

const STATUS_ORDER = { new: 0, pending_remove: 1, failed: 2, skipped: 3, review: 4, undone: 5, added: 6, removed: 7, already: 8 };

const STATUS_OPTIONS = [
  { value: "all", label: "All products" },
  { value: "add", label: "Products to add" },
  { value: "remove", label: "Products to remove" },
  { value: "keep", label: "Products to keep" },
  { value: "done", label: "Changes made" },
  { value: "undone", label: "Changes undone" },
  { value: "problem", label: "Skipped or failed" },
  { value: "review", label: "Check manually" },
];

const STATUS_MATCH = {
  all: () => true,
  add: (p) => p.state === "new",
  remove: (p) => p.state === "pending_remove",
  keep: (p) => p.state === "already",
  done: (p) => p.state === "added" || p.state === "removed",
  undone: (p) => p.state === "undone",
  problem: (p) => p.state === "skipped" || p.state === "failed",
  review: (p) => p.state === "review",
};

export default function TagList() {
  const { view, latestRun, approval, approvalMode, nextRun, undo } = useLoaderData();
  const [params] = useSearchParams();

  const rows = useMemo(() => {
    if (!view) return [];
    return [
      ...view.categories.flatMap((c) => [...c.willHave, ...c.willLose].map((p) => ({ ...p, category: c.name, categoryKey: c.key }))),
      ...[...view.cleanup, ...view.review].map((p) => ({ ...p, category: "Outside categories", categoryKey: "outside" })),
    ];
  }, [view]);

  if (!view) {
    return (
      <s-page heading="Tag list">
        <s-section>
          <s-empty-state heading="No list yet">
            <s-paragraph slot="subheading">Run the first update from the Overview page.</s-paragraph>
            <s-button slot="primary-action" variant="primary" href="/app">
              Go to Overview
            </s-button>
          </s-empty-state>
        </s-section>
      </s-page>
    );
  }

  const t = view.totals;
  const order = Object.fromEntries([...view.categories.map((c, i) => [c.key, i]), ["outside", view.categories.length]]);
  const categoryOptions = [
    { value: "all", label: "All categories" },
    ...view.categories.map((c) => ({ value: c.key, label: c.name })),
    { value: "outside", label: "Outside categories" },
  ];

  return (
    <s-page heading="Tag list" inlineSize="large">
      <s-button slot="secondary-actions" icon="export" onClick={() => downloadText(`tag-list-${latestRun.localDate}.csv`, toCsv(rows), "text/csv")}>
        Export
      </s-button>

      <PageBody>
      <s-section>
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-badge>{view.tag}</s-badge>
          {t.upToDate ? (
            <s-badge tone="success">Up to date</s-badge>
          ) : t.undone && !t.waiting ? (
            <s-badge tone="warning">{`${t.undone} changes undone`}</s-badge>
          ) : (
            <s-badge tone="warning">{`${t.waiting} changes waiting`}</s-badge>
          )}
          <s-text color="subdued">{`Sales ${dateRange(view.window.startDate, view.window.endDate)} · Updated ${latestRun.finishedAt}`}</s-text>
        </s-stack>
      </s-section>

      {t.upToDate ? (
        <s-banner tone="success" heading="Up to date: nothing to change">
          <s-paragraph>
            {`All ${formatNumber(t.afterApproval - t.toCheck)} selected products already carry ${view.tag}${
              t.added || t.removed ? ` (${t.added} added and ${t.removed} removed${latestRun.appliedAt ? ` on ${latestRun.appliedAt}` : ""})` : ""
            }. Nothing to change.`}
          </s-paragraph>
        </s-banner>
      ) : null}
      {t.problems ? (
        <s-banner tone="critical">{`${t.problems} change(s) were skipped or failed. Filter the status “Skipped or failed” to see why.`}</s-banner>
      ) : null}

      {!t.upToDate && approval && approval.state !== "superseded" ? <ApprovalPanel data={approval} mode={approvalMode} nextRun={nextRun} undo={undo} /> : null}

      <s-stack direction="inline" gap="small">
        <s-button href="/app/tags?status=add">{`Products to add (${t.willGet})`}</s-button>
        <s-button href="/app/tags?status=remove">{`Products to remove (${t.willLose})`}</s-button>
        <s-button href="/app/tags?status=keep">{`Products to keep (${t.staying})`}</s-button>
      </s-stack>

      <CardGrid min={220}>
        {view.categories.map((c) => (
          <s-section key={c.key}>
            <s-stack gap="small-200">
              <s-stack direction="inline" gap="small" alignItems="center" justifyContent="space-between">
                <s-heading>{c.name}</s-heading>
                {c.upToDate ? (
                  <s-badge tone="success">No changes</s-badge>
                ) : c.undone && !c.waiting ? (
                  <s-badge tone="warning">{`${c.undone} undone`}</s-badge>
                ) : (
                  <s-badge tone="warning">{`${c.waiting} changes`}</s-badge>
                )}
              </s-stack>
              <Meter value={c.willHave.length} max={c.total} label={`${c.willHave.length} of ${c.total} places filled`} />
              <s-text color="subdued">
                {`${c.willHave.length} of ${c.total} places${c.season ? ` · launch ${c.season}` : ""}${c.shortfall ? ` · ${c.shortfall} empty: not enough eligible products` : ""}`}
              </s-text>
              <s-link href={`/app/tags?category=${c.key}`}>Show only {c.name}</s-link>
            </s-stack>
          </s-section>
        ))}
        {view.cleanup.length || view.review.length ? (
          <s-section>
            <s-stack gap="small-200">
              <s-stack direction="inline" gap="small" alignItems="center" justifyContent="space-between">
                <s-heading>Outside categories</s-heading>
                <s-badge tone="warning">{`${view.cleanup.length + view.review.length} products`}</s-badge>
              </s-stack>
              <s-text color="subdued">{`${view.cleanup.length} Bulk (tag removed) · ${view.review.length} to check manually`}</s-text>
              <s-link href="/app/tags?category=outside">Show only these</s-link>
            </s-stack>
          </s-section>
        ) : null}
      </CardGrid>

      <IndexTable
        key={`${params.get("category") ?? "all"}-${params.get("status") ?? "all"}`}
        rowKey={(p) => `${p.categoryKey}-${p.id}`}
        rows={rows}
        search={{ placeholder: "Search by product or ID", text: (p) => `${p.title} ${p.legacyId}` }}
        initialFilters={{ category: params.get("category") ?? "all", status: params.get("status") ?? "all" }}
        filters={[
          { key: "category", label: "Category", options: categoryOptions, match: (p, v) => v === "all" || p.categoryKey === v },
          {
            key: "status",
            label: "Status",
            options: STATUS_OPTIONS,
            match: (p, v) => (STATUS_MATCH[v] ?? STATUS_MATCH.all)(p),
          },
        ]}
        sorts={[
          { value: "position", label: "Category order", compare: (a, b) => order[a.categoryKey] - order[b.categoryKey] || compareValues(a.position ?? 999, b.position ?? 999) },
          { value: "status", label: "Status", compare: (a, b) => STATUS_ORDER[a.state] - STATUS_ORDER[b.state] },
          { value: "sold", label: "Sold, high to low", compare: (a, b) => b.netUnits - a.netUnits },
          { value: "title", label: "Product A–Z", compare: (a, b) => compareValues(a.title, b.title) },
        ]}
        columns={[
          { key: "position", label: "#", listSlot: "kicker", numeric: true, render: (p) => p.position ?? "—" },
          { key: "title", label: "Product", listSlot: "primary", render: (p) => <ProductLink product={p} /> },
          { key: "category", label: "Category", listSlot: "labeled" },
          { key: "netUnits", label: `Sold (${view.window.days} days)`, listSlot: "labeled", numeric: true, render: (p) => formatNumber(p.netUnits) },
          { key: "state", label: "Status", listSlot: "inline", render: (p) => <ItemBadge item={p} /> },
          { key: "since", label: "In list since", listSlot: "labeled", render: (p) => (p.since ? shortDate(p.since) : "—") },
          { key: "why", label: "Reason", listSlot: "secondary", render: (p) => (p.message ? `${p.why} · ${p.message}` : p.why) },
        ]}
        emptyText="No products match these filters."
      />
      </PageBody>
    </s-page>
  );
}

function ItemBadge({ item }) {
  const meta = ITEM_STATES[item.state];
  const done = item.changedAt && (item.state === "added" || item.state === "removed");
  return (
    <s-stack gap="none">
      <s-badge tone={meta.tone}>{meta.label}</s-badge>
      {done ? <s-text color="subdued">{new Date(item.changedAt).toLocaleString()}</s-text> : null}
    </s-stack>
  );
}

function toCsv(rows) {
  const out = [["category", "product_id", "title", "sold_30_days", "status", "in_list_since", "reason"]];
  for (const p of rows) out.push([p.category, p.legacyId, p.title, p.netUnits, ITEM_STATES[p.state].label, p.since ? p.since.slice(0, 10) : "", p.why]);
  return out.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(",")).join("\n");
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
