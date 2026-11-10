/**
 * Raised when any catalog or sales read is incomplete or untrustworthy.
 * A run that hits this error must not produce previews or tag changes.
 */
export class IncompleteReadError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "IncompleteReadError";
    this.code = code;
    this.details = details;
  }
}

/** Raised by the GraphQL wrapper for errors that survived retries. */
export class ShopifyApiError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ShopifyApiError";
    this.code = code;
    this.details = details;
  }
}

/** Raised when the configuration or inputs violate an invariant. */
export class ConfigurationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ConfigurationError";
    this.code = code;
    this.details = details;
  }
}

export function serializeError(error) {
  if (!error) return null;
  return {
    name: error.name || "Error",
    code: error.code || "UNEXPECTED",
    message: error.message || String(error),
    details: error.details ?? null,
  };
}
