import { normalizeTag } from "../../app/bestseller/engine/text.js";
import { operationName } from "../../app/bestseller/shopify/queries.js";

/**
 * In-memory stand-in for the Admin API used by the integration.
 *
 * products:  engine-shaped products (the store's catalog)
 * sales:     { [legacyId]: netUnits }
 * failures:  {
 *   bulkStatus: "FAILED" | "CANCELED" | "EXPIRED",
 *   partialData: true,          // COMPLETED but partialDataUrl set
 *   dropJsonlLine: true,        // export silently misses one product
 *   countDrift: true,           // productsCount changes during the export
 *   downloadHttpStatus: 500,
 *   shopifyqlParseError: true,
 *   shopifyqlPageCap: 50,       // server silently returns at most N rows
 *   accessDenied: "BblShopifyql",
 *   timezone: "Asia/Kolkata",
 *   flowUserError: true,
 * }
 */
export function createFakeShopify({ products = [], sales = {}, revenue = null, unattributedUnits = 0, failures = {} } = {}) {
  const store = new Map(products.map((p) => [p.id, { ...p, tags: [...p.tags] }]));
  const calls = [];
  const flowEvents = [];
  let countCalls = 0;
  let polls = 0;

  function exportJsonl() {
    let rows = [...store.values()];
    if (failures.dropJsonlLine) rows = rows.slice(1);
    return rows
      .map((p) =>
        JSON.stringify({
          id: p.id,
          legacyResourceId: p.legacyId,
          title: p.title,
          status: p.status,
          productType: p.productType,
          tags: p.tags,
        }),
      )
      .join("\n");
  }

  function salesRows() {
    const rows = Object.entries(sales)
      .map(([id, units]) => ({ product_id: id, net_items_sold: String(units), ...(revenue ? { net_sales: String(revenue[id] ?? 0) } : {}) }))
      .sort((a, b) => (BigInt(a.product_id) < BigInt(b.product_id) ? -1 : 1));
    if (unattributedUnits) rows.unshift({ product_id: null, net_items_sold: String(unattributedUnits) });
    return rows;
  }

  async function graphql(query, variables = {}) {
    const name = operationName(query);
    calls.push({ name, variables });

    if (failures.accessDenied === name) {
      const error = new Error("Access denied for shopifyqlQuery field.");
      error.code = "ACCESS_DENIED";
      throw error;
    }

    switch (name) {
      case "BblShopInfo":
        return {
          shop: {
            name: "Fake shop",
            myshopifyDomain: "fake.myshopify.com",
            ianaTimezone: failures.timezone ?? "Europe/Copenhagen",
            currencyCode: "DKK",
            plan: { shopifyPlus: true, partnerDevelopment: false, publicDisplayName: "Plus" },
          },
        };

      case "BblProductsCount": {
        countCalls += 1;
        const drift = failures.countDrift && countCalls > 1 ? 1 : 0;
        return { productsCount: { count: store.size + drift, precision: "EXACT" } };
      }

      case "BblStartCatalogExport":
        return {
          bulkOperationRunQuery: {
            bulkOperation: { id: "gid://shopify/BulkOperation/1", status: "CREATED" },
            userErrors: [],
          },
        };

      case "BblBulkOperation": {
        polls += 1;
        if (polls === 1) {
          return { bulkOperation: { id: variables.id, status: "RUNNING", objectCount: "0", rootObjectCount: "0" } };
        }
        const status = failures.bulkStatus ?? "COMPLETED";
        const count = String(store.size);
        return {
          bulkOperation: {
            id: variables.id,
            status,
            errorCode: status === "FAILED" ? "INTERNAL_SERVER_ERROR" : null,
            objectCount: count,
            rootObjectCount: count,
            fileSize: "1000",
            url: store.size ? "https://fake.example/bulk.jsonl" : null,
            partialDataUrl: failures.partialData || status === "FAILED" ? "https://fake.example/partial.jsonl" : null,
            createdAt: "2026-11-06T01:00:00Z",
            completedAt: "2026-11-06T01:01:00Z",
          },
        };
      }

      case "BblShopifyql": {
        if (failures.shopifyqlParseError) {
          return { shopifyqlQuery: { tableData: null, parseErrors: ["Column Not Found: Column 'net_items_sold' not found"] } };
        }
        const q = variables.query;
        if (/TIMESERIES day/.test(q)) {
          // Daily trend (analytics only): one row per product type and day.
          const rows = (failures.trendRows ?? []).slice(
            Number(/OFFSET (\d+)/.exec(q)[1]),
            Number(/OFFSET (\d+)/.exec(q)[1]) + Number(/LIMIT (\d+)/.exec(q)[1]),
          );
          return table(rows.length ? ["day", "product_type", "net_items_sold"] : [], rows);
        }
        if (!/GROUP BY/.test(q)) {
          const total = Object.values(sales).reduce((a, b) => a + b, 0) + unattributedUnits;
          const money = revenue ? { net_sales: String(Object.values(revenue).reduce((a, b) => a + b, 0)) } : {};
          return table(revenue ? ["net_items_sold", "net_sales"] : ["net_items_sold"], [{ net_items_sold: String(total), ...money }]);
        }
        const limit = Number(/LIMIT (\d+)/.exec(q)[1]);
        const offset = Number(/OFFSET (\d+)/.exec(q)[1]);
        const effectiveLimit = failures.shopifyqlPageCap ? Math.min(limit, failures.shopifyqlPageCap) : limit;
        const rows = failures.groupedAlwaysEmpty ? [] : salesRows().slice(offset, offset + effectiveLimit);
        if (failures.wrongColumnName) {
          return table(["product", "units"], rows.map((r) => ({ product: r.product_id, units: r.net_items_sold })));
        }
        // Like the real API: an empty result comes back without columns.
        return table(rows.length ? ["product_id", "net_items_sold", ...(revenue ? ["net_sales"] : [])] : [], rows);
      }

      case "BblFlowTrigger":
        if (failures.flowUserError) {
          return { flowTriggerReceive: { userErrors: [{ field: ["payload"], message: "Invalid payload" }] } };
        }
        flowEvents.push(variables);
        return { flowTriggerReceive: { userErrors: [] } };

      case "BblProductForApply": {
        const p = store.get(variables.id);
        return {
          product: p
            ? { id: p.id, legacyResourceId: p.legacyId, title: p.title, status: p.status, productType: p.productType, tags: [...p.tags] }
            : null,
        };
      }

      case "BblTagsAdd": {
        const p = store.get(variables.id);
        for (const tag of variables.tags) {
          if (!p.tags.some((t) => normalizeTag(t) === normalizeTag(tag))) p.tags.push(tag);
        }
        return { tagsAdd: { node: { id: p.id, tags: [...p.tags] }, userErrors: [] } };
      }

      case "BblTagsRemove": {
        const p = store.get(variables.id);
        const remove = new Set(variables.tags);
        p.tags = p.tags.filter((t) => !remove.has(t));
        return { tagsRemove: { node: { id: p.id, tags: [...p.tags] }, userErrors: [] } };
      }

      default:
        throw new Error(`Fake Shopify: unexpected operation ${name}`);
    }
  }

  async function fetchImpl(url) {
    if (failures.downloadHttpStatus) {
      return { ok: false, status: failures.downloadHttpStatus, text: async () => "" };
    }
    if (url !== "https://fake.example/bulk.jsonl") throw new Error(`Unexpected URL ${url}`);
    return { ok: true, status: 200, text: async () => exportJsonl() };
  }

  return {
    graphql,
    fetchImpl,
    calls,
    flowEvents,
    store,
    /** Simulates a merchant edit between runs. */
    editProduct(id, change) {
      const p = store.get(id);
      Object.assign(p, change);
    },
    operationNames: () => calls.map((c) => c.name),
  };
}

function table(columns, rows) {
  return {
    shopifyqlQuery: {
      tableData: { columns: columns.map((name) => ({ name, dataType: "STRING", displayName: name })), rows },
      parseErrors: [],
    },
  };
}
