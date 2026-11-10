import { IncompleteReadError } from "../errors.js";
import { SHOP_INFO } from "./queries.js";

export async function readShopInfo(graphql) {
  const data = await graphql(SHOP_INFO, {});
  const shop = data?.shop;
  if (!shop?.myshopifyDomain) {
    throw new IncompleteReadError("SHOP_INFO_MISSING", "Shop details could not be read.");
  }
  return shop;
}

/**
 * ShopifyQL interprets SINCE/UNTIL dates in the shop's time zone. The window
 * is defined in Copenhagen time, so the shop must use the same zone. On a
 * development store the mismatch can be downgraded to a warning.
 */
export function checkShopTimeZone(shop, requiredTimeZone, { allowMismatch = false } = {}) {
  if (shop.ianaTimezone === requiredTimeZone) return { ok: true, warning: null };
  const message = `Shop time zone is ${shop.ianaTimezone}, but the sales window is defined in ${requiredTimeZone}.`;
  if (allowMismatch) {
    return { ok: true, warning: `${message} Allowed for development only: day boundaries may be shifted.` };
  }
  throw new IncompleteReadError("SHOP_TIMEZONE_MISMATCH", `${message} Refusing to run.`, {
    shopTimeZone: shop.ianaTimezone,
    requiredTimeZone,
  });
}
