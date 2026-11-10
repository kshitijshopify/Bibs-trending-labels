import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { prismaRepo } from "../bestseller/jobs/repo.server";
import { formatLocal } from "../bestseller/ui/loaders.server";
import { EVENT_KINDS, collapseHistory } from "../bestseller/report/history";
import { ProductLink } from "../bestseller/ui/components";
import { IndexTable, compareValues } from "../bestseller/ui/kit";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const events = collapseHistory(await prismaRepo.listEvents(session.shop, 3000));
  return { events: events.map((e) => ({ ...e, atIso: e.at.toISOString(), at: formatLocal(e.at) })) };
};

export default function History() {
  const { events } = useLoaderData();
  const kinds = Object.entries(EVENT_KINDS).filter(([kind]) => events.some((e) => e.kind === kind));
  const categories = [...new Set(events.map((e) => e.category).filter(Boolean))];

  return (
    <s-page heading="History" inlineSize="large">
      {events.length === 0 ? (
        <s-section>
          <s-empty-state heading="No activity yet">
            <s-paragraph slot="subheading">Changes appear here after the first update.</s-paragraph>
          </s-empty-state>
        </s-section>
      ) : (
        <IndexTable
          rowKey={(e) => e.id}
          rows={events}
          search={{ placeholder: "Search by product or ID", text: (e) => `${e.title ?? ""} ${e.legacyId ?? ""} ${e.detail ?? ""}` }}
          filters={[
            {
              key: "kind",
              label: "Activity",
              options: [
                { value: "all", label: `All activity (${events.length})` },
                { value: "changes", label: `Changes only (${events.filter((e) => e.kind !== "checked").length})` },
                ...kinds.map(([value, meta]) => ({ value, label: `${meta.label} (${events.filter((e) => e.kind === value).length})` })),
              ],
              match: (e, v) => v === "all" || (v === "changes" ? e.kind !== "checked" : e.kind === v),
            },
            {
              key: "category",
              label: "Category",
              options: [{ value: "all", label: "All categories" }, ...categories.map((c) => ({ value: c, label: c }))],
              match: (e, v) => v === "all" || e.category === v,
            },
          ]}
          sorts={[
            { value: "newest", label: "Newest first", compare: (a, b) => compareValues(b.atIso, a.atIso) },
            { value: "oldest", label: "Oldest first", compare: (a, b) => compareValues(a.atIso, b.atIso) },
            { value: "product", label: "Product A–Z", compare: (a, b) => compareValues(a.title, b.title) },
          ]}
          columns={[
            { key: "at", label: "Date", listSlot: "kicker" },
            {
              key: "kind",
              label: "Activity",
              listSlot: "inline",
              render: (e) => <s-badge tone={EVENT_KINDS[e.kind]?.tone}>{EVENT_KINDS[e.kind]?.label ?? e.kind}</s-badge>,
            },
            { key: "title", label: "Product", listSlot: "primary", render: (e) => (e.legacyId ? <ProductLink product={e} showType={false} /> : "—") },
            { key: "category", label: "Category", listSlot: "labeled", render: (e) => e.category ?? "—" },
            { key: "detail", label: "Details", listSlot: "secondary", render: (e) => e.detail ?? "" },
            { key: "runId", label: "", render: (e) => (e.runId ? <s-link href={`/app/runs/${e.runId}`}>Report</s-link> : "") },
          ]}
          emptyText="No activity matches these filters."
        />
      )}
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
