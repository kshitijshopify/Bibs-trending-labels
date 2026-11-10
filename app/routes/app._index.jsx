import { useEffect } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { prismaRepo } from "../bestseller/jobs/repo.server";
import { startManualRun } from "../bestseller/jobs/start.server";
import { getShopLabelSetting } from "../bestseller/settings.server";
import { automationStatus, formatLocal, loadLatestView } from "../bestseller/ui/loaders.server";
import { EVENT_KINDS, collapseHistory } from "../bestseller/report/history";
import { approvalPanelData, undoPanelData } from "../bestseller/approval/approval.server";
import { ApprovalPanel } from "../bestseller/ui/approval-panel";
import { UndoPanel } from "../bestseller/ui/undo-panel";
import { Sparkline, VizStyles } from "../bestseller/ui/charts";
import { ProductLink } from "../bestseller/ui/components";
import {
  CardGrid,
  DetailList,
  Disclosure,
  InfoTip,
  Meter,
  MetricCard,
  MetricGrid,
  PageBody,
  Section,
  TwoColumn,
  dateRange,
  formatCompact,
  formatNumber,
} from "../bestseller/ui/kit";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const [latest, setting, events] = await Promise.all([
    loadLatestView(session.shop),
    getShopLabelSetting(session.shop),
    prismaRepo.listEvents(session.shop, 60),
  ]);
  return {
    tag: setting.labelTag,
    approvalMode: setting.approvalMode,
    status: automationStatus(session.shop, session.scope, setting.storeUpdates),
    approval: latest.latestRun ? await approvalPanelData(session.shop, latest.latestRun.id, session.scope) : null,
    undo: await undoPanelData(session.shop, session.scope),
    ...latest,
    recent: collapseHistory(events)
      .slice(0, 6)
      .map((e) => ({ ...e, at: formatLocal(e.at) })),
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return startManualRun({
    shop: session.shop,
    requestedBy: session.onlineAccessInfo?.associated_user?.email ?? "admin",
    sendFlow: false,
    apply: false,
  });
};

export default function Overview() {
  const { tag, approvalMode, status, view, latestRun, newestRun, running, recent, approval, undo, dailyUnits, unitsSold } = useLoaderData();
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const busy = fetcher.state !== "idle" || running;

  useEffect(() => {
    if (fetcher.data?.started) shopify.toast.show("Updating the list");
    else if (fetcher.data?.reason) shopify.toast.show(fetcher.data.reason, { isError: true });
  }, [fetcher.data, shopify]);

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => revalidator.revalidate(), 4000);
    return () => clearInterval(timer);
  }, [running, revalidator]);

  const update = () => fetcher.submit({}, { method: "POST" });
  const listTag = view?.tag ?? tag;
  const t = view?.totals;
  const showApproval = Boolean(approval && approval.state !== "nothing" && approval.state !== "superseded");
  // The undo sits in the approval card when both are about the same update.
  const undoInApproval = showApproval && undo?.runId === approval.runId;

  return (
    <s-page heading="Overview">
      <s-button slot="primary-action" variant="primary" {...(busy ? { loading: true } : {})} onClick={update}>
        Update now
      </s-button>
      {view ? (
        <s-button slot="secondary-actions" href="/app/tags">
          View tag list
        </s-button>
      ) : null}

      <PageBody>
        <VizStyles />

        {!status.storeSwitch ? (
          <s-banner tone="info" heading="Store updates are off">
            <s-paragraph>The app calculates the list and sends the emails, but changes no product. Switch it on in Settings when the lists look right.</s-paragraph>
            <s-button slot="secondary-actions" href="/app/settings">
              Open Settings
            </s-button>
          </s-banner>
        ) : null}

        {newestRun?.status === "FAILED" ? (
          <s-banner tone="critical" heading="The last update failed">
            <s-paragraph>
              {`${newestRun.error?.message ?? "Unknown error"} Nothing was changed. The numbers below are from the last successful update.`}
            </s-paragraph>
            <s-button slot="secondary-actions" href={`/app/runs/${newestRun.id}`}>
              View details
            </s-button>
          </s-banner>
        ) : null}

        {!view ? (
          <s-section>
            <s-empty-state heading="Create your first bestseller list">
              <s-paragraph slot="subheading">
                The app reads every product and its recent sales, then shows which products should carry the tag. Nothing in the store changes until store updates are switched on.
              </s-paragraph>
              <s-button slot="primary-action" variant="primary" {...(busy ? { loading: true } : {})} onClick={update}>
                Update now
              </s-button>
            </s-empty-state>
          </s-section>
        ) : (
          <>
            {t.upToDate ? (
              <s-banner tone="success" heading="Up to date">
                <s-paragraph>
                  {`Every selected product already has ${listTag}${t.added || t.removed ? ` (${t.added} added and ${t.removed} removed ${latestRun.appliedAt ? `on ${latestRun.appliedAt}` : ""})` : ""}. Nothing to change.`}
                </s-paragraph>
              </s-banner>
            ) : null}

            <MetricGrid>
              <MetricCard label="To add" value={formatNumber(t.willGet)} caption="new trending products" info="Selected products that do not have the tag yet." />
              <MetricCard label="To remove" value={formatNumber(t.willLose)} caption="no longer qualify" info="Tagged products that are no longer selected, are inactive or are Bulk." />
              <MetricCard
                label="To keep"
                value={formatNumber(t.staying)}
                caption={`${formatNumber(t.taggedNow)} tagged now · ${formatNumber(t.afterApproval)} after the update`}
                info={`Selected products that already carry ${listTag}; nothing changes for them.`}
              />
              <MetricCard
                label="Units sold"
                value={unitsSold === null ? "—" : formatCompact(unitsSold)}
                caption={dateRange(view.window.startDate, view.window.endDate)}
                info={`Net units of the three categories in the last ${view.window.days} full days.`}
                trend={dailyUnits ? <Sparkline values={dailyUnits} colorKey="pacifiers" label="Units sold per day" /> : null}
              />
            </MetricGrid>

            {showApproval ? (
              <ApprovalPanel data={approval} mode={approvalMode} nextRun={status.nightly ? status.nextRun : null} undo={undo} />
            ) : null}
            {undo && !undoInApproval ? <UndoPanel data={undo} mode={approvalMode} /> : null}

            <CardGrid min={260}>
              {view.categories.map((c) => {
                const add = c.willHave.filter((p) => p.state === "new").length;
                const remove = c.willLose.filter((p) => p.state === "pending_remove").length;
                const top = [...c.willHave].sort((a, b) => b.netUnits - a.netUnits)[0];
                return (
                  <s-section key={c.key}>
                    <s-stack gap="small">
                      <s-stack direction="inline" gap="small" alignItems="center" justifyContent="space-between">
                        <s-heading>{c.name}</s-heading>
                        <s-badge tone="info">{c.season ? `Launch ${c.season}` : "No launch"}</s-badge>
                      </s-stack>
                      <Meter value={c.willHave.length} max={c.total} label={`${c.willHave.length} of ${c.total} places filled`} />
                      <s-text color="subdued">{`${c.willHave.length} of ${c.total} places filled${c.shortfall ? ` · ${c.shortfall} empty` : ""}`}</s-text>
                      <s-stack direction="inline" gap="small-200">
                        {c.upToDate ? (
                          <s-badge tone="success">Up to date</s-badge>
                        ) : (
                          <>
                            {add ? <s-badge tone="info">{`${add} to add`}</s-badge> : null}
                            {remove ? <s-badge tone="warning">{`${remove} to remove`}</s-badge> : null}
                            {c.undone ? <s-badge tone="warning">{`${c.undone} undone`}</s-badge> : null}
                          </>
                        )}
                      </s-stack>
                      {top ? <s-text>{`Top seller: ${top.title} (${formatNumber(top.netUnits)} sold)`}</s-text> : null}
                      <s-link href={`/app/tags?category=${c.key}`}>View list</s-link>
                    </s-stack>
                  </s-section>
                );
              })}
            </CardGrid>

            {view.cleanup.length || view.review.length ? (
              <s-banner tone="warning" heading="Tagged products outside the categories">
                <s-paragraph>
                  {`${view.cleanup.length} Bulk product(s) will lose the tag. ${view.review.length} other product(s) keep it until someone decides.`}
                </s-paragraph>
                <s-button slot="secondary-actions" href="/app/tags?category=outside">
                  Review products
                </s-button>
              </s-banner>
            ) : null}
          </>
        )}

        <TwoColumn
          ratio="1fr 1fr"
          main={
            view ? (
              <Section heading="Status">
                <DetailList
                  items={[
                    ["Tag", <s-badge key="t">{listTag}</s-badge>],
                    [
                      "List",
                      t.upToDate ? (
                        <s-badge key="l" tone="success">Up to date</s-badge>
                      ) : t.undone && !t.waiting ? (
                        <s-badge key="l" tone="warning">{`${t.undone} changes undone`}</s-badge>
                      ) : (
                        <s-badge key="l" tone="warning">{`${t.waiting} changes waiting`}</s-badge>
                      ),
                    ],
                    [
                      "Store updates",
                      status.storeChanges ? (
                        <s-badge key="u" tone="success">On</s-badge>
                      ) : status.storeSwitch ? (
                        <s-badge key="u" tone="warning">On, server not ready</s-badge>
                      ) : (
                        <s-badge key="u">Off</s-badge>
                      ),
                    ],
                    ["Mode", status.storeChanges ? (approvalMode === "automatic" ? "Live, fully automatic" : "Live, approval required") : `Preview only (${approvalMode === "automatic" ? "automatic" : "manual approval"} once live)`],
                    ["Sales period", `Last ${view.window.days} days · ${dateRange(view.window.startDate, view.window.endDate)}`],
                    ["Tagged now", `${formatNumber(t.taggedNow)} · ${formatNumber(t.afterApproval)} after the update`],
                    latestRun.appliedAt
                      ? ["Last applied", `${latestRun.appliedAt}${latestRun.applyStatus === "UNDONE" || latestRun.applyStatus === "UNDO_FAILED" ? " (undone)" : ""}`]
                      : null,
                    ["Last update", latestRun.finishedAt],
                    ["Next update", status.nightly ? status.nextRun : "Not scheduled"],
                  ]}
                />
              </Section>
            ) : null
          }
          side={
            <Section heading="Recent activity" actions={<s-link href="/app/history">View all</s-link>}>
              {recent.length ? (
                <s-stack gap="small">
                  {recent.map((e) => (
                    <s-stack key={e.id} gap="none">
                      <s-stack direction="inline" gap="small" alignItems="center">
                        <s-badge tone={EVENT_KINDS[e.kind]?.tone}>{EVENT_KINDS[e.kind]?.label ?? e.kind}</s-badge>
                        <s-text color="subdued">{e.at}</s-text>
                      </s-stack>
                      {e.legacyId ? <ProductLink product={e} showType={false} /> : <s-text>{e.detail}</s-text>}
                    </s-stack>
                  ))}
                </s-stack>
              ) : (
                <s-text color="subdued">No activity yet.</s-text>
              )}
            </Section>
          }
        />

        <s-section>
          <s-stack gap="small">
            <s-stack direction="inline" gap="small-300" alignItems="center">
              <s-heading>How products are chosen</s-heading>
              <InfoTip>The selection rules from the brief.</InfoTip>
            </s-stack>
            <Disclosure title="Show the rules">
              <s-ordered-list>
                <s-list-item>{`Every night the app reads all products and the sales of the last ${view?.window.days ?? 30} full days (Copenhagen time). The period can be changed in Settings.`}</s-list-item>
                <s-list-item>Only active products count. Bulk products (label:BULK or Qty:Bulk tag, or “Bulk” in the title) never get the tag.</s-list-item>
                <s-list-item>Pacifiers get 20 places, Bottles 5, Accessories 5. The best sellers win the places.</s-list-item>
                <s-list-item>
                  Some places are kept for the newest launch (5 for Pacifiers, 2 for the others), even without sales yet. The newest launch comes from season tags such as AW27 or SS27; AW is newer than SS in the same year.
                </s-list-item>
                <s-list-item>{`Chosen products get ${listTag}. Products that are no longer chosen lose it. All other tags stay as they are.`}</s-list-item>
                <s-list-item>
                  {approvalMode === "automatic"
                    ? "The changes are applied automatically after each nightly update, and an email lists every change for review. The latest update can be undone here or from the email link."
                    : "The changes are applied after approval in the app or with the email link."}
                </s-list-item>
              </s-ordered-list>
            </Disclosure>
          </s-stack>
        </s-section>
      </PageBody>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
