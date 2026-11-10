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
 * Tag updates: the in-app "Store updates" switch + env flag + shop allow-list
 * + write_products granted + complete run. storeUpdates must be exactly true,
 * so a missing value never changes the store.
 */
export function applyGuard({ settings, shop, grantedScopes, runSucceeded, storeUpdates }) {
  const reasons = [];
  if (storeUpdates !== true) reasons.push(STORE_UPDATES_OFF);
  if (!settings.applyEnabled) reasons.push("BESTSELLER_APPLY_ENABLED is not true");
  if (!settings.applyAllowedShops.includes(shop)) reasons.push(`${shop} is not in BESTSELLER_APPLY_ALLOWED_SHOPS`);
  if (!hasScope(grantedScopes, "write_products")) reasons.push("write_products has not been granted to the app");
  if (!runSucceeded) reasons.push("the run did not complete with full data");
  return { allowed: reasons.length === 0, reasons };
}
