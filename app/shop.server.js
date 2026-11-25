// Shop-level settings the admin pages share: the shop's currency and its
// default tiers (shop metafield tiered_discount.config).

import { DEFAULT_TIERS, readTiers } from "./tiers";

/** First word of the shop name as a code prefix: "Ware Innovations" → "WARE-". */
function codePrefixFor(shopName) {
  const word = (shopName ?? "").trim().split(/\s+/)[0] ?? "";
  const cleaned = word.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 12);
  return cleaned ? `${cleaned}-` : "";
}

export async function loadShop(admin) {
  const response = await admin.graphql(
    `#graphql
      query ShopSettings {
        shop {
          id
          name
          currencyCode
          config: metafield(namespace: "tiered_discount", key: "config") {
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
    codePrefix: codePrefixFor(data.shop.name),
    defaultTiers: savedTiers ?? DEFAULT_TIERS,
    hasSavedTiers: savedTiers != null,
  };
}

/**
 * Saves the shop's default tiers (already checked with cleanTiers).
 * @returns {Promise<string[]>} error messages, empty on success
 */
export async function saveDefaultTiers(admin, shopId, tiers) {
  const response = await admin.graphql(
    `#graphql
      mutation SetTierConfig($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors {
            message
          }
        }
      }`,
    {
      variables: {
        metafields: [
          {
            ownerId: shopId,
            namespace: "tiered_discount",
            key: "config",
            type: "json",
            value: JSON.stringify({ tiers }),
          },
        ],
      },
    },
  );
  const { data } = await response.json();
  return (data?.metafieldsSet?.userErrors ?? []).map((e) => e.message);
}
