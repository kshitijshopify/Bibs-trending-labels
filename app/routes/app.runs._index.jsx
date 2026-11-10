import { useEffect } from "react";
import { useFetcher, useLoaderData, useNavigate, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getSettings } from "../bestseller/env.server";
import { prismaRepo } from "../bestseller/jobs/repo.server";
import { startManualRun } from "../bestseller/jobs/start.server";
import { formatLocal } from "../bestseller/ui/loaders.server";
import { StatusBadge } from "../bestseller/ui/components";
import { IndexTable, compareValues } from "../bestseller/ui/kit";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = getSettings();
  const runs = await prismaRepo.listRuns(session.shop, 50);
  return {
    flowTriggerEnabled: settings.flowTriggerEnabled,
    devOverrides: [
      settings.devWindowIncludeToday ? "sales period includes today" : null,
      settings.allowTimeZoneMismatch ? "shop time zone mismatch allowed" : null,
    ].filter(Boolean),
    runs: runs.map((r) => ({
      id: r.id,
      trigger: r.trigger,
      status: r.status,
      phase: r.phase,
      startedAt: formatLocal(r.startedAt),
      startedIso: r.startedAt.toISOString(),
      windowStart: r.windowStart,
      windowEnd: r.windowEnd,
      resultHash: r.resultHash,
      error: r.error ? JSON.parse(r.error) : null,
    })),
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  return startManualRun({
    shop: session.shop,
    requestedBy: session.onlineAccessInfo?.associated_user?.email ?? "admin",
    sendFlow: form.get("sendFlow") === "true",
    apply: false,
  });
};

const TRIGGERS = { manual: "Manual", schedule: "Nightly" };

export default function Runs() {
  const { runs, flowTriggerEnabled, devOverrides } = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const anyRunning = runs.some((r) => r.status === "RUNNING");
  const busy = fetcher.state !== "idle" || anyRunning;

  useEffect(() => {
    if (fetcher.data?.started && fetcher.data.runId) navigate(`/app/runs/${fetcher.data.runId}`);
    else if (fetcher.data?.reason) shopify.toast.show(fetcher.data.reason, { isError: true });
  }, [fetcher.data, navigate, shopify]);

  useEffect(() => {
    if (!anyRunning) return undefined;
    const timer = setInterval(() => revalidator.revalidate(), 4000);
    return () => clearInterval(timer);
  }, [anyRunning, revalidator]);

  return (
    <s-page heading="Runs" inlineSize="large">
      <s-button slot="primary-action" variant="primary" {...(busy ? { loading: true } : {})} onClick={() => fetcher.submit({ sendFlow: "false" }, { method: "POST" })}>
        Run update
      </s-button>
      {flowTriggerEnabled ? (
        <s-button slot="secondary-actions" {...(busy ? { disabled: true } : {})} onClick={() => fetcher.submit({ sendFlow: "true" }, { method: "POST" })}>
          Run and send to Flow
        </s-button>
      ) : null}

      {devOverrides.length ? (
        <s-banner tone="warning" heading="Development settings active">
          <s-paragraph>{`${devOverrides.join(", ")}. Do not use these on the BIBS store.`}</s-paragraph>
        </s-banner>
      ) : null}

      <IndexTable
        rowKey={(r) => r.id}
        rows={runs}
        filters={[
          {
            key: "status",
            label: "Status",
            options: [
              { value: "all", label: "All statuses" },
              { value: "SUCCEEDED", label: "Completed" },
              { value: "FAILED", label: "Failed" },
              { value: "RUNNING", label: "Running" },
            ],
            match: (r, v) => v === "all" || r.status === v,
          },
        ]}
        sorts={[
          { value: "newest", label: "Newest first", compare: (a, b) => compareValues(b.startedIso, a.startedIso) },
          { value: "oldest", label: "Oldest first", compare: (a, b) => compareValues(a.startedIso, b.startedIso) },
        ]}
        columns={[
          { key: "startedAt", label: "Started", listSlot: "primary", render: (r) => <s-link href={`/app/runs/${r.id}`}>{r.startedAt}</s-link> },
          { key: "trigger", label: "Type", listSlot: "labeled", render: (r) => TRIGGERS[r.trigger] ?? r.trigger },
          { key: "status", label: "Status", listSlot: "inline", render: (r) => <StatusBadge status={r.status} /> },
          { key: "window", label: "Sales period", listSlot: "labeled", render: (r) => (r.windowStart ? `${r.windowStart} – ${r.windowEnd}` : "—") },
          {
            key: "result",
            label: "Result",
            listSlot: "secondary",
            render: (r) => (r.status === "FAILED" ? r.error?.code ?? "Failed" : r.resultHash ? `Selection ${r.resultHash.slice(0, 8)}` : r.phase ?? ""),
          },
        ]}
        emptyText="No runs yet."
      />
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
