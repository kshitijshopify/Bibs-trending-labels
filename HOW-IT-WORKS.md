# BIBS Trending labels: how the app works

This app keeps the `label:Trending` tag on the right products in every BIBS store that has the app installed (each store separately). Every night it finds the best-selling products in three categories and puts the tag on them. It takes the tag off products that no longer qualify. Then it emails a report of what changed.

The first part of this guide is for everyone who uses the app. The second part, from "Technical reference" on, is for developers.

---

## 1. The short version

- Every night at **02:00 Copenhagen time** the app reads **every product** and the **sales of the last 30 days** (the number of days can be changed).
- It picks the best sellers: **20 Pacifiers, 5 Bottles and 5 Accessories**. Some places are kept for the **newest launch**.
- It compares the picks with the products that carry the tag now. The result is three lists: **add**, **remove** and **keep**.
- If **Store updates** is switched on, the app adds and removes the tag. Otherwise it changes nothing.
- An **email** lists every change, so mistakes can be caught. The latest update can be **undone** with one click.
- The app only ever touches the label tag. Titles, prices, stock, other tags and orders are never changed.

---

## 2. What happens every night

| Step | What the app does | If something goes wrong |
| --- | --- | --- |
| 1. Start | The scheduler calls the app at 00:00 and 01:00 UTC. The app starts the call that falls at 02:00 in Copenhagen (summer and winter time are handled). It runs once per night per shop. | In summer time, a failed run is tried once more at the second call. Otherwise the next night runs as normal. |
| 2. Read products | Reads **all** products (active, draft, archived, unlisted) with their type, status and tags. | If the count does not match exactly, the run stops. Nothing changes and no email is sent. |
| 3. Read sales | Reads **net items sold** per product from Shopify's sales report, for the chosen number of **full days ending yesterday**. Today is never counted. | If the rows do not add up to the report total, the run stops. Nothing changes. |
| 4. Choose | Ranks products and fills the places per category (see section 3). | |
| 5. Compare | Works out which products get the tag, which lose it and which keep it. | |
| 6. Update the store | Only when **Store updates** is on and the mode is **Fully automatic**. Each product is read again just before it is changed. | Products that changed in the meantime are skipped safely. |
| 7. Email | Sends the daily report through Shopify Flow. It lists what was changed, or what would change while store updates are off. | |
| 8. History | Records every product that joined or left the list and every tag change in the store. | |

"Update now" on the Overview page runs steps 2 to 5 at any time. It only builds a new list. It sends no email and changes nothing in the store.

---

## 3. How products are chosen

### Categories and places

| Category | Product types (exact match) | Places | Kept for the newest launch |
| --- | --- | --- | --- |
| Pacifiers | Pacifier, Colour Pacifier, De Lux Pacifier, Pacifier 2 Pack, Pacifier Glow, Pacifier Try-It | 20 | 5 |
| Bottles | Baby Bottle | 5 | 2 |
| Accessories | Baby Bottle Accessories, Pacifier Clip, Pacifier Box, Pacifier Case, Loops | 5 | 2 |

The product type must match one of the listed types exactly, ignoring upper/lower case and extra spaces. "Baby Bottle Accessories" is never counted as a Bottle.

### Which products can be chosen

- **Active** products only. Draft, archived and unlisted products cannot be chosen, and they lose the tag.
- **No Bulk products.** A product is Bulk when it has the tag `label:BULK` or `Qty:Bulk`, or when "bulk" appears in its title. Bulk products never get the tag, and they lose it if they have it.

### Ranking

1. Products are ranked by **net items sold** in the sales period. Returns are subtracted.
2. Products without sales count as 0.
3. On a tie, the product with the lower product ID ranks first, so the result is the same every time.

### Places for the newest launch

1. The app looks at **season tags** across the whole catalog: `AW27`, `SS27`, and drops such as `SS27-1`, which count as SS27.
2. Newer seasons win. A higher year wins, and within the same year **AW is newer than SS**.
3. A label version such as `label:AW27` is only used when **no** product in the store has the plain tag for that season.
4. For each category, the newest season that has at least one active, non-Bulk product in that category is the **launch**. Categories can have different launches.
5. The launch products with the best sales take the kept places (5, 2, 2), **even with no sales yet**. The other places go to the best sellers overall.
6. A launch product can also win an ordinary place through its sales.
7. If there are not enough eligible products, the empty places are shown as a "shortfall".

### Tagged products outside the three categories

- **Bulk products** with the tag lose it. This is the "cleanup" list.
- **Other products** with the tag keep it, but are listed under **Check manually** so someone can decide.

---

## 4. The safety switch: Store updates

Settings → **Store updates** is the main switch.

| Store updates | What happens |
| --- | --- |
| **Off** (the default after every install or deploy) | The app builds the list every night, shows it in the dashboard and sends the email. **No product is changed.** "Apply now" and "Undo" are refused. |
| **On** | The app adds and removes the tag: every night in Fully automatic mode, or after approval in Manual mode. |

- Switching **on** asks for confirmation ("Turn on store updates").
- Switching **off** works immediately, without confirmation.
- Both are recorded in History with the person's name.

For the store to really change, the server also has to be set up for it (see section 13). If the switch is on but the server is not ready, Settings shows "On, server not ready" and lists what is missing. Nothing changes until it is fixed.

**Recommended at go-live:**

1. Leave the switch off for a few nights.
2. Check the emails and the Tag list.
3. Switch it on when the lists look right.

---

## 5. Update modes

Settings → **Updates**:

- **Fully automatic** (the default, the merchant's choice). Every night the new list is applied by itself, and the email shows what was changed. **Apply now** on the Overview page applies the current list at once.
- **Manual approval.** Every nightly list waits for approval in the app or with the link in the email.
  - Only the newest list can be approved, within 48 hours.
  - A decision is final.
  - Approving applies the list right away, if Store updates is on.

---

## 6. The daily email

The email is sent by **Shopify Flow** to the address set in the Flow workflow (`mbn@bibsworld.com`). The app sends the data and Flow sends the email, so the merchant controls the wording and the recipient.

Settings → **Daily email** chooses the format:

- **One email per category:** Pacifiers, Bottles, Accessories, and "Cleanup and review".
- **One email with everything.**
- **Both.**

Each email shows:

- Its status: applied, waiting for approval, or store updates off.
- The tag and the sales period.
- The newest launch per category.
- The chosen products with their units sold.
- What got (or gets) the tag, what lost (or loses) it and why, and what kept it.
- A **link**, valid for 48 hours. Before approval, it opens a page to **approve or reject** the list. After an update was applied, the same link opens a page to **review or undo** that update.

When a night's run fails, **no email is sent** and nothing changes. The failure shows on the Overview page.

---

## 7. Undo an update

If the email shows a mistake, the **latest** update that changed the store can be undone. This works in two places:

- **In the app:** the "Automatic update" or "Last store update" card on Overview, the Tag list, or the run report.
- **From the email link:** enter your name and click **Undo this update**.

What undo does:

- The tag is removed again from every product that got it in that update.
- It is put back on every product that lost it, with the exact spelling it had.
- Every product is read again first. Products that are already back as they were are left alone. Bulk products never get the tag back.
- Only the latest update can be undone. After a newer update has been applied, the older one is locked.
- If some products fail, **Try the undo again** retries only those.
- Everything is recorded in History, including the optional note "What was wrong?".

**Pause automatic updates** is ticked by default. It switches Updates to Manual approval, so the next night does not make the same change again. Fix the cause (for example a wrong product type or tag), then switch back to Fully automatic in Settings.

No email is sent for an undo.

---

## 8. The pages

| Page | What it shows |
| --- | --- |
| **Overview** | A notice while Store updates is off. The numbers To add, To remove, To keep and Units sold. The Automatic update card (Apply now, Undo). Each category with places filled and its top seller. Tagged products outside the categories. Status (Store updates, mode, sales period, last applied, next update), recent activity and the selection rules. **Update now** builds a fresh list. |
| **Tag list** | Every product in the list with its status: Gets the tag, Already tagged, Tag added, Loses the tag, Tag removed, Change undone, Skipped, Failed, Check manually. The buttons **Products to add / remove / keep** filter the list. Search, sorting by status or units, and **Export** to CSV. |
| **Sales analytics** | Units sold and net sales per category, units sold per day as a chart (with a table view), and the full ranking with each product's share. |
| **History** | Every change with date and reason: product joined or left the list, tag added or removed in the store, approvals, applies, undos, setting changes. It can be filtered by activity and category. A product is only listed when something really changed, never twice in a row. |
| **Settings** | Store updates, tag, sales period, update mode, daily email format, automation status and the selection rules. |
| **Runs** | Technical list of every run (nightly and manual). **Run update** builds a list. **Run and send to Flow** also sends the email events (only when Flow sending is enabled on the server). |
| **Run report** | The full evidence for one run: completeness checks, season decision per category, ranking, proposed changes, email preview, payload sizes, tag changes and the log. JSON and CSV download. |
| **Email link page** | Public page behind the email link. Approve or reject a waiting list, or review and undo an applied update. Opening the link changes nothing: every action needs a name and a button click. |

---

## 9. Settings reference

| Setting | Choices | Default | Takes effect |
| --- | --- | --- | --- |
| Store updates | On / Off | **Off** | Immediately |
| Tag | `label:Trending`, `label:BESTSELLER`, or another tag | `label:Trending` | Next update. The old tag is never removed by the app. |
| Sales period | 7, 14, 30, 60, 90 days or a custom number from 1 to 365 | 30 days | Next update |
| Updates | Fully automatic / Manual approval | Fully automatic | Next update |
| Daily email | Per category / one combined / both | Per category | Next email |

The tag cannot be a Bulk marker or a season tag, and it cannot contain a comma. Every setting change is recorded in History with who changed it.

---

## 10. What the app never does

- It never changes titles, descriptions, prices, stock, images, other tags, collections or orders.
- It never creates or deletes products or orders.
- It never uses `productUpdate`. It only uses `tagsAdd` and `tagsRemove` for the one label tag.
- It never changes anything after an incomplete read of products or sales.
- It never sends a cut-off email. If an email's data would be too large for Flow, that email is not sent and the run report says why.

---

## 11. When something goes wrong

| What you see | Meaning | What to do |
| --- | --- | --- |
| "The last update failed" on Overview | The products or sales could not be read completely. Nothing was changed and no email was sent. | Open **View details**. The next night tries again, or click **Update now**. |
| "Store updates are off" | The switch in Settings is off. | Switch it on when the lists look right. |
| "On, server not ready" | The switch is on, but the server is missing a setting (listed on the page). | Ask the developer (section 13). |
| A product shows **Skipped** | It changed between the calculation and the update (for example it became Bulk or inactive), so it was left alone. | Nothing. The next night recalculates. |
| A product shows **Failed** | Shopify did not accept the change (for example a network error). | **Apply now** or **Try the undo again**. Retrying is safe. |
| **Check manually** | A tagged product whose type is not in any category, and which is not Bulk. | Decide by hand: fix the product type, or remove the tag in Shopify. |
| A "shortfall" in a category | Not enough active, non-Bulk products of that category. | Check the product types and statuses. |
| "Another update is running" | A nightly run, apply or undo is in progress. | Try again in a minute. |

---

## Technical reference

## 12. Architecture

```text
Render cron (00:00 + 01:00 UTC)
  └─ POST /api/cron/nightly  (Bearer BESTSELLER_CRON_SECRET)
       └─ per installed store (BESTSELLER_CRON_SHOPS=*): is it 02:00 in Copenhagen?
            ├─ bulk export of all products   (read_products)
            ├─ ShopifyQL sales report         (read_reports)
            ├─ engine: rank, seasons, selection, add/remove/keep  (pure, deterministic)
            ├─ apply: tagsAdd / tagsRemove    (only if every guard passes)
            ├─ Flow triggers → email workflows
            └─ SQLite: run, tag changes, history, list members
```

- **Stack:** Shopify React Router app template (JavaScript), Admin GraphQL API 2026-10, Polaris web components, Prisma with SQLite on a Render persistent disk.
- **One run at a time per shop.** A lock in the database blocks overlapping runs, applies and undos. A lock expires after 45 minutes.
- **Deterministic.** The same products and sales always give the same list. Each run stores input and result hashes.

| Folder | Contents |
| --- | --- |
| `app/bestseller/config.js` | Categories, places, Bulk rules, sales period limits, tag choices |
| `app/bestseller/engine/` | Pure logic: seasons, ranking, selection, diff, audit, time |
| `app/bestseller/shopify/` | Catalog bulk export, ShopifyQL sales, shop info, GraphQL client with safe retries |
| `app/bestseller/jobs/` | Run job, approval job, undo job, guards, Prisma repository, scheduler |
| `app/bestseller/apply/` | Tag changes and undo |
| `app/bestseller/approval/` | Signed email links, approval states, server glue |
| `app/bestseller/flow/` | Flow payloads (size-checked) and sending |
| `app/bestseller/report/` | Tag list, analytics, history and email texts |
| `app/bestseller/ui/` | Shared Polaris components, charts, approval and undo cards |
| `app/routes/` | Pages, the cron endpoint and the email link page |
| `extensions/` | The two Flow triggers |
| `prisma/` | Schema and migrations |
| `tests/` | `npm test`: no network, in-memory Shopify and database |

## 13. Store changes: all five conditions

A tag is only changed when **all** of these are true. Each missing condition is shown in the app as the reason.

1. Settings → **Store updates** is on (in the app, per shop; off by default).
2. `BESTSELLER_APPLY_ENABLED=true` (server environment).
3. The shop is allowed by `BESTSELLER_APPLY_ALLOWED_SHOPS` (`*` allows every installed store).
4. The app has been granted `write_products`.
5. The run read everything completely, and the list is approved (Fully automatic approves the nightly list itself).

## 14. Data stored (SQLite)

| Table | Contents |
| --- | --- |
| `Session` | Shopify sessions (offline token used by the nightly job) |
| `BestsellerSetting` | Per shop: tag, update mode, email format, sales period, **storeUpdates** switch, who changed it |
| `BestsellerRun` | Every run: trigger, status, sales period, full result (JSON), hashes, log, apply status and summary |
| `BestsellerTagChange` | Every tag change attempt: add, remove, undo_add, undo_remove, with status and tags before and after |
| `BestsellerEvent` | The History page |
| `BestsellerListMember` | The current list per tag, so History records only real joins and leaves |
| `BestsellerApproval` | Approvals and rejections: who, when, via app, email or automatic |
| `BestsellerFlowEvent` | Which email events were sent per run, so a retry never sends twice |
| `BestsellerJobLock` | The per-shop lock |

`npm run setup` (`prisma generate` and `prisma migrate deploy`) creates or updates the tables. `shopify app dev` does this locally.

## 15. Environment variables

On Render only these are set: `SCOPES`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL` and `BESTSELLER_CRON_SECRET`. Every other variable is optional. **Not set** means the default in the last column. **Set** (even to an empty value) always wins, so a default can be overridden without a code change. `.env.example` lists them all, commented out with their defaults; the local `.env` only sets `DATABASE_URL`, `BESTSELLER_ALLOW_TIMEZONE_MISMATCH` (the dev store is not on Copenhagen time) and the cron secret.

| Variable | Purpose | Default when not set |
| --- | --- | --- |
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES` | Standard Shopify app settings | required on Render; set by the CLI locally |
| `BESTSELLER_CRON_SECRET` | Bearer secret for the nightly endpoint, at least 24 characters | required for the nightly run |
| `DATABASE_URL` | SQLite file | `/var/data/prod.sqlite` if a disk is mounted at `/var/data` (Render), else `prisma/dev.sqlite` |
| `BESTSELLER_LABEL_TAG` | Tag used before one is chosen in Settings | `label:Trending` |
| `BESTSELLER_APPLY_ENABLED` | Server switch for store changes (`false` stops all of them) | `true` (each store's in-app switch is still off by default) |
| `BESTSELLER_APPLY_ALLOWED_SHOPS` | Shops that may be changed: `*` = every installed store, or a comma-separated list; empty = none | `*` |
| `BESTSELLER_FLOW_TRIGGER_ENABLED` | Send the email events to Flow | `true` |
| `BESTSELLER_APPROVAL_SECRET` | Signs the email links | `SHOPIFY_API_SECRET` |
| `BESTSELLER_CRON_SHOPS` | Shops processed by the nightly endpoint: `*` = every installed store (from the app sessions), or a list; empty = none | `*` |
| `BESTSELLER_ALLOW_TIMEZONE_MISMATCH` | Development only: allow a store not on Copenhagen time (with a warning) | `false` |
| `BESTSELLER_DEV_WINDOW_INCLUDE_TODAY` | Development only: include today's sales | `false` |

The cron job needs `SHOPIFY_APP_URL` (or `BESTSELLER_APP_URL`) and `BESTSELLER_CRON_SECRET`, with the same values as the web service (see `scripts/trigger-nightly.mjs`). The Node version comes from `.node-version`.

**Why a database is needed:** the nightly run happens while nobody has the app open, so it needs each store's stored offline token (and its refresh token). The database also keeps the per-store settings and the Store updates switch, the tag changes that **Undo** reverses, the History page, approvals, which emails were already sent, and the lock that stops two runs overlapping. It is the Prisma SQLite file on the Render disk, so no separate database service is needed.

## 16. Shopify setup

- **Scopes:**
  - `read_products` for the catalog.
  - `read_reports` for ShopifyQL sales. This also needs **protected customer data, Level 2**, declared in the Dev Dashboard.
  - `write_products` for adding and removing the label tag.
  - This folder is the **live app "Bibs Trending Labels"**. Its `shopify.app.toml` requests all three scopes, and the same list is set in `SCOPES` in `render.yaml`. Having `write_products` changes nothing by itself: the other four conditions in section 13 still apply.
  - The development copy is `D:/Metastori app/bibs-bestseller-labels-dev`, with a separate dev app and the dev store. The two folders have the same code; only the app config, `render.yaml` and the package name differ.
- **Flow triggers (app extensions):**
  - `bestseller-preview-ready`: one event per category plus cleanup, for separate emails.
  - `bestseller-daily-summary`: one event with everything, for one combined email.
  - Custom-app Flow triggers only work on **Shopify Plus** stores. BIBS is on Plus; the development store is not.
- **Workflows:** created in Shopify Flow on **each** live store, as **new** workflows: trigger, then "Send internal email". Pick the triggers that belong to **Bibs Trending Labels**: each app has its own triggers, so workflows built for another app do not receive these events. The existing email-preview workflow is not changed. Email templates are in `BESTSELLER.md`.

## 17. Go-live checklist (Render + live store)

### A. Partner Dashboard, app "Bibs Trending Labels"

1. Distribution: **custom distribution** with **Allow multi-store installs for one Plus organization** ticked. One app can serve both live stores only if both belong to the same Plus organization; otherwise it needs public (unlisted) distribution.
2. **API access requests → Run bulk operations → Allow bulk queries.** Without it, every run fails with "Access denied for bulkOperationRunQuery field". Shopify switches it off again if the app runs no bulk query for 31 days.
3. **API access requests → Protected customer data:** declare **Level 2** (needed by `read_reports` for ShopifyQL sales).

### B. Render

Push this folder to its own Git repository. Then either use **New → Blueprint** (`render.yaml` creates both services), or create them by hand:

**1. Web Service** `bibs-trending-labels`

| Setting | Value |
| --- | --- |
| Runtime | Node (version from `.node-version`) |
| Build command | `npm install --include=dev && npm run build` |
| Start command | `npm run setup && npm run start` (applies the database migrations, then starts) |
| Instance type | Starter or higher (a disk needs a paid instance) |
| Disk | Mount path `/var/data`, 1 GB. **Required**: without it sessions, settings and history are lost on every deploy. |
| Health check path | `/` |

Environment (nothing else):

| Variable | Value |
| --- | --- |
| `SCOPES` | `read_products,read_reports,write_products` (same as `shopify.app.toml`) |
| `SHOPIFY_API_KEY` | Client ID of Bibs Trending Labels (`2cc34a6b…`, see `shopify.app.toml`) |
| `SHOPIFY_API_SECRET` | Client secret of Bibs Trending Labels |
| `SHOPIFY_APP_URL` | `https://bibs-trending-labels.onrender.com` (the service URL, no trailing slash) |
| `BESTSELLER_CRON_SECRET` | A random value of at least 24 characters, e.g. from `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

**2. Cron Job** `bibs-trending-labels-nightly` (same repository)

| Setting | Value |
| --- | --- |
| Schedule | `0 0,1 * * *` (00:00 and 01:00 UTC; the app picks the one that is 02:00 Copenhagen) |
| Build command | `true` (nothing to install) |
| Command | `node scripts/trigger-nightly.mjs` |
| Environment | `SHOPIFY_APP_URL` and `BESTSELLER_CRON_SECRET`, same values as the web service |

No store domain is entered anywhere: every store that installs the app is processed automatically, and a store drops out when it uninstalls.

**3.** If Render gives a different URL than `https://bibs-trending-labels.onrender.com`, put that URL in `shopify.app.toml` (`application_url` and `redirect_urls`) and in `SHOPIFY_APP_URL` on both services.

**4.** Wait until the web service is live and `/` answers. The deploy log shows `[setup] Database: file:/var/data/prod.sqlite`; if it shows `file:dev.sqlite`, the disk is missing.

### C. Shopify

1. In this folder: `shopify app deploy`. This releases the app config (URL, scopes, webhooks) and the two Flow triggers.
2. Install the app on **both** live stores from the custom distribution install link, and accept the permissions.
3. Open the app once in each store. Settings shows the automation status. **Store updates is off** in both, so nothing changes yet. Each store has its own settings (tag, sales period, update mode, email format), runs and history. Both stores must be on the Europe/Copenhagen time zone, or their runs fail the time zone check.
4. In Shopify Flow on each store, build the new email workflows on the Bibs Trending Labels triggers (section 16). Turn them on when the email text is right. Flow triggers from a custom app only work on Plus stores.

### D. Switching on

1. Let the nightly run send emails for a few nights with **Store updates** off. Check the emails and the Tag list.
2. Switch **Store updates** on in Settings, separately in each store. From the next night, tags change automatically in that store. **Apply now** applies the current list at once.
3. To stop at any time, switch **Store updates** off. It takes effect immediately, with no deploy needed.

Notes:

- To stop all store changes in every store at once, add `BESTSELLER_APPLY_ENABLED=false` on the web service. To stop the email events, add `BESTSELLER_FLOW_TRIGGER_ENABLED=false`.
- Do not deploy the web service between 00:00 and 01:30 UTC (the nightly run). With a disk, every deploy has a short downtime.
- The database is the SQLite file `/var/data/prod.sqlite` on the disk. It survives deploys and restarts. Render takes daily disk snapshots.

## 18. Local development

New features are built and tested in the development copy, then copied here:

```bash
cd "D:/Metastori app/bibs-bestseller-labels-dev"
npm install
cp .env.example .env      # then fill in what you need
shopify app dev           # dev store; applies database migrations
npm test                  # all tests, no network
npm run lint
npm run build
```

When copying a change to this folder, leave `shopify.app.toml`, `render.yaml` and the `name` in `package.json` as they are. `shopify app dev` in this folder previews the live app on the dev store (kt-apps-test) through a tunnel. This only affects that dev store; the live store keeps the released version until `shopify app deploy`.

To test store changes on the development store:

1. In `.env`, set `BESTSELLER_APPLY_ENABLED=true` and `BESTSELLER_APPLY_ALLOWED_SHOPS=kt-apps-test.myshopify.com`, then restart `shopify app dev`.
2. In the app, open Settings and switch **Store updates** on.
3. On Overview, click **Update now**, then **Apply now**.
4. Check the Tag list and History, then try **Undo this update**.

The app has no tools for creating test products or orders. Test data on the development store is managed in the Shopify admin.
