import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  CATEGORIES,
  EMAIL_FORMATS,
  LABEL_TAG_CHOICES,
  PREVIEW_RECIPIENT,
  SALES_WINDOW_MAX_DAYS,
  SALES_WINDOW_PRESETS,
} from "../bestseller/config";
import {
  getShopLabelSetting,
  saveShopApprovalMode,
  saveShopEmailFormat,
  saveShopLabelTag,
  saveShopSalesWindow,
  saveShopStoreUpdates,
} from "../bestseller/settings.server";
import { automationStatus, formatLocal } from "../bestseller/ui/loaders.server";
import { ChoiceField, DetailList, IndexTable, Section, SwitchField, TextField } from "../bestseller/ui/kit";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const setting = await getShopLabelSetting(session.shop);
  return {
    setting: { ...setting, updatedAt: formatLocal(setting.updatedAt) },
    status: automationStatus(session.shop, session.scope, setting.storeUpdates),
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const user = session.onlineAccessInfo?.associated_user?.email ?? "admin";
  const intent = String(form.get("intent") ?? "");
  try {
    if (intent === "store") return { ok: true, kind: intent, ...(await saveShopStoreUpdates(session.shop, form.get("value") === "on", user)) };
    if (intent === "email") return { ok: true, kind: intent, ...(await saveShopEmailFormat(session.shop, String(form.get("value") ?? ""), user)) };
    if (intent === "mode") return { ok: true, kind: intent, ...(await saveShopApprovalMode(session.shop, String(form.get("value") ?? ""), user)) };
    if (intent === "period") return { ok: true, kind: intent, ...(await saveShopSalesWindow(session.shop, Number(form.get("value")), user)) };
    if (intent === "tag") return { ok: true, kind: intent, ...(await saveShopLabelTag(session.shop, String(form.get("value") ?? ""), user)) };
    return { ok: false, kind: intent, error: "Unknown setting." };
  } catch (error) {
    return { ok: false, kind: intent, error: error.message };
  }
};

const TAG_OPTIONS = [
  { value: "label:Trending", label: "label:Trending", details: "Confirmed by the merchant" },
  { value: "label:BESTSELLER", label: "label:BESTSELLER", details: "The older bestseller tag" },
  { value: "custom", label: "Another tag" },
];

const MODE_OPTIONS = [
  { value: "automatic", label: "Fully automatic", details: "Every night the store is updated without asking. An email lists every change for review." },
  { value: "manual", label: "Manual approval", details: "Each nightly list waits for approval in the app or with the email link." },
];

const PERIOD_OPTIONS = [
  ...SALES_WINDOW_PRESETS.map((days) => ({ value: String(days), label: `Last ${days} days` })),
  { value: "custom", label: "Custom" },
];

const FORMAT_OPTIONS = Object.entries(EMAIL_FORMATS).map(([value, label]) => ({ value, label }));

export default function Settings() {
  const { setting, status } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const isPreset = LABEL_TAG_CHOICES.includes(setting.labelTag);
  const [tagChoice, setTagChoice] = useState(isPreset ? setting.labelTag : "custom");
  const [customTag, setCustomTag] = useState(isPreset ? "" : setting.labelTag);
  const [mode, setMode] = useState(setting.approvalMode);
  const [format, setFormat] = useState(setting.emailFormat);
  const isPresetPeriod = SALES_WINDOW_PRESETS.includes(setting.salesWindowDays);
  const [periodChoice, setPeriodChoice] = useState(isPresetPeriod ? String(setting.salesWindowDays) : "custom");
  const [customDays, setCustomDays] = useState(isPresetPeriod ? "" : String(setting.salesWindowDays));
  const periodDays = periodChoice === "custom" ? customDays.trim() : periodChoice;
  const saving = fetcher.state !== "idle";
  const tag = tagChoice === "custom" ? customTag.trim() : tagChoice;
  const errorFor = (kind) => (fetcher.data?.ok === false && fetcher.data.kind === kind ? fetcher.data.error : null);

  // Store updates: switching OFF saves at once; switching ON waits for a confirmation.
  const [storeOn, setStoreOn] = useState(setting.storeUpdates);
  useEffect(() => setStoreOn(setting.storeUpdates), [setting.storeUpdates]);
  const confirmingOn = storeOn && !setting.storeUpdates;
  const onStoreChange = (next) => {
    setStoreOn(next);
    if (!next && setting.storeUpdates) fetcher.submit({ intent: "store", value: "off" }, { method: "POST" });
  };

  useEffect(() => {
    if (!fetcher.data?.ok) return;
    if (fetcher.data.kind === "store" && fetcher.data.changed) {
      shopify.toast.show(fetcher.data.storeUpdates ? "Store updates switched on" : "Store updates switched off");
    } else {
      shopify.toast.show(fetcher.data.changed ? "Settings saved" : "No changes");
    }
  }, [fetcher.data, shopify]);

  const save = (intent, value) => fetcher.submit({ intent, value }, { method: "POST" });
  const saveButton = (intent, value, unchanged) => (
    <s-stack direction="inline">
      <s-button variant="primary" {...(saving || unchanged || !value ? { disabled: true } : {})} onClick={() => save(intent, value)}>
        Save
      </s-button>
    </s-stack>
  );

  return (
    <s-page heading="Settings">
      <Section
        heading="Store updates"
        info="The main safety switch. While it is off, the app only calculates the list, shows it and sends the emails. No product is changed."
      >
        <SwitchField
          label="Allow the app to change product tags"
          details={`Adds and removes ${setting.labelTag} only. All other tags are never touched.`}
          checked={storeOn}
          onChange={onStoreChange}
          disabled={saving}
        />
        {confirmingOn ? (
          <>
            <s-banner tone="warning" heading="Turn on store updates?">
              <s-paragraph>
                {setting.approvalMode === "automatic"
                  ? `From now on every nightly update, and Apply now, adds ${setting.labelTag} to the selected products and removes it from products that no longer qualify. Every change is emailed and the latest update can be undone.`
                  : `From now on every approved list is applied to the store: ${setting.labelTag} is added to the selected products and removed from products that no longer qualify.`}
              </s-paragraph>
            </s-banner>
            <s-stack direction="inline" gap="small">
              <s-button variant="primary" {...(saving ? { loading: true } : {})} onClick={() => fetcher.submit({ intent: "store", value: "on" }, { method: "POST" })}>
                Turn on store updates
              </s-button>
              <s-button onClick={() => setStoreOn(false)}>Cancel</s-button>
            </s-stack>
          </>
        ) : setting.storeUpdates ? (
          status.serverReady ? (
            <s-text color="subdued">On: the app changes the tag in the store. Switch it off at any time to stop all changes at once.</s-text>
          ) : (
            <s-banner tone="warning" heading="On in the app, but the server is not ready">
              <s-paragraph>{`Nothing is changed until this is fixed: ${status.serverReasons.join("; ")}.`}</s-paragraph>
            </s-banner>
          )
        ) : (
          <s-text color="subdued">Off: nothing in the store changes. The nightly list and the emails continue, so the results can be reviewed first.</s-text>
        )}
        {errorFor("store") ? <s-banner tone="critical">{errorFor("store")}</s-banner> : null}
      </Section>

      <Section heading="Tag" info="The tag added to best sellers and removed when they no longer qualify.">
        <ChoiceField label="Tag to manage" name="tag" value={tagChoice} options={TAG_OPTIONS} onChange={setTagChoice} />
        {tagChoice === "custom" ? <TextField label="Tag" value={customTag} onChange={setCustomTag} placeholder="label:TopSeller" /> : null}
        {tag && tag !== setting.labelTag ? (
          <s-banner tone="warning">
            {`The next update builds a new list for ${tag}. Products keep ${setting.labelTag}; the app never removes other tags.`}
          </s-banner>
        ) : null}
        {errorFor("tag") ? <s-banner tone="critical">{errorFor("tag")}</s-banner> : null}
        {setting.source === "dashboard" && setting.updatedAt ? (
          <s-text color="subdued">{`Last changed ${setting.updatedAt}${setting.updatedBy ? ` by ${setting.updatedBy}` : ""}`}</s-text>
        ) : null}
        {saveButton("tag", tag, tag === setting.labelTag)}
      </Section>

      <Section
        heading="Sales period"
        info="How many complete days of sales decide the ranking. The days end yesterday (Copenhagen time); today is never included."
      >
        <ChoiceField label="Rank products by sales of the" name="period" value={periodChoice} options={PERIOD_OPTIONS} onChange={setPeriodChoice} />
        {periodChoice === "custom" ? (
          <TextField label="Number of days" value={customDays} onChange={setCustomDays} placeholder="45" details={`1 to ${SALES_WINDOW_MAX_DAYS} days`} />
        ) : null}
        {periodDays && Number(periodDays) !== setting.salesWindowDays ? (
          <s-text color="subdued">{`The next update ranks products by the last ${periodDays} days. Products can join or leave the list because of the new period; History shows each change.`}</s-text>
        ) : null}
        {errorFor("period") ? <s-banner tone="critical">{errorFor("period")}</s-banner> : null}
        {saveButton("period", periodDays, Number(periodDays) === setting.salesWindowDays)}
      </Section>

      <Section
        heading="Updates"
        info="Fully automatic is what the merchant asked for. Either way, the store only changes while Store updates (above) is on."
      >
        <ChoiceField label="How changes reach the store" name="mode" value={mode} options={MODE_OPTIONS} onChange={setMode} />
        {errorFor("mode") ? <s-banner tone="critical">{errorFor("mode")}</s-banner> : null}
        {saveButton("mode", mode, mode === setting.approvalMode)}
      </Section>

      <Section
        heading="Daily email"
        info="The daily email lists every change so mistakes can be caught. Separate emails use the Flow trigger “Bestseller preview ready”; one combined email uses “Bestseller daily summary ready”."
      >
        <ChoiceField label="Email format" name="format" value={format} options={FORMAT_OPTIONS} onChange={setFormat} />
        <s-text color="subdued">{`Emails are sent by Shopify Flow to ${PREVIEW_RECIPIENT} once the workflows are turned on.`}</s-text>
        {errorFor("email") ? <s-banner tone="critical">{errorFor("email")}</s-banner> : null}
        {saveButton("email", format, format === setting.emailFormat)}
      </Section>

      <Section heading="Automation">
        <DetailList
          items={[
            [
              "Store updates",
              status.storeChanges ? (
                <s-badge key="s" tone="success">On</s-badge>
              ) : status.storeSwitch ? (
                <s-badge key="s" tone="warning">On, server not ready</s-badge>
              ) : (
                <s-badge key="s">Off</s-badge>
              ),
            ],
            ["Emails", status.previewEmails ? <s-badge key="p" tone="success">On</s-badge> : <s-badge key="p">Off</s-badge>],
            ["Sales period", `Last ${setting.salesWindowDays} days`],
            ["Nightly update", status.nightly ? `Every night at 02:00 Copenhagen · next ${status.nextRun}` : "Not scheduled"],
          ]}
        />
      </Section>

      <IndexTable
        heading="Selection rules"
        rowKey={(c) => c.key}
        rows={CATEGORIES}
        columns={[
          { key: "name", label: "Category", listSlot: "primary" },
          { key: "types", label: "Product types", listSlot: "secondary", render: (c) => c.productTypes.join(", ") },
          { key: "total", label: "Places", listSlot: "labeled", numeric: true },
          { key: "reserved", label: "Newest launch", listSlot: "labeled", numeric: true },
        ]}
      />
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
