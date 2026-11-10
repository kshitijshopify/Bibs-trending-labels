import { existsSync } from "node:fs";
import { APP_DEFAULT_LABEL_TAG, DEFAULT_CONFIG, validateLabelTag } from "./config.js";
import { ConfigurationError } from "./errors.js";

/**
 * Feature flags. Everything that sends events or changes data is OFF unless
 * explicitly enabled. See .env.example for documentation.
 */

let localEnvLoaded = false;

/** In development, read .env (existing environment variables win). */
function loadLocalEnv() {
  if (localEnvLoaded) return;
  localEnvLoaded = true;
  if (process.env.NODE_ENV === "production") return;
  if (typeof process.loadEnvFile === "function" && existsSync(".env")) {
    try {
      process.loadEnvFile(".env");
    } catch {
      // A malformed .env simply leaves every flag at its safe default.
    }
  }
}

function flag(name) {
  return String(process.env[name] ?? "").trim().toLowerCase() === "true";
}

function list(name) {
  return String(process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Rules used by runs: the defaults plus the configured label tag. */
export function getRunConfig() {
  loadLocalEnv();
  const configured = String(process.env.BESTSELLER_LABEL_TAG ?? "").trim() || APP_DEFAULT_LABEL_TAG;
  const check = validateLabelTag(configured);
  if (!check.ok) {
    throw new ConfigurationError(
      "INVALID_LABEL_TAG",
      `BESTSELLER_LABEL_TAG "${configured}" ${check.problems.join(", ")}.`,
    );
  }
  return { ...DEFAULT_CONFIG, bestsellerTag: check.value };
}

export function getSettings() {
  loadLocalEnv();
  return {
    flowTriggerEnabled: flag("BESTSELLER_FLOW_TRIGGER_ENABLED"),
    applyEnabled: flag("BESTSELLER_APPLY_ENABLED"),
    applyAllowedShops: list("BESTSELLER_APPLY_ALLOWED_SHOPS"),
    allowTimeZoneMismatch: flag("BESTSELLER_ALLOW_TIMEZONE_MISMATCH"),
    devWindowIncludeToday: flag("BESTSELLER_DEV_WINDOW_INCLUDE_TODAY"),
    cronShops: list("BESTSELLER_CRON_SHOPS"),
    cronSecret: String(process.env.BESTSELLER_CRON_SECRET ?? ""),
  };
}
