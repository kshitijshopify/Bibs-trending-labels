import { existsSync } from "node:fs";
import { APP_DEFAULT_LABEL_TAG, DEFAULT_CONFIG, validateLabelTag } from "./config.js";
import { ConfigurationError } from "./errors.js";
import { ALL_SHOPS } from "./jobs/guards.js";

/**
 * Feature flags. A variable that is NOT SET uses the live default below, so a
 * Render service only needs SCOPES, SHOPIFY_API_KEY, SHOPIFY_API_SECRET,
 * SHOPIFY_APP_URL and BESTSELLER_CRON_SECRET. A variable that is set (even to
 * an empty value) always wins, e.g. BESTSELLER_APPLY_ENABLED=false stops all
 * store changes. Store changes still need the per-store in-app switch
 * (Settings -> Store updates, off by default). See .env.example.
 *
 *   BESTSELLER_FLOW_TRIGGER_ENABLED  not set -> true  (emails need Flow workflows)
 *   BESTSELLER_APPLY_ENABLED         not set -> true  (in-app switch still off)
 *   BESTSELLER_APPLY_ALLOWED_SHOPS   not set -> *     (every installed store)
 *   BESTSELLER_CRON_SHOPS            not set -> *     (every installed store)
 */
export const LIVE_DEFAULTS = Object.freeze({
  flowTriggerEnabled: true,
  applyEnabled: true,
  applyAllowedShops: [ALL_SHOPS],
  cronShops: [ALL_SHOPS],
});

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

/** "true" -> true, anything else -> false; `fallback` only when the variable is not set. */
function flag(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return String(raw).trim().toLowerCase() === "true";
}

/** Comma-separated, lower-cased; `fallback` only when the variable is not set. */
function list(name, fallback = []) {
  const raw = process.env[name];
  if (raw === undefined) return [...fallback];
  return String(raw)
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
    flowTriggerEnabled: flag("BESTSELLER_FLOW_TRIGGER_ENABLED", LIVE_DEFAULTS.flowTriggerEnabled),
    applyEnabled: flag("BESTSELLER_APPLY_ENABLED", LIVE_DEFAULTS.applyEnabled),
    applyAllowedShops: list("BESTSELLER_APPLY_ALLOWED_SHOPS", LIVE_DEFAULTS.applyAllowedShops),
    allowTimeZoneMismatch: flag("BESTSELLER_ALLOW_TIMEZONE_MISMATCH"),
    devWindowIncludeToday: flag("BESTSELLER_DEV_WINDOW_INCLUDE_TODAY"),
    cronShops: list("BESTSELLER_CRON_SHOPS", LIVE_DEFAULTS.cronShops),
    cronSecret: String(process.env.BESTSELLER_CRON_SECRET ?? ""),
  };
}
