// Shop-level settings the admin pages share: currency, time zone, default
// tiers (shop metafield tiered_discount.config) and setup-guide progress
// (tiered_discount.onboarding).

import { DEFAULT_TIERS, readTiers } from "./tiers";

const NAMESPACE = "tiered_discount";

/** First word of the shop name as a code prefix: "Ware Innovations" → "WARE-". */
function codePrefixFor(shopName) {
  const word = (shopName ?? "").trim().split(/\s+/)[0] ?? "";
  const cleaned = word.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 12);
  return cleaned ? `${cleaned}-` : "";
}

/** Setup-guide progress: { tested: boolean, dismissed: boolean }. */
function readOnboarding(value) {
  try {
    const parsed = JSON.parse(value ?? "{}");
    return { tested: parsed.tested === true, dismissed: parsed.dismissed === true };
  } catch {
    return { tested: false, dismissed: false };
  }
}

export async function loadShop(admin) {
  const response = await admin.graphql(
    `#graphql
      query ShopSettings {
        shop {
          id
          name
          currencyCode
          ianaTimezone
          primaryDomain {
            url
          }
          config: metafield(namespace: "tiered_discount", key: "config") {
            value
          }
          onboarding: metafield(namespace: "tiered_discount", key: "onboarding") {
            value
          }
        }
      }`,
  );
  const { data } = await response.json();
  const savedTiers = readTiers(data.shop.config?.value);

  return {
    shopId: data.shop.id,
    currencyCode: data.shop.currencyCode,
    timeZone: data.shop.ianaTimezone ?? "UTC",
    storeUrl: data.shop.primaryDomain?.url ?? "",
    codePrefix: codePrefixFor(data.shop.name),
    defaultTiers: savedTiers ?? DEFAULT_TIERS,
    hasSavedTiers: savedTiers != null,
    onboarding: readOnboarding(data.shop.onboarding?.value),
  };
}

async function setShopMetafield(admin, shopId, key, type, value) {
  const response = await admin.graphql(
    `#graphql
      mutation SetShopMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors {
            message
          }
        }
      }`,
    {
      variables: {
        metafields: [{ ownerId: shopId, namespace: NAMESPACE, key, type, value }],
      },
    },
  );
  const { data } = await response.json();
  return (data?.metafieldsSet?.userErrors ?? []).map((e) => e.message);
}

/**
 * Saves the shop's default tiers (already checked with cleanTiers).
 * @returns {Promise<string[]>} error messages, empty on success
 */
export function saveDefaultTiers(admin, shopId, tiers) {
  return setShopMetafield(admin, shopId, "config", "json", JSON.stringify({ tiers }));
}

/**
 * Saves setup-guide progress.
 * @param {{ tested: boolean, dismissed: boolean }} onboarding
 * @returns {Promise<string[]>} error messages, empty on success
 */
export function saveOnboarding(admin, shopId, onboarding) {
  return setShopMetafield(admin, shopId, "onboarding", "json", JSON.stringify(onboarding));
}
