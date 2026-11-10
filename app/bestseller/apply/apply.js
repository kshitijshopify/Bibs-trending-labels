// Tag updates. DISABLED by default: only reachable when every guard in
// jobs/guards.js passes (env flag, shop allow-list, write_products granted,
// complete run). Preview runs never import or call this module's executor.

import { buildCategoryIndex } from "../engine/categories.js";
import { bestsellerTagsOn, bulkReasons, isActive } from "../engine/products.js";
import { toEngineProduct } from "../shopify/catalog.js";
import { PRODUCT_FOR_APPLY, TAGS_ADD, TAGS_REMOVE } from "../shopify/queries.js";
import { shortKeepReason, shortRemoveReason } from "../report/views.js";

/** Planned changes from a completed run result. Review items are never planned. */
export function planTagChanges(result) {
  const plan = [];
  const item = (action, product, scope, categoryName, reason) => ({
    action,
    productId: product.id,
    legacyId: product.legacyId,
    title: product.title,
    netUnits: product.netUnits ?? null,
    scope,
    categoryName,
    reason,
  });
  for (const category of result.categories) {
    for (const product of category.wouldAdd) {
      plan.push(item("add", product, category.key, category.name, shortKeepReason(product, category)));
    }
    for (const product of category.wouldRemove) {
      plan.push(item("remove", product, category.key, category.name, shortRemoveReason(product, category)));
    }
  }
  for (const product of result.cleanup) {
    plan.push(item("remove", product, "cleanup", "Outside the categories", "Bulk product"));
  }
  return plan;
}

/**
 * Executes planned changes with a fresh read of every product first, so
 * unrelated edits made since the calculation are preserved:
 *  - tagsAdd / tagsRemove only touch the bestseller tag; never productUpdate
 *  - adds are skipped when the product is no longer eligible for its category
 *  - removes use the exact stored tag variant(s)
 *  - already-correct products are no-ops, so retries are safe
 */
export async function executeTagChanges({ graphql, plan, config, record, log = () => {} }) {
  const categoryIndex = buildCategoryIndex(config.categories);
  const summary = { applied: 0, noop: 0, skipped: 0, failed: 0 };

  for (const item of plan) {
    let before = null;
    try {
      const data = await graphql(PRODUCT_FOR_APPLY, { id: item.productId });
      if (!data?.product) {
        summary.skipped += 1;
        await record({ ...item, status: "SKIPPED", message: "product no longer exists" });
        continue;
      }
      const product = toEngineProduct(data.product);
      before = product.tags;
      const labels = bestsellerTagsOn(product, config.bestsellerTag);
      const bulk = bulkReasons(product, config.bulk).length > 0;
      const categoryKey = categoryIndex.categoryKeyFor(product.productType);

      if (item.action === "add") {
        const stillEligible = isActive(product) && !bulk && categoryKey === item.scope;
        if (!stillEligible) {
          summary.skipped += 1;
          await record({ ...item, status: "SKIPPED", tagsBefore: before, message: "no longer eligible; recalculated on the next run" });
          continue;
        }
        if (labels.length > 0) {
          summary.noop += 1;
          await record({ ...item, status: "NOOP", tagsBefore: before, tagsAfter: before, message: "already labeled" });
          continue;
        }
        const after = await mutateTags(graphql, TAGS_ADD, "tagsAdd", product.id, [config.bestsellerTag]);
        summary.applied += 1;
        await record({ ...item, status: "APPLIED", tagsBefore: before, tagsAfter: after });
        continue;
      }

      // remove
      if (labels.length === 0) {
        summary.noop += 1;
        await record({ ...item, status: "NOOP", tagsBefore: before, tagsAfter: before, message: "label already absent" });
        continue;
      }
      if (categoryKey === null && !bulk) {
        // Moved outside the mappings and not Bulk: this is a review case now.
        summary.skipped += 1;
        await record({ ...item, status: "SKIPPED", tagsBefore: before, message: "now outside the mappings and not Bulk; flagged for review instead" });
        continue;
      }
      const after = await mutateTags(graphql, TAGS_REMOVE, "tagsRemove", product.id, labels);
      summary.applied += 1;
      await record({ ...item, status: "APPLIED", tagsBefore: before, tagsAfter: after });
    } catch (error) {
      summary.failed += 1;
      log("error", "Tag change failed", { productId: item.productId, message: error.message });
      await record({ ...item, status: "FAILED", tagsBefore: before, message: error.message });
    }
  }
  return summary;
}

export async function mutateTags(graphql, mutation, field, id, tags) {
  const data = await graphql(mutation, { id, tags });
  const payload = data?.[field];
  if (payload?.userErrors?.length) {
    throw new Error(payload.userErrors.map((e) => e.message).join("; "));
  }
  return payload?.node?.tags ?? null;
}
