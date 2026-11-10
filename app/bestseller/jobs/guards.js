/**
 * Safety guard. Every product-changing path (nightly apply, Apply now, undo)
 * must pass it; each failed condition is reported so the UI can explain why.
 */

export function hasScope(grantedScopes, scope) {
  const granted = String(grantedScopes ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (granted.includes(scope)) return true;
  // write_x implies read_x
  if (scope.startsWith("read_") && granted.includes(`write_${scope.slice(5)}`)) return true;
  return false;
}

export const STORE_UPDATES_OFF = "Store updates are switched off in the app (Settings → Store updates)";

/**
 * "*" in a shop list (BESTSELLER_APPLY_ALLOWED_SHOPS, BESTSELLER_CRON_SHOPS)
 * means every shop that has installed the app, so no domain is hard-coded.
 * An empty list still means no shop.
 */
export const ALL_SHOPS = "*";

export function shopListed(list, shop) {
  if (!Array.isArray(list)) return false;
  return list.includes(ALL_SHOPS) || list.includes(String(shop ?? "").trim().toLowerCase());
}

/**
 * Shops the nightly scheduler processes: the listed shops, plus every
 * installed shop when the list contains "*". Sorted and without duplicates.
 */
export function resolveScheduledShops(list, installedShops = []) {
  const entries = Array.isArray(list) ? list : [];
  const listed = entries.filter((s) => s !== ALL_SHOPS);
  const installed = entries.includes(ALL_SHOPS)
    ? installedShops.map((s) => String(s ?? "").trim().toLowerCase()).filter(Boolean)
    : [];
  return [...new Set([...listed, ...installed])].sort();
}

/**
 * Tag updates: the in-app "Store updates" switch + env flag + shop allow-list
 * + write_products granted + complete run. storeUpdates must be exactly true,
 * so a missing value never changes the store.
 */
export function applyGuard({ settings, shop, grantedScopes, runSucceeded, storeUpdates }) {
  const reasons = [];
  if (storeUpdates !== true) reasons.push(STORE_UPDATES_OFF);
  if (!settings.applyEnabled) reasons.push("BESTSELLER_APPLY_ENABLED is not true");
  if (!shopListed(settings.applyAllowedShops, shop)) reasons.push(`${shop} is not in BESTSELLER_APPLY_ALLOWED_SHOPS (use * for every installed shop)`);
  if (!hasScope(grantedScopes, "write_products")) reasons.push("write_products has not been granted to the app");
  if (!runSucceeded) reasons.push("the run did not complete with full data");
  return { allowed: reasons.length === 0, reasons };
}
