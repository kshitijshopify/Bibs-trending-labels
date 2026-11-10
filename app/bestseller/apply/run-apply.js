import { DEFAULT_CONFIG } from "../config.js";
import { executeTagChanges, planTagChanges } from "./apply.js";

/**
 * Applies a COMPLETE run result to the store (re-checking every product) and
 * records each applied change in the history. Used by both the approved
 * manual apply and the automatic nightly apply.
 */
export async function applyRunResult({ graphql, result, run, shop, repo, log = () => {} }) {
  const config = { ...DEFAULT_CONFIG, ...result.config };
  const plan = planTagChanges(result);
  log("info", "Applying tag changes", { planned: plan.length, tag: config.bestsellerTag });
  const summary = await executeTagChanges({
    graphql,
    plan,
    config,
    log,
    record: async (change) => {
      await repo.recordTagChange(run.id, change);
      if (change.status !== "APPLIED") return;
      await repo.recordEvents(shop, [
        {
          kind: change.action === "add" ? "tag_added" : "tag_removed",
          tag: config.bestsellerTag,
          runId: run.id,
          localDate: run.localDate,
          productId: change.productId,
          legacyId: change.legacyId,
          title: change.title,
          category: change.categoryName,
          netUnits: change.netUnits ?? null,
          detail: change.reason ?? null,
        },
      ]);
    },
  });
  log("info", "Tag changes finished", summary);
  return { planned: plan.length, ...summary };
}

export function applyStatusText(summary) {
  if (!summary) return "Preview: approval needed";
  return `Applied: ${summary.applied} change(s) made, ${summary.noop} already correct, ${summary.skipped} skipped, ${summary.failed} failed`;
}
