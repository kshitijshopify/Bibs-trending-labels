import { unauthenticated } from "../../shopify.server";
import { approvalUrlFor } from "../approval/links.server.js";
import { getSettings } from "../env.server.js";
import { getShopApprovalMode, getShopLabelSetting, getShopRunConfig } from "../settings.server.js";
import { createGraphqlClient } from "../shopify/graphql.js";
import { ALL_SHOPS, resolveScheduledShops } from "./guards.js";
import { prismaRepo } from "./repo.server.js";
import { startBestsellerRun, triggerScheduledRuns } from "./run-job.js";

function consoleLogger(entry) {
  const line = JSON.stringify({ source: "bestseller", ...entry });
  if (entry.level === "error") console.error(line);
  else if (entry.level === "warn") console.warn(line);
  else console.log(line);
}

/** Admin client + scopes for background work (offline token, refreshed by the library). */
export async function depsForShop(shop) {
  const { admin, session } = await unauthenticated.admin(shop);
  const { emailFormat, storeUpdates } = await getShopLabelSetting(shop);
  return {
    emailFormat,
    storeUpdates,
    graphql: createGraphqlClient(admin, {
      onRetry: ({ attempt, code }) => consoleLogger({ level: "warn", shop, message: "Retrying Admin API call", attempt, code }),
    }),
    grantedScopes: session.scope ?? "",
    fetchImpl: fetch,
    logger: consoleLogger,
    approvalUrl: approvalUrlFor,
  };
}

/** Starts a manual run from the admin UI. Does not wait for it to finish. */
export async function startManualRun({ shop, requestedBy, sendFlow = false, apply = false }) {
  const settings = getSettings();
  const deps = await depsForShop(shop);
  const { approvalMode } = await getShopLabelSetting(shop);
  const started = await startBestsellerRun({
    shop,
    trigger: "manual",
    requestedBy,
    options: { sendFlow, apply, approvalMode },
    deps: { ...deps, repo: prismaRepo, settings, config: await getShopRunConfig(shop) },
  });
  if (started.started) {
    started.done.catch((error) => consoleLogger({ level: "error", shop, message: "Run crashed", error: error.message }));
  }
  return { started: started.started, runId: started.runId ?? null, reason: started.reason ?? null };
}

/**
 * Entry point for the external scheduler endpoint. BESTSELLER_CRON_SHOPS=*
 * processes every shop that has the app installed (no fixed domains).
 */
export async function startScheduledRuns(now = new Date()) {
  const settings = getSettings();
  const installed = settings.cronShops.includes(ALL_SHOPS) ? await prismaRepo.installedShops() : [];
  return triggerScheduledRuns({
    shops: resolveScheduledShops(settings.cronShops, installed),
    now,
    repo: prismaRepo,
    settings,
    configForShop: getShopRunConfig,
    approvalModeForShop: getShopApprovalMode,
    makeDeps: depsForShop,
  });
}
