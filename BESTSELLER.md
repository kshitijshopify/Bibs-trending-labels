# BIBS bestseller labels: developer guide

Nightly (02:00 Europe/Copenhagen) calculation of category bestsellers for
BIBS B2B DIST. The app changes products only while the in-app **Store updates**
switch is on **and** every server guard passes. The switch is off after every
install or deploy.

For a complete, plain-language description of the app (pages, settings,
emails, undo, go-live), see [HOW-IT-WORKS.md](HOW-IT-WORKS.md).

## Merchant decisions (confirmed 6 Nov 2026)

- **Tag:** `label:Trending`. This is the default; Settings can still change it.
- **Fully automatic:** no approval step. Every night the latest list is applied, and the daily email lists every change for review. The Settings default is **Fully automatic**, and **Manual approval** is still available. "Apply now" applies the current list immediately.
- **Sales period:** can be changed in Settings (7, 14, 30, 60, 90 days or a custom number from 1 to 365). The default is 30. The days always end yesterday in Copenhagen time. A change applies from the next update and is recorded in History.
- **Dashboard:** the Tag list shows "Products to add", "Products to remove" and "Products to keep". Bulk cleanup and products outside the categories are listed separately.
- **Catching mistakes:** the email is the review. **Undo this update** (in the app or from the email link) reverses the latest applied update. See "Undo an update" below.

Store changes need the in-app **Store updates** switch (Settings, off by default) plus the technical switches (`BESTSELLER_APPLY_ENABLED`, the shop allow-list and `write_products`). Recommended: send emails for a few nights with the switch off, then switch it on.

## Layout

| Path | What |
| --- | --- |
| `app/bestseller/config.js` | Business rules: categories, quotas, Bulk markers, tag, time zone |
| `app/bestseller/engine/` | Pure, deterministic logic (seasons, ranking, selection, diff, audit, time) |
| `app/bestseller/shopify/` | Admin API readers: bulk catalog export, ShopifyQL sales, shop info |
| `app/bestseller/flow/` | Flow trigger payloads (size-checked) and sending |
| `app/bestseller/apply/` | Tag updates (`tagsAdd`/`tagsRemove` only), **disabled by default** |
| `app/bestseller/jobs/` | Run orchestration, lock, guards, Prisma repository, scheduler entry |
| `app/bestseller/report/` | Plain-language views: tag list, reasons, history (joined/left), preview email text |
| `app/bestseller/settings.server.js` | Per-shop settings saved from the dashboard: Store updates switch, tag, sales period, update mode, email format |
| `app/routes/app._index.jsx` | **Overview**: big numbers, categories, recent changes, "Update now" |
| `app/routes/app.tags.jsx` | **Tag list**: who carries the tag (new / already tagged), who loses it, and why |
| `app/routes/app.analytics.jsx` | **Sales analytics**: units and net sales per category, daily trend chart, best-seller ranking |
| `app/bestseller/ui/kit.jsx`, `ui/charts.jsx` | ⓘ tooltips, sortable/paged tables, SVG charts (validated palette) |
| `extensions/bestseller-daily-summary/` | Second Flow trigger: everything in ONE event, for one combined email |
| `app/routes/app.history.jsx` | **History**: when each product joined or left the list; after approval, when the tag was added or removed in the store |
| `app/routes/app.settings.jsx` | **Settings**: Store updates switch, tag, sales period, update mode, email format, automation status |
| `app/routes/app.runs._index.jsx` | **Runs (technical)**: every run, with "Run dry run now" and Flow test |
| `app/routes/app.runs.$runId.jsx` | Technical dry-run report: evidence, selections, proposed changes, audit, logs |
| `app/routes/api.cron.nightly.jsx` | External scheduler endpoint |
| `app/routes/approve.$token.jsx` | Public page behind the email link: approve / reject a list, or undo an applied update |
| `app/bestseller/apply/undo.js`, `jobs/undo-job.js` | "Undo this update" |
| `extensions/bestseller-preview-ready/` | App-provided Flow trigger and its `schema.graphql` |
| `tests/` | `npm test`: acceptance tests, readers, job, Flow payloads |

## Safety layers

1. **In-app switch.** Settings → **Store updates** is off for every shop until someone switches it on (`BestsellerSetting.storeUpdates`, default `false`). While it is off, the nightly update, **Apply now** and **Undo** change nothing; lists and emails continue. Switching it off takes effect at once and is recorded in History.
2. **Scopes.** This live app ("Bibs Trending Labels", `shopify.app.toml`) requests `read_products,read_reports,write_products`. `write_products` alone changes nothing; the other layers still apply.
3. **Flags** (in `.env` or the Render env): `BESTSELLER_APPLY_ENABLED`, `BESTSELLER_APPLY_ALLOWED_SHOPS`, `BESTSELLER_FLOW_TRIGGER_ENABLED`. All default to off.
4. **Completeness.** Any incomplete catalog or sales read fails the run. A failed run sends no Flow events and makes no tag changes.
5. **No truncation.** If any Flow payload is 50,000 bytes or more, no events are sent at all.

The app has no dev tools: it never creates, edits or deletes products or orders. Its only write is `tagsAdd` / `tagsRemove` of the label tag.

## Completeness checks

- **Catalog:** bulk export with `status:active,archived,draft,unlisted`. The API's products query defaults to ACTIVE only, so the statuses must be listed. The export must end COMPLETED, with no `errorCode` and no `partialDataUrl`. Every JSONL line must parse with no duplicates. The number of products read must equal `rootObjectCount`, `objectCount` and the exact `productsCount` taken both before and after the export.
- **Sales:** ShopifyQL `FROM sales SHOW net_items_sold GROUP BY product_id SINCE <start> UNTIL <end>` (both dates inclusive), paged with `ORDER BY product_id LIMIT/OFFSET`. All rows, including those without a product, must add up to the ungrouped total. A product may not appear twice. The shop time zone must be Europe/Copenhagen. The dev store can override this with a warning.

## Which tag?

The two client briefs disagree:

- The detailed brief says "use the existing tag `label:BESTSELLER`".
- The summary brief says `label:Trending`.

Choose the tag on the **Settings** page. The order of precedence is: the dashboard choice, then `BESTSELLER_LABEL_TAG`, then `label:BESTSELLER`. The tag is validated, so it cannot be a Bulk marker, a season tag, or contain a comma. A change takes effect on the next run and is recorded in History. The app never touches the old tag: products keep it until someone removes it. Confirm the tag with the merchant before go-live. The dashboard, the preview emails and the Flow payload (`Report.labelTag`) always show the tag in use.

## Preview emails at go-live: Flow (recommended)

The brief asks for an app-provided Flow trigger feeding separate category workflows, so the email is sent by Flow:

```text
App (nightly)  ->  Flow trigger "Bestseller preview ready" (4 events)
               ->  4 new workflows, condition: Category == Pacifiers | Bottles | Accessories | Cleanup and review
               ->  "Send internal email" to mbn@bibsworld.com
```

Why Flow:

- It matches the brief.
- The merchant owns the recipient and the wording.
- No email provider, DNS setup or extra secrets are needed.
- Shopify keeps a run history of every email sent.
- The existing email-preview workflow stays untouched, because these are new workflows on a new trigger.

Sending email straight from the app (SMTP or a provider such as Postmark) is the fallback. Use it only if a payload ever exceeds 50,000 bytes (the run report shows the sizes), or if Flow's email formatting is not enough. It needs a provider account and sender-domain DNS (SPF/DKIM), and it moves email control away from the merchant.

### Draft email body for each category workflow

Flow converts trigger keys to camelCase. Confirm each variable with **Add a variable** in the Flow editor before saving. The same template covers both emails: the preview, which asks for approval, and the confirmation sent after changes are applied.

```liquid
{{ status }}
Category: {{ category }}
Tag: {{ report.labelTag }}
Sales window: {{ salesWindow }}
Newest eligible launch: {{ season }} ({{ seasonSource }})
Selected: {{ selectedCount }} of {{ targetCount }}{% if shortfall > 0 %} (shortfall {{ shortfall }}){% endif %}

Selected products:
{% for p in report.selected %}- {{ p.title }}: {{ p.netUnits }} units{% if p.pickedAs == "launch-reserved" %} (newest launch, reserved){% endif %}
{% endfor %}
{% if mode == "applied" %}Tag added{% else %}Would add the tag{% endif %} ({{ wouldAddCount }}):
{% for p in report.wouldAdd %}- {{ p.title }} ({{ p.netUnits }} units)
{% endfor %}
{% if mode == "applied" %}Tag removed{% else %}Would remove the tag{% endif %} ({{ wouldRemoveCount }}):
{% for p in report.wouldRemove %}- {{ p.title }} ({{ p.reasons | join: ", " }})
{% endfor %}
{% if mode == "applied" %}Tag kept{% else %}Would keep the tag{% endif %} ({{ wouldKeepCount }}):
{% for p in report.wouldKeep %}- {{ p.title }}
{% endfor %}
{% if mode == "applied" %}These changes were made in the store. All other tags were left unchanged.
{% else %}Preview only: nothing has been changed.
Approve or reject this list (valid 48 hours): {{ approvalLink }}
You can also approve it in the app under Overview.{% endif %}
```

Cleanup workflow: list `report.cleanup` (Bulk products, tag removed) and `report.review` (manual check) the same way.

Flow sends the confirmation events with `Mode = applied`. If the merchant wants no confirmation email, add a condition `Mode == preview` to the workflows.

## One combined email (trigger "Bestseller daily summary ready")

Settings → **Preview email format** offers three choices: one email per category (`separate`), **one email with everything** (`combined`), or both. The combined event carries every category, the cleanup list and the review list in the field `Summary`, and it stays far below the 50,000-byte limit (the run report shows the size). Each format is sent as its own batch, so a problem with one never blocks the other.

Workflow: trigger "Bestseller daily summary ready", no condition, action "Send internal email".

Subject:

```liquid
{{ tag }} daily preview – {% if upToDate %}no changes{% else %}{{ wouldAddCount }} to add, {{ wouldRemoveCount }} to remove{% endif %}
```

Body (check the variable names with **Add a variable**; Flow converts keys to camelCase):

```liquid
{{ status }}
Tag: {{ tag }}
Sales window: {{ salesWindow }}
{{ summary.summaryLine }}
{% for c in summary.categories %}
== {{ c.category }} · newest launch {{ c.season }} ({{ c.seasonSource }}) · {{ c.selected.size }} of {{ c.target }} selected{% if c.shortfall > 0 %} (shortfall {{ c.shortfall }}){% endif %} ==
{% for p in c.selected %}{{ forloop.index }}. {{ p.title }}: {{ p.netUnits }} units{% if p.pickedAs == "launch-reserved" %} (newest launch){% endif %}
{% endfor %}{% if c.wouldAdd.size > 0 %}{% if mode == "applied" %}Tag added{% else %}Gets the tag{% endif %}: {% for p in c.wouldAdd %}{{ p.title }}{% unless forloop.last %}, {% endunless %}{% endfor %}
{% endif %}{% if c.wouldRemove.size > 0 %}{% if mode == "applied" %}Tag removed{% else %}Loses the tag{% endif %}: {% for p in c.wouldRemove %}{{ p.title }} ({{ p.reasons | join: ", " }}){% unless forloop.last %}; {% endunless %}{% endfor %}
{% endif %}{% if c.wouldAdd.size == 0 and c.wouldRemove.size == 0 %}No changes in this category.
{% endif %}{% endfor %}
== Outside the categories ==
Bulk products ({% if mode == "applied" %}tag removed{% else %}tag will be removed{% endif %}): {% for p in summary.cleanup %}{{ p.title }}{% unless forloop.last %}, {% endunless %}{% else %}none{% endfor %}
Please review (tag stays): {% for p in summary.review %}{{ p.title }}{% unless forloop.last %}, {% endunless %}{% else %}none{% endfor %}

{% if mode == "applied" %}These changes were made in the store. All other tags were left unchanged.
{% elsif upToDate %}Nothing to approve today.
{% else %}Preview only: nothing has been changed.
Approve or reject this list (valid 48 hours): {{ approvalLink }}{% endif %}
```

The app's technical report shows the same email as plain text under "Preview emails → One combined email".

## Approval and updates

Approval works in two ways, and both are recorded in History with name, time and channel:

1. **In the app.** On Overview, the Tag list or the technical report, click **Approve and apply** or **Reject**. A note is optional. If an approved list could not be applied yet, use **Apply now**.
2. **By email.** Every preview email contains the **Approval link**, which is signed and valid for 48 hours. It opens a page in the app that shows the changes and asks for a name, then offers **Approve** and **Reject**. Opening the link alone changes nothing, so email scanners cannot approve a list.

Rules:

- Only the newest successful list can be approved.
- A decision is final. A list can be applied once. A failed apply can be retried, and retrying is safe.
- Applying uses the approved list. It re-reads every product first and changes only the label tag.
- When store updates are switched off, the approval is still recorded, and the store changes after **Apply now**.

Store updates need all five of these:

- Settings → **Store updates** switched on (in the app, per shop)
- `BESTSELLER_APPLY_ENABLED=true`
- The shop listed in `BESTSELLER_APPLY_ALLOWED_SHOPS`
- `write_products` granted to the app
- An approved list (automatic mode approves the nightly list itself)

Approval modes, set on the Settings page:

- **Fully automatic (default, the merchant's choice):** the nightly run applies the list by itself, then emails what changed. While Store updates is off, it only emails.
- **Manual approval:** every nightly list waits for approval.

Approval links use `SHOPIFY_APP_URL` and `BESTSELLER_APPROVAL_SECRET` (falling back to `SHOPIFY_API_SECRET`). On the dev store the tunnel URL changes every time `shopify app dev` restarts, so older links stop working there.

### Testing approval on the dev store

Done in the development copy (`D:/Metastori app/bibs-bestseller-labels-dev`), never in this live folder.

1. In `.env`, set `BESTSELLER_APPLY_ENABLED=true` and `BESTSELLER_APPLY_ALLOWED_SHOPS=kt-apps-test.myshopify.com`, then restart `shopify app dev`.
2. In the app, open Settings and switch **Store updates** on (confirm with **Turn on store updates**).
3. On Overview, click **Update now**, then **Approve and apply** in the Approval panel. History shows each "Tag added in store" or "Tag removed in store".
4. For the email path: run **Update now** again, copy the approval link from the Approval panel, open it in a browser, enter a name and click **Approve**.

## Undo an update

When the daily email shows a mistake, the latest update that changed the store can be undone:

- **In the app:** Overview (the "Automatic update" card, or "Last store update"), the Tag list, or the run report. Click **Undo this update**.
- **By email:** after an applied update, the email link (the same "Approval link" field, valid for 48 hours) opens a page with **Undo this update**. It asks for a name.

What undo does:

- The tag is removed again from every product that got it in that update. Every product that lost it gets it back, with the exact spelling it had.
- Every product is read again first, and only the label tag is touched. Products that are already back to how they were are left alone.
- Bulk products never get the tag back. They are shown as "Skipped".
- Only the latest update that changed the store can be undone. Once a newer update has been applied, the older one is locked.
- A failed or interrupted undo can be run again ("Try the undo again"). The second run only retries what is left.
- The undo needs the same switches as applying (Store updates on, `BESTSELLER_APPLY_ENABLED`, the allow-list and `write_products`). It runs under the shop lock, so it never overlaps a nightly run.
- History records "Update undone" and one "Tag added in store" / "Tag removed in store" row per product, with the note.
- No email is sent for an undo.

**Pause automatic updates** is ticked by default in fully automatic mode. It switches Updates to Manual approval, so the next nightly update waits instead of making the same changes again. Switch back under Settings → Updates once the cause is fixed. Without the pause, the next nightly update recalculates and applies the list as usual.

Tag changes of an undo are stored as `undo_add` / `undo_remove` in `BestsellerTagChange`. The run's `applyStatus` becomes `UNDOING`, then `UNDONE` (or `UNDO_FAILED`). No database migration is needed.

## Open questions to confirm with the merchant

0. ~~**Tag:** `label:BESTSELLER` or `label:Trending`?~~ Confirmed 6 Nov 2026: `label:Trending`.

1. **Net units:** ShopifyQL attributes returns to the date of the return. Is that the wanted definition?
2. **Orders:** count all orders, or only B2B orders (`is_b2b_order`)?
3. **Negative net units:** these currently rank below zero.
4. **`label:SS27-1`:** accepted as a label fallback (`SEASON_RULES.allowLabelDropSuffix`).
5. **"Active":** only the product status, or also publication to the B2B catalog?
6. **Title "Bulk" substring:** check the audit for unintended matches.

## Commands

| Command | Purpose |
| --- | --- |
| `npm test` | Run all tests (no network) |
| `npm run lint` | ESLint |
| `npm run build` | Production build |
| `npm run setup` | `prisma generate` + `prisma migrate deploy` (Render runs it before `npm run start`) |
| `shopify app deploy` | Releases the live app config and Flow triggers (Bibs Trending Labels) |
| `npm run trigger:nightly` | What the Render cron job runs (needs `BESTSELLER_APP_URL` and `BESTSELLER_CRON_SECRET`) |

`shopify app dev` here previews this app on the dev store only (tunnel URL on that store); the live store keeps the released version. Render setup and go-live steps: HOW-IT-WORKS.md, section 17.
