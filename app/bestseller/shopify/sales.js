import { IncompleteReadError } from "../errors.js";
import { legacyIdFromGid } from "../engine/text.js";
import { SHOPIFYQL_QUERY } from "./queries.js";

export const SALES_METRIC = "net_items_sold";
export const SALES_DIMENSION = "product_id";
/** Shown in analytics only; the selection is based on units. */
export const REVENUE_METRIC = "net_sales";

/** ShopifyQL dates are inclusive on both ends (SINCE / UNTIL). */
export function buildGroupedSalesQuery(window, { limit, offset }) {
  return (
    `FROM sales SHOW ${SALES_METRIC}, ${REVENUE_METRIC} GROUP BY ${SALES_DIMENSION} ` +
    `SINCE ${window.startDate} UNTIL ${window.endDate} ` +
    `ORDER BY ${SALES_DIMENSION} ASC LIMIT ${limit} OFFSET ${offset}`
  );
}

export function buildTotalSalesQuery(window) {
  return `FROM sales SHOW ${SALES_METRIC}, ${REVENUE_METRIC} SINCE ${window.startDate} UNTIL ${window.endDate}`;
}

/**
 * Reads net units sold per product for the window, page by page, and proves
 * completeness:
 *   - no parse errors, table present, expected columns present on any
 *     non-empty result (ShopifyQL returns no columns for an empty result)
 *   - every value is an integer, product IDs numeric or null
 *   - no product appears on two pages (stable paging)
 *   - sum of all rows (incl. rows without a product) == ungrouped total
 * Any failure throws IncompleteReadError.
 */
export async function readSales({ graphql, window, pageSize = 1000, maxPages = 500, log = () => {} }) {
  const totalQuery = buildTotalSalesQuery(window);
  const total = await runShopifyql(graphql, totalQuery, [SALES_METRIC]);
  const parseWarnings = [...total.parseWarnings];
  if (total.rows.length > 1) {
    throw new IncompleteReadError("SALES_TOTAL_INVALID", `The total sales query returned ${total.rows.length} rows.`, {
      query: totalQuery,
    });
  }
  // An empty result (no rows) or an empty sum means no sales in the window.
  const rawTotal = total.rows[0]?.[SALES_METRIC];
  const grandTotal = rawTotal === null || rawTotal === undefined ? 0 : parseInteger(rawTotal, "grand total");
  const grandTotalSales = parseMoney(total.rows[0]?.[REVENUE_METRIC]);
  log("info", "Sales report total for the window", {
    grandTotal,
    totalRows: total.rows.length,
    columns: total.columns,
  });

  const sales = new Map();
  const revenue = new Map();
  let revenueAvailable = false;
  let unattributedUnits = 0;
  let unattributedRows = 0;
  let rowsRead = 0;
  let pages = 0;
  const queries = [totalQuery];

  for (let offset = 0; ; offset += pageSize) {
    if (pages >= maxPages) {
      throw new IncompleteReadError("SALES_TOO_MANY_PAGES", `Sales paging exceeded ${maxPages} pages.`);
    }
    const query = buildGroupedSalesQuery(window, { limit: pageSize, offset });
    queries.push(query);
    const page = await runShopifyql(graphql, query, [SALES_METRIC, SALES_DIMENSION]);
    parseWarnings.push(...page.parseWarnings);
    const rows = page.rows;
    pages += 1;
    rowsRead += rows.length;

    for (const row of rows) {
      const units = parseInteger(row[SALES_METRIC], `product ${row[SALES_DIMENSION]}`);
      const productId = normaliseProductId(row[SALES_DIMENSION]);
      if (productId === null) {
        unattributedUnits += units;
        unattributedRows += 1;
        continue;
      }
      if (sales.has(productId)) {
        throw new IncompleteReadError(
          "SALES_DUPLICATE_PRODUCT",
          `Product ${productId} appeared on more than one sales page; paging is not stable.`,
        );
      }
      sales.set(productId, units);
      if (row[REVENUE_METRIC] !== undefined) {
        revenueAvailable = true;
        revenue.set(productId, parseMoney(row[REVENUE_METRIC]));
      }
    }
    log("info", "Sales page read", { offset, rows: rows.length, columns: page.columns });
    if (rows.length < pageSize) break;
  }

  let attributedUnits = 0;
  for (const units of sales.values()) attributedUnits += units;

  let attributedSales = 0;
  for (const amount of revenue.values()) attributedSales += amount;

  const completeness = {
    metric: SALES_METRIC,
    revenueMetric: revenueAvailable ? REVENUE_METRIC : null,
    attributedSales: Math.round(attributedSales * 100) / 100,
    grandTotalSales,
    dimension: SALES_DIMENSION,
    since: window.startDate,
    until: window.endDate,
    pageSize,
    pages,
    rowsRead,
    productsWithRows: sales.size,
    attributedUnits,
    unattributedRows,
    unattributedUnits,
    grandTotal,
    parseWarnings: [...new Set(parseWarnings)],
    queries,
  };

  if (attributedUnits + unattributedUnits !== grandTotal) {
    throw new IncompleteReadError(
      "SALES_TOTAL_MISMATCH",
      `Sales rows add up to ${attributedUnits + unattributedUnits} but the report total is ${grandTotal}.`,
      completeness,
    );
  }

  return { sales, revenue, completeness };
}

/** Money values arrive as strings such as "123.45"; missing means 0. */
export function parseMoney(value) {
  if (value === null || value === undefined || value === "") return 0;
  const number = Number(String(value).trim());
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

/**
 * Daily net units per product type for the window, for the analytics chart
 * only. Never used for the selection, so a failure here is reported as a
 * warning and does not fail the run.
 * Returns { days: ["YYYY-MM-DD"...], byType: Map(productType -> Map(day -> units)) }.
 */
export async function readSalesTrend({ graphql, window, pageSize = 1000, maxPages = 50 }) {
  const byType = new Map();
  for (let offset = 0, page = 0; page < maxPages; offset += pageSize, page += 1) {
    const query =
      `FROM sales SHOW ${SALES_METRIC} GROUP BY product_type TIMESERIES day ` +
      `SINCE ${window.startDate} UNTIL ${window.endDate} ORDER BY day ASC, product_type ASC LIMIT ${pageSize} OFFSET ${offset}`;
    const { rows } = await runShopifyql(graphql, query, [SALES_METRIC, "day"]);
    for (const row of rows) {
      const day = String(row.day ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      const type = String(row.product_type ?? "");
      const units = Number(row[SALES_METRIC] ?? 0);
      if (!Number.isFinite(units)) continue;
      if (!byType.has(type)) byType.set(type, new Map());
      const series = byType.get(type);
      series.set(day, (series.get(day) ?? 0) + units);
    }
    if (rows.length < pageSize) return { byType };
  }
  throw new IncompleteReadError("SALES_TREND_TOO_LARGE", "The daily sales trend has too many rows.");
}

/**
 * Runs one ShopifyQL query. Returns { rows, columns, parseWarnings }.
 * A result with no rows may come back without columns; that is a valid empty
 * result. Rows without the expected columns are never accepted.
 */
async function runShopifyql(graphql, query, requiredColumns) {
  const data = await graphql(SHOPIFYQL_QUERY, { query });
  const response = data?.shopifyqlQuery;
  if (!response) {
    throw new IncompleteReadError("SALES_NO_RESPONSE", "shopifyqlQuery returned nothing.", { query });
  }
  if (response.parseErrors?.length) {
    throw new IncompleteReadError("SALES_PARSE_ERROR", `ShopifyQL rejected the query: ${response.parseErrors.join("; ")}`, {
      query,
      parseErrors: response.parseErrors,
    });
  }
  const table = response.tableData;
  if (!table || !Array.isArray(table.columns)) {
    throw new IncompleteReadError("SALES_NO_TABLE", "ShopifyQL returned no table data.", { query });
  }
  const rows = typeof table.rows === "string" ? JSON.parse(table.rows) : table.rows;
  if (!Array.isArray(rows)) {
    throw new IncompleteReadError("SALES_ROWS_INVALID", "ShopifyQL rows are not a list.", { query });
  }
  const columns = table.columns.map((c) => c.name);
  const parseWarnings = response.parseWarnings ?? [];

  if (rows.length === 0) return { rows, columns, parseWarnings };

  const columnNames = new Set(columns);
  for (const column of requiredColumns) {
    if (!columnNames.has(column)) {
      throw new IncompleteReadError("SALES_COLUMN_MISSING", `ShopifyQL result has no "${column}" column.`, {
        query,
        columns,
        firstRow: rows[0],
      });
    }
  }
  return { rows, columns, parseWarnings };
}

function parseInteger(value, label) {
  const number = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (value === null || value === undefined || value === "" || !Number.isInteger(number)) {
    throw new IncompleteReadError("SALES_VALUE_INVALID", `Sales value for ${label} is not an integer: ${value}`);
  }
  return number;
}

/** Returns the numeric legacy product ID, or null for rows without a product. */
export function normaliseProductId(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === "" || text === "0") return null;
  if (/^\d+$/.test(text)) return text;
  const fromGid = legacyIdFromGid(text);
  if (fromGid) return fromGid;
  throw new IncompleteReadError("SALES_PRODUCT_ID_INVALID", `Unrecognised product_id value in sales: ${text}`);
}
