import { ShopifyApiError } from "../errors.js";
import { operationName } from "./queries.js";

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Mutations that are safe to send again when a network error leaves the
 * outcome unknown (repeating them cannot create duplicates). Everything else
 * that is a mutation (flowTriggerReceive) is NOT
 * retried automatically on network errors; callers verify and retry instead.
 */
const RETRY_SAFE_MUTATIONS = new Set([
  "BblStartCatalogExport",
  "BblTagsAdd",
  "BblTagsRemove",
]);

export function isRetrySafe(query) {
  const match = /\b(query|mutation)\s+(\w+)/.exec(query);
  if (!match) return false;
  if (match[1] === "query") return true;
  return RETRY_SAFE_MUTATIONS.has(match[2]);
}

export function isNetworkError(error) {
  return error?.code === "NETWORK_ERROR";
}

/**
 * Wraps the template's `admin.graphql` into `graphql(query, variables) -> data`.
 *  - THROTTLED: always retried (Shopify did not execute the operation)
 *  - network errors / 5xx: retried only for retry-safe operations
 *  - everything else: ShopifyApiError, so the caller fails loudly
 */
export function createGraphqlClient(admin, { sleep = defaultSleep, maxAttempts = 6, onRetry } = {}) {
  return async function graphql(query, variables = {}) {
    const retrySafe = isRetrySafe(query);
    const name = operationName(query);
    for (let attempt = 1; ; attempt += 1) {
      try {
        const response = await admin.graphql(query, { variables });
        const body = await response.json();
        const errors = Array.isArray(body?.errors) ? body.errors : null;
        if (errors?.length) {
          const info = describeGraphqlErrors(errors);
          if (info.retryable && attempt < maxAttempts) {
            onRetry?.({ attempt, code: info.code, operation: name });
            await sleep(backoffMs(attempt));
            continue;
          }
          throw new ShopifyApiError(info.code, info.message, { errors, operation: name });
        }
        return body?.data ?? null;
      } catch (error) {
        if (error instanceof ShopifyApiError) throw error;
        const info = describeThrownError(error);
        const mayRetry = info.alwaysRetryable || (info.retryableIfSafe && retrySafe);
        if (mayRetry && attempt < maxAttempts) {
          onRetry?.({ attempt, code: info.code, operation: name });
          await sleep(info.retryAfterMs ?? backoffMs(attempt));
          continue;
        }
        const suffix =
          info.code === "NETWORK_ERROR"
            ? ` (operation ${name}, ${attempt} attempt(s)${retrySafe ? "" : ", not retried automatically because it is not safe to repeat"})`
            : "";
        throw new ShopifyApiError(info.code, `${info.message}${suffix}`, { ...info.details, operation: name, attempts: attempt });
      }
    }
  };
}

export function backoffMs(attempt) {
  return Math.min(30000, 1000 * 2 ** (attempt - 1));
}

export function describeGraphqlErrors(errors) {
  const codes = errors.map((e) => e?.extensions?.code).filter(Boolean);
  const message = errors.map((e) => e?.message).filter(Boolean).join("; ") || "GraphQL error";
  if (codes.includes("THROTTLED") || /throttled/i.test(message)) {
    return { retryable: true, code: "THROTTLED", message };
  }
  if (codes.includes("ACCESS_DENIED") || /access denied/i.test(message)) {
    return { retryable: false, code: "ACCESS_DENIED", message };
  }
  if (codes.includes("INTERNAL_SERVER_ERROR")) {
    return { retryable: true, code: "INTERNAL_SERVER_ERROR", message };
  }
  return { retryable: false, code: "GRAPHQL_ERROR", message };
}

const NETWORK_MESSAGE_RE = /fetch failed|no response available|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|other side closed/i;

function describeThrownError(error) {
  // GraphqlQueryError from @shopify/shopify-api: body.errors.graphQLErrors
  const graphQLErrors = error?.body?.errors?.graphQLErrors;
  if (Array.isArray(graphQLErrors) && graphQLErrors.length) {
    const info = describeGraphqlErrors(graphQLErrors);
    return { alwaysRetryable: info.code === "THROTTLED", retryableIfSafe: info.retryable, ...info, details: { errors: graphQLErrors } };
  }
  const name = error?.constructor?.name ?? error?.name ?? "Error";
  if (name === "HttpThrottlingError") {
    return {
      alwaysRetryable: true,
      code: "THROTTLED",
      message: error.message,
      retryAfterMs: error.retryAfter ? error.retryAfter * 1000 : undefined,
    };
  }
  if (name === "HttpRequestError" || NETWORK_MESSAGE_RE.test(error?.message ?? "")) {
    const cause = error?.cause ? ` (${error.cause.code ?? ""} ${error.cause.message ?? ""})`.replace("( ", "(") : "";
    return {
      retryableIfSafe: true,
      code: "NETWORK_ERROR",
      message: `Network error talking to Shopify, no response received: ${error?.message ?? error}${cause}`,
      details: { name },
    };
  }
  if (name === "HttpRetriableError" || name === "HttpInternalError") {
    return { retryableIfSafe: true, code: "HTTP_RETRIABLE", message: error.message };
  }
  return {
    code: name === "HttpResponseError" ? "HTTP_ERROR" : "REQUEST_FAILED",
    message: error?.message ?? String(error),
    details: { name },
  };
}
