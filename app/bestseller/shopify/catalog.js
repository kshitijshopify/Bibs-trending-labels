import { IncompleteReadError } from "../errors.js";
import { legacyIdFromGid } from "../engine/text.js";
import {
  ALL_STATUSES_QUERY,
  BULK_OPERATION_STATUS,
  BULK_RUN_QUERY,
  CATALOG_BULK_QUERY,
  PRODUCTS_COUNT,
} from "./queries.js";

const VALID_STATUSES = new Set(["ACTIVE", "ARCHIVED", "DRAFT", "UNLISTED"]);
const PENDING_STATUSES = new Set(["CREATED", "RUNNING", "CANCELING"]);
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reads the COMPLETE catalog (every status) through a bulk operation and
 * proves completeness:
 *   - bulk status COMPLETED, no errorCode, no partialDataUrl
 *   - every JSONL line parses into a valid product, no duplicates
 *   - lines == rootObjectCount == objectCount
 *   - productsCount (exact, all statuses) before == after == lines
 * Any failure throws IncompleteReadError.
 */
export async function readCatalog({
  graphql,
  fetchImpl = fetch,
  sleep = defaultSleep,
  log = () => {},
  pollIntervalMs = 2000,
  timeoutMs = 30 * 60 * 1000,
  now = () => Date.now(),
}) {
  const countBefore = await readProductsCount(graphql);
  log("info", "Catalog count before export", countBefore);

  const started = await graphql(BULK_RUN_QUERY, { query: CATALOG_BULK_QUERY });
  const startPayload = started?.bulkOperationRunQuery;
  if (!startPayload || startPayload.userErrors?.length || !startPayload.bulkOperation?.id) {
    throw new IncompleteReadError(
      "CATALOG_EXPORT_NOT_STARTED",
      "The catalog bulk export could not be started.",
      { userErrors: startPayload?.userErrors ?? null },
    );
  }
  const operationId = startPayload.bulkOperation.id;
  log("info", "Catalog bulk export started", { operationId });

  const deadline = now() + timeoutMs;
  let operation;
  for (;;) {
    const data = await graphql(BULK_OPERATION_STATUS, { id: operationId });
    operation = data?.bulkOperation;
    if (!operation) {
      throw new IncompleteReadError("CATALOG_EXPORT_MISSING", "The bulk operation could not be found.", {
        operationId,
      });
    }
    if (!PENDING_STATUSES.has(operation.status)) break;
    if (now() > deadline) {
      throw new IncompleteReadError("CATALOG_EXPORT_TIMEOUT", "The catalog bulk export did not finish in time.", {
        operationId,
        status: operation.status,
        objectCount: operation.objectCount,
      });
    }
    await sleep(pollIntervalMs);
  }

  if (operation.status !== "COMPLETED" || operation.errorCode || operation.partialDataUrl) {
    throw new IncompleteReadError(
      "CATALOG_EXPORT_FAILED",
      `The catalog bulk export ended with status ${operation.status}${
        operation.errorCode ? ` (${operation.errorCode})` : ""
      }; partial data is never used.`,
      { operationId, status: operation.status, errorCode: operation.errorCode, hasPartialData: Boolean(operation.partialDataUrl) },
    );
  }

  const rootObjectCount = Number(operation.rootObjectCount);
  const objectCount = Number(operation.objectCount);
  const products = [];
  const seen = new Set();
  let linesParsed = 0;

  if (operation.url) {
    const response = await fetchImpl(operation.url);
    if (!response.ok) {
      throw new IncompleteReadError(
        "CATALOG_DOWNLOAD_FAILED",
        `Downloading the catalog export failed with HTTP ${response.status}.`,
        { operationId },
      );
    }
    const text = await response.text();
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line) continue;
      linesParsed += 1;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        throw new IncompleteReadError("CATALOG_LINE_INVALID", `Catalog export line ${index + 1} is not valid JSON.`);
      }
      const product = toEngineProduct(row, index + 1);
      if (seen.has(product.id)) {
        throw new IncompleteReadError("CATALOG_DUPLICATE", `Product ${product.id} appears twice in the export.`);
      }
      seen.add(product.id);
      products.push(product);
    }
  } else if (rootObjectCount !== 0 || objectCount !== 0) {
    throw new IncompleteReadError("CATALOG_URL_MISSING", "The export reported objects but returned no file.", {
      rootObjectCount,
      objectCount,
    });
  }

  const countAfter = await readProductsCount(graphql);
  log("info", "Catalog count after export", countAfter);

  const completeness = {
    operationId,
    status: operation.status,
    fileSize: operation.fileSize === null || operation.fileSize === undefined ? null : Number(operation.fileSize),
    linesParsed,
    productsRead: products.length,
    rootObjectCount,
    objectCount,
    productsCountBefore: countBefore,
    productsCountAfter: countAfter,
    statusFilter: ALL_STATUSES_QUERY,
  };

  const mismatches = [];
  if (products.length !== rootObjectCount) mismatches.push("products read != rootObjectCount");
  if (products.length !== objectCount) mismatches.push("products read != objectCount");
  if (countBefore !== countAfter) mismatches.push("productsCount changed during the export");
  if (products.length !== countAfter) mismatches.push("products read != productsCount");
  if (mismatches.length) {
    throw new IncompleteReadError(
      "CATALOG_COUNT_MISMATCH",
      `Catalog completeness check failed: ${mismatches.join(", ")}.`,
      completeness,
    );
  }

  return { products, completeness };
}

export async function readProductsCount(graphql) {
  const data = await graphql(PRODUCTS_COUNT, { query: ALL_STATUSES_QUERY });
  const result = data?.productsCount;
  if (!result || typeof result.count !== "number") {
    throw new IncompleteReadError("PRODUCTS_COUNT_MISSING", "productsCount returned no value.");
  }
  if (result.precision !== "EXACT") {
    throw new IncompleteReadError(
      "PRODUCTS_COUNT_NOT_EXACT",
      `productsCount precision is ${result.precision}; an exact count is required.`,
      result,
    );
  }
  return result.count;
}

export function toEngineProduct(row, lineNumber = null) {
  const where = lineNumber ? ` (line ${lineNumber})` : "";
  if (row?.__parentId) {
    throw new IncompleteReadError("CATALOG_UNEXPECTED_CHILD", `Unexpected nested object in the export${where}.`);
  }
  const legacyId = row?.legacyResourceId ? String(row.legacyResourceId) : legacyIdFromGid(row?.id);
  const status = String(row?.status ?? "").toUpperCase();
  if (
    typeof row?.id !== "string" ||
    !row.id.startsWith("gid://shopify/Product/") ||
    !/^\d+$/.test(legacyId ?? "") ||
    typeof row.title !== "string" ||
    !VALID_STATUSES.has(status) ||
    !Array.isArray(row.tags)
  ) {
    throw new IncompleteReadError("CATALOG_PRODUCT_INVALID", `A product in the export is missing required fields${where}.`, {
      row,
    });
  }
  return {
    id: row.id,
    legacyId,
    title: row.title,
    status,
    productType: typeof row.productType === "string" ? row.productType : "",
    tags: row.tags.map(String),
  };
}
