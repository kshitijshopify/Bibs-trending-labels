import { useEffect, useMemo } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { prismaRepo } from "../bestseller/jobs/repo.server";
import { approvalPanelData, undoPanelData } from "../bestseller/approval/approval.server";
import { getShopLabelSetting } from "../bestseller/settings.server";
import { ApprovalPanel } from "../bestseller/ui/approval-panel";
import { IndexTable, Section } from "../bestseller/ui/kit";
import {
  ACTIONS,
  actionCounts,
  actionList,
  cleanupEmail,
  combinedEmail,
  previewEmail,
  seasonStory,
  selectionReason,
  selectionSummary,
} from "../bestseller/report/explain";
import {
  ActionBadge,
  Card,
  CardGrid,
  Collapsible,
  DataTable,
  KeyValues,
  ProductName,
  StatusBadge,
  downloadText,
  resultToCsv,
} from "../bestseller/ui/components";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const run = await prismaRepo.getRun(session.shop, params.runId);
  if (!run) throw new Response("Run not found", { status: 404 });
  const approval = run.status === "SUCCEEDED" ? await approvalPanelData(session.shop, run.id, session.scope) : null;
  const { approvalMode } = await getShopLabelSetting(session.shop);
  const undo = run.status === "SUCCEEDED" ? await undoPanelData(session.shop, session.scope, run.id) : null;
  return {
    approval,
    approvalMode,
    undo,
    run: {
      ...run,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      flowEvents: run.flowEvents.map((e) => ({ ...e, sentAt: e.sentAt?.toISOString() ?? null, updatedAt: e.updatedAt.toISOString() })),
      tagChanges: run.tagChanges.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
    },
  };
};

export default function RunReport() {
  const { run, approval, approvalMode, undo } = useLoaderData();
  const revalidator = useRevalidator();
  const result = run.result;

  useEffect(() => {
    if (run.status !== "RUNNING") return undefined;
    const timer = setInterval(() => revalidator.revalidate(), 3000);
    return () => clearInterval(timer);
  }, [run.status, revalidator]);

  const tag = result?.config?.bestsellerTag ?? "label:BESTSELLER";

  return (
    <s-page inlineSize="large" heading={`Run report ${run.localDate}${result ? ` · ${tag}` : ""}`}>
      <s-link slot="breadcrumb-actions" href="/app/runs">
        Runs
      </s-link>
      {result ? (
        <>
          <s-button slot="secondary-actions" onClick={() => downloadText(`${fileBase(run)}.csv`, resultToCsv(result), "text/csv")}>
            Download CSV
          </s-button>
          <s-button slot="secondary-actions" onClick={() => downloadText(`${fileBase(run)}.json`, JSON.stringify(result, null, 2))}>
            Download JSON
          </s-button>
        </>
      ) : null}

      <RunStatus run={run} />
      {result ? (
        <>
          <Summary result={result} />
          <ApprovalPanel data={approval} mode={approvalMode} undo={undo} />
          <ActionSection result={result} />
          {result.categories.map((category) => (
            <CategorySection key={category.key} category={category} result={result} />
          ))}
          <EmailPreviewSection result={result} run={run} approval={approval} />
          <TechnicalSection result={result} run={run} />
        </>
      ) : null}
      <s-section heading="Run log">
        <Collapsible title={`${run.logs.length} log entries`}>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
            {run.logs.map((l) => `${l.at} [${l.level}] ${l.message}${l.data ? ` ${JSON.stringify(l.data)}` : ""}`).join("\n")}
          </pre>
        </Collapsible>
      </s-section>
    </s-page>
  );
}

const CHANGE_ACTIONS = { add: "Add tag", remove: "Remove tag", undo_add: "Undo: remove tag", undo_remove: "Undo: put tag back" };

function fileBase(run) {
  return `bestseller-run-${run.localDate}-${run.id}`;
}

function RunStatus({ run }) {
  const result = run.result;
  return (
    <s-section heading="Run">
      <s-stack gap="base">
        <s-stack direction="inline" gap="small">
          <StatusBadge status={run.status} />
          <s-badge>{run.trigger}</s-badge>
          <s-badge>{run.mode === "preview" ? "preview: no product changes" : run.mode}</s-badge>
        </s-stack>
        {run.status === "RUNNING" ? (
          <s-banner tone="info" heading="Running">
            <s-paragraph>Current step: {run.phase}. This page refreshes automatically.</s-paragraph>
          </s-banner>
        ) : null}
        {run.status === "FAILED" ? (
          <s-banner tone="critical" heading={`Run failed: ${run.error?.code ?? "ERROR"}`}>
            <s-paragraph>{run.error?.message}</s-paragraph>
            <s-paragraph>No previews were sent and no tags were changed.</s-paragraph>
          </s-banner>
        ) : null}
        {result?.warnings?.length ? (
          <s-banner tone="warning" heading={`${result.warnings.length} warning(s)`}>
            <s-unordered-list>
              {result.warnings.map((w) => (
                <s-list-item key={w}>{w}</s-list-item>
              ))}
            </s-unordered-list>
          </s-banner>
        ) : null}
        {result ? (
          <KeyValues
            items={[
              ["Tag managed", result.config.bestsellerTag],
              ["Sales window", result.window.label],
              ["Products in the catalog (all read)", result.catalogSummary.totalProducts],
              ["Active, non-Bulk products", result.catalogSummary.eligibleProducts],
              ["Net units sold in the window (whole store)", result.completeness?.sales?.grandTotal ?? "-"],
              ["Products tagged right now", result.catalogSummary.labeledProducts],
              ["Finished", run.finishedAt ? new Date(run.finishedAt).toLocaleString() : "-"],
            ]}
          />
        ) : null}
      </s-stack>
    </s-section>
  );
}

function Summary({ result }) {
  const counts = actionCounts(result);
  return (
    <s-section heading="Summary">
      <s-stack gap="base">
        <s-paragraph>
          {`After this run, ${result.config.bestsellerTag} would be added to ${counts.add} product(s), removed from ${
            counts.remove + counts.cleanup
          }, kept on ${counts.keep}. ${counts.review} tagged product(s) need a manual decision. Nothing has been changed yet.`}
        </s-paragraph>
        <CardGrid>
          {result.categories.map((c) => (
            <Card
              key={c.key}
              heading={c.name}
              badge={
                <s-badge tone={c.launch.chosenSeason ? "info" : "neutral"}>
                  {c.launch.chosenSeason ? `${c.launch.chosenSeason} · ${c.launch.source}` : "no launch"}
                </s-badge>
              }
            >
              <s-text>{`${c.selected.length} of ${c.total} selected${c.shortfall ? ` (${c.shortfall} short)` : ""}`}</s-text>
              <s-stack direction="inline" gap="small">
                <s-badge tone="success">{`Add ${c.wouldAdd.length}`}</s-badge>
                <s-badge tone="critical">{`Remove ${c.wouldRemove.length}`}</s-badge>
                <s-badge tone="info">{`Keep ${c.wouldKeep.length}`}</s-badge>
              </s-stack>
              <s-text color="subdued">{selectionSummary(c)}</s-text>
            </Card>
          ))}
          <Card heading="Outside the 3 categories">
            <s-stack direction="inline" gap="small">
              <s-badge tone="critical">{`Bulk cleanup ${counts.cleanup}`}</s-badge>
              <s-badge tone="warning">{`Check manually ${counts.review}`}</s-badge>
            </s-stack>
            <s-text color="subdued">
              Bulk products must not carry the tag. Other tagged products outside the categories are only flagged.
            </s-text>
          </Card>
        </CardGrid>
      </s-stack>
    </s-section>
  );
}

function ActionSection({ result }) {
  const rows = useMemo(() => actionList(result).map((r, i) => ({ ...r, id: `${r.action}-${r.product.id}-${i}` })), [result]);
  const categories = [...new Set(rows.map((r) => r.category))];
  return (
    <IndexTable
      heading={`Proposed changes for ${result.config.bestsellerTag}`}
      rowKey={(r) => r.id}
      rows={rows}
      search={{ placeholder: "Search by product or ID", text: (r) => `${r.product.title} ${r.product.legacyId}` }}
      filters={[
        {
          key: "action",
          label: "Action",
          options: [{ value: "all", label: "All actions" }, ...Object.entries(ACTIONS).map(([value, meta]) => ({ value, label: meta.label }))],
          match: (r, v) => v === "all" || r.action === v,
        },
        {
          key: "category",
          label: "Category",
          options: [{ value: "all", label: "All categories" }, ...categories.map((c) => ({ value: c, label: c }))],
          match: (r, v) => v === "all" || r.category === v,
        },
      ]}
      columns={[
        { key: "product", label: "Product", listSlot: "primary", render: (r) => <ProductName product={r.product} /> },
        { key: "action", label: "Action", listSlot: "inline", render: (r) => <ActionBadge action={r.action} /> },
        { key: "category", label: "Category", listSlot: "labeled" },
        { key: "units", label: "Net units", listSlot: "labeled", numeric: true, render: (r) => r.product.netUnits ?? 0 },
        { key: "why", label: "Reason", listSlot: "secondary" },
      ]}
      emptyText="Nothing matches these filters."
    />
  );
}

function CategorySection({ category, result }) {
  const a = category.analytics;
  return (
    <s-section heading={`${category.name}: ${category.selected.length} of ${category.total} selected`}>
      <s-stack gap="base">
        <s-paragraph>{`Product types: ${category.productTypes.join(", ")}. Reserved for the newest launch: ${category.reserved}.`}</s-paragraph>

        <s-heading>Why this launch season?</s-heading>
        <s-unordered-list>
          {seasonStory(category).map((line) => (
            <s-list-item key={line}>{line}</s-list-item>
          ))}
        </s-unordered-list>
        <s-paragraph>{selectionSummary(category)}</s-paragraph>

        <s-heading>Selected products</s-heading>
        <DataTable
          headers={["#", "Product", "Net units", "Why selected", `Has ${result.config.bestsellerTag} now`]}
          rows={category.selected.map((p) => [
            p.position,
            <ProductName key="p" product={p} />,
            p.netUnits,
            selectionReason(p, category),
            p.labeled ? "Yes (keep)" : "No (add)",
          ])}
          empty="No eligible products."
        />

        {a ? (
          <>
            <s-heading>Sales analytics</s-heading>
            <KeyValues
              items={[
                ["Eligible products (active, non-Bulk)", a.eligibleProducts],
                ["Products with sales / without sales", `${a.productsWithSales} / ${a.productsWithoutSales}`],
                ["Net units sold (eligible products)", a.totalUnits],
                ["Units of the selected products", `${a.selectedUnits}${a.selectedShareOfUnits !== null ? ` (${a.selectedShareOfUnits}% of the category)` : ""}`],
                ["Lowest units that still earned a place by sales", a.cutOffUnits ?? "-"],
                [`Launch ${category.launch.chosenSeason ?? "-"}: products / units`, `${a.launchProducts} / ${a.launchUnits}`],
                a.productsWithNegativeUnits ? ["Products with more returns than sales", a.productsWithNegativeUnits] : null,
              ]}
            />
          </>
        ) : null}

        {category.ranking ? (
          <Collapsible title={`Full sales ranking (${category.ranking.length} eligible products)`}>
            <DataTable
              headers={["Rank", "Product", "Net units", "Launch", "Selected", "Tagged now"]}
              rows={category.ranking.map((p) => [
                p.overallRank,
                <ProductName key="p" product={p} />,
                p.netUnits,
                p.isLaunch ? category.launch.chosenSeason : "",
                p.selected ? "Yes" : "",
                p.labeled ? "Yes" : "",
              ])}
            />
          </Collapsible>
        ) : null}

        <Collapsible title="Season evidence (all seasons examined)">
          <DataTable
            headers={["Season", "Source", "Category products", "Eligible", "Inactive", "Bulk", "label: ignored", "Decision"]}
            rows={category.launch.ladder.map((step) => [
              step.season,
              step.source,
              step.categoryMembers,
              step.eligibleMembers,
              step.inactiveMembers,
              step.bulkMembers,
              step.ignoredLabelMembers,
              `${step.decision}: ${step.reason}`,
            ])}
            empty="No season tags in the catalog."
          />
          <s-paragraph>Eligible launch products, ranked by sales:</s-paragraph>
          <DataTable
            headers={["Rank", "Product", "Net units"]}
            rows={category.launch.candidates.map((p) => [p.overallRank, <ProductName key="p" product={p} />, p.netUnits])}
          />
        </Collapsible>
      </s-stack>
    </s-section>
  );
}

function EmailPreviewSection({ result, run, approval }) {
  const mode = ["DONE", "UNDONE", "UNDO_FAILED"].includes(run.applyStatus) ? "applied" : "preview";
  const options = { mode, approvalUrl: approval?.approvalUrl ?? null };
  const combined = combinedEmail(result, options);
  const emails = [...result.categories.map((c) => previewEmail(result, c, options)), cleanupEmail(result, options)];
  return (
    <Section
      heading="Preview emails (shown here only)"
      info="Exactly what Flow will email. “One combined email” uses the trigger “Bestseller daily summary ready”; the separate emails use “Bestseller preview ready”. Which one is sent is chosen in Settings → Preview email format."
    >
      <s-stack gap="base">
        <s-paragraph>
          {mode === "applied"
            ? "These are the confirmation emails for the applied changes. Nothing is sent from this page."
            : "This is the content of each preview email, including the approval link. Nothing is sent from this page."}
        </s-paragraph>
        <s-heading>One combined email</s-heading>
        <Collapsible title={combined.subject}>
          <s-box padding="base" border="base" borderRadius="base">
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, margin: 0 }}>{combined.body}</pre>
          </s-box>
        </Collapsible>
        <s-heading>Separate emails (one per category)</s-heading>
        {emails.map((email) => (
          <Collapsible key={email.subject} title={email.subject}>
            <s-box padding="base" border="base" borderRadius="base">
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, margin: 0 }}>{email.body}</pre>
            </s-box>
          </Collapsible>
        ))}
      </s-stack>
    </Section>
  );
}

function TechnicalSection({ result, run }) {
  const catalog = result.completeness?.catalog ?? {};
  const sales = result.completeness?.sales ?? {};
  const shop = result.completeness?.shop ?? {};
  const audit = result.audit;
  return (
    <s-section heading="Technical details">
      <s-stack gap="base">
        <Collapsible title="Data completeness checks">
          <KeyValues
            items={[
              ["Shop time zone", shop.ianaTimezone],
              ["Catalog: products read", catalog.productsRead],
              ["Catalog: productsCount before / after", `${catalog.productsCountBefore} / ${catalog.productsCountAfter}`],
              ["Catalog: bulk operation", `${catalog.operationId} (${catalog.status}), ${catalog.linesParsed} lines`],
              ["Catalog: status filter", catalog.statusFilter],
              ["Sales: metric", `${sales.metric} grouped by ${sales.dimension}`],
              ["Sales: dates (inclusive)", `${sales.since} → ${sales.until}`],
              ["Sales window (UTC)", `${result.window.startUtc} → ${result.window.endUtcInclusive}`],
              ["Sales: pages / rows", `${sales.pages} / ${sales.rowsRead}`],
              ["Sales: units with product / without product", `${sales.attributedUnits} / ${sales.unattributedUnits}`],
              ["Sales: report total (must match)", sales.grandTotal],
              ["Sales rows for products no longer in the catalog", `${result.salesSummary.unmatchedProducts} (${result.salesSummary.unmatchedUnits} units)`],
              ["Selection hash", result.resultHash],
              ["Input hash", result.inputHash],
            ]}
          />
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{(sales.queries ?? []).join("\n")}</pre>
        </Collapsible>

        <Collapsible title={`Season tags in the whole catalog (${result.seasons.length})`}>
          <DataTable
            headers={["Season", "Source used", "Products with plain tag", "Products with label: tag", "label: ignored", "Tags seen"]}
            rows={result.seasons.map((s) => [
              s.season,
              s.source,
              s.plainProductCount,
              s.labelProductCount,
              s.ignoredLabelProductCount,
              Object.entries(s.tagsSeen)
                .map(([t, n]) => `${t} ×${n}`)
                .join(", "),
            ])}
          />
        </Collapsible>

        <Collapsible title="Catalog audit: product-type mapping check">
          <DataTable
            headers={["Category", "Configured type", "Found", "Spellings in catalog", "Products", "Active non-Bulk"]}
            rows={audit.mappingCheck.flatMap((c) =>
              c.types.map((t) => [
                c.category,
                t.configured,
                t.foundInCatalog ? "Yes" : "NO",
                Object.entries(t.rawVariants)
                  .map(([raw, n]) => `“${raw}” ×${n}`)
                  .join(", "),
                t.total,
                t.activeNonBulk,
              ]),
            )}
          />
          <s-paragraph>Unmapped types that look related (confirm they are excluded on purpose):</s-paragraph>
          <DataTable
            headers={["Type", "Products"]}
            rows={audit.unmappedRelatedTypes.map((t) => [t.display, t.total])}
            empty="None"
          />
        </Collapsible>

        <Collapsible title={`All product types (${audit.productTypes.length})`}>
          <DataTable
            headers={["Type", "Mapped to", "Products", "Active", "Active non-Bulk"]}
            rows={audit.productTypes.map((t) => [t.display, t.mappedTo ?? "-", t.total, t.active, t.activeNonBulk])}
          />
        </Collapsible>

        <Collapsible title="Tags: season look-alikes, tag spellings, Bulk markers">
          <s-paragraph>Season-like tags that are NOT season tags (ignored):</s-paragraph>
          <DataTable headers={["Tag", "Products"]} rows={audit.rejectedSeasonLikeTags.map((t) => [t.tag, t.count])} />
          <s-paragraph>{`Spellings of ${result.config.bestsellerTag}:`}</s-paragraph>
          <DataTable headers={["Tag", "Products"]} rows={Object.entries(audit.bestsellerTagVariants)} />
          <s-paragraph>{`Bulk marker tags (titles containing “Bulk”: ${audit.bulk.titleHits}):`}</s-paragraph>
          <DataTable headers={["Tag", "Products"]} rows={Object.entries(audit.bulk.markerHits)} />
          <DataTable headers={["Tag mentioning “bulk” but not a marker", "Products"]} rows={audit.bulk.nearMissTags.map((t) => [t.tag, t.count])} />
        </Collapsible>

        <Collapsible title="Flow handoff (payload sizes and delivery)">
          <DataTable
            headers={["Event", "Payload bytes", "Limit", "Fits"]}
            rows={(result.flowPayloads ?? []).map((p) => [
              p.eventKey,
              p.bytes,
              p.limit,
              p.withinLimit ? (p.nearLimit ? "Yes (near limit)" : "Yes") : "NO, nothing would be sent",
            ])}
          />
          <DataTable
            headers={["Event", "Status", "Bytes", "Sent at", "Error"]}
            rows={run.flowEvents.map((e) => [e.eventKey, e.status, e.bytes, e.sentAt ?? "-", e.error ?? ""])}
            empty="No Flow events were sent for this run."
          />
        </Collapsible>

        {run.applySummary || run.tagChanges.length ? (
          <Collapsible title="Tag changes">
            <KeyValues items={[["Summary", run.applySummary ?? "-"]]} />
            <DataTable
              headers={["Product", "Action", "Scope", "Status", "Message"]}
              rows={run.tagChanges.map((c) => [c.productId, CHANGE_ACTIONS[c.action] ?? c.action, c.scope, c.status, c.message ?? ""])}
            />
          </Collapsible>
        ) : null}
      </s-stack>
    </s-section>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
