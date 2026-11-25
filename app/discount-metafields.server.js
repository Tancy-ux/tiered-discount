// Discount metafields the discount Function reads (namespace tiered_discount):
//
//  - customer_id: for customer-specific codes, the allowed customers' GIDs,
//    comma-separated. The Function only applies the discount when one of them
//    is signed in. (The discount's own customer eligibility alone wasn't
//    enough: Shopify review saw it apply when logged out.)
//  - tiers: optional tiers for this one code ({"tiers":[...]}, same shape as
//    the shop config). Codes without it use the shop's default tiers.

export const NAMESPACE = "tiered_discount";
const LOCK_KEY = "customer_id";
const TIERS_KEY = "tiers";

/** Metafield input for discountCodeAppCreate when a code has a customer. */
export function customerLockMetafields(customerId) {
  return customerId
    ? [{ namespace: NAMESPACE, key: LOCK_KEY, type: "single_line_text_field", value: customerId }]
    : [];
}

/** Metafield input for discountCodeAppCreate when new codes get custom tiers. */
export function codeTiersMetafields(tiers) {
  return tiers
    ? [{ namespace: NAMESPACE, key: TIERS_KEY, type: "json", value: JSON.stringify({ tiers }) }]
    : [];
}

async function setDiscountMetafield(admin, discountNodeId, key, type, value) {
  const response = await admin.graphql(
    `#graphql
      mutation SetDiscountMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { message }
        }
      }`,
    {
      variables: {
        metafields: [{ ownerId: discountNodeId, namespace: NAMESPACE, key, type, value }],
      },
    },
  );
  const { data } = await response.json();
  return (data?.metafieldsSet?.userErrors ?? []).map((e) => e.message);
}

async function deleteDiscountMetafield(admin, discountNodeId, key) {
  const response = await admin.graphql(
    `#graphql
      mutation DeleteDiscountMetafield($metafields: [MetafieldIdentifierInput!]!) {
        metafieldsDelete(metafields: $metafields) {
          userErrors { message }
        }
      }`,
    { variables: { metafields: [{ ownerId: discountNodeId, namespace: NAMESPACE, key }] } },
  );
  const { data } = await response.json();
  return (data?.metafieldsDelete?.userErrors ?? []).map((e) => e.message);
}

/**
 * Sets the lock to the given customer GIDs, or clears it when there are none.
 * @param {string | string[]} customerIds
 * @returns {Promise<string[]>} error messages, empty on success
 */
export function setCustomerLock(admin, discountNodeId, customerIds) {
  const ids = (Array.isArray(customerIds) ? customerIds : [customerIds]).filter(Boolean);
  return ids.length > 0
    ? setDiscountMetafield(admin, discountNodeId, LOCK_KEY, "single_line_text_field", ids.join(","))
    : deleteDiscountMetafield(admin, discountNodeId, LOCK_KEY);
}

/** Gives one code its own tiers. */
export function setCodeTiers(admin, discountNodeId, tiers) {
  return setDiscountMetafield(admin, discountNodeId, TIERS_KEY, "json", JSON.stringify({ tiers }));
}

/** Puts one code back on the shop's default tiers. */
export function clearCodeTiers(admin, discountNodeId) {
  return deleteDiscountMetafield(admin, discountNodeId, TIERS_KEY);
}

/**
 * Checks tiers sent from the form.
 * @returns {{ tiers?: {minSubtotal:number, percentage:number}[], error?: string }}
 */
export function cleanTiers(raw) {
  let list;
  try {
    list = JSON.parse(raw ?? "[]");
  } catch {
    return { error: "Couldn't read the tier values." };
  }
  if (!Array.isArray(list) || list.length === 0) {
    return { error: "Add at least one tier." };
  }
  const tiers = list.map((t) => ({
    minSubtotal: Number(t?.minSubtotal),
    percentage: Number(t?.percentage),
  }));
  if (tiers.some((t) => !Number.isFinite(t.minSubtotal) || t.minSubtotal < 0)) {
    return { error: "Each cart subtotal must be 0 or more." };
  }
  if (tiers.some((t) => !Number.isFinite(t.percentage) || t.percentage < 0 || t.percentage > 100)) {
    return { error: "Each discount must be between 0 and 100%." };
  }
  tiers.sort((a, b) => a.minSubtotal - b.minSubtotal);
  return { tiers };
}

/** Ends a code now. Returns true when Shopify accepted it. */
async function expireCode(admin, discountNodeId) {
  const legacyId = discountNodeId.split("/").pop();
  const response = await admin.graphql(
    `#graphql
      mutation ExpireCode($id: ID!, $discount: DiscountCodeAppInput!) {
        discountCodeAppUpdate(id: $id, codeAppDiscount: $discount) {
          userErrors { message }
        }
      }`,
    {
      variables: {
        id: `gid://shopify/DiscountCodeApp/${legacyId}`,
        discount: { endsAt: new Date().toISOString() },
      },
    },
  );
  const { data } = await response.json();
  return Boolean(data?.discountCodeAppUpdate) &&
    (data.discountCodeAppUpdate.userErrors ?? []).length === 0;
}

/**
 * Privacy (customers/redact): takes one customer's ID out of every code lock
 * on the store. A code that was only for that customer is expired first (it
 * has no one left to use it, and dropping its lock must never turn a private
 * code into one anyone can use), then its lock is removed.
 * @returns {Promise<number>} how many codes were changed
 */
export async function removeCustomerFromLocks(admin, customerGid) {
  let changed = 0;
  let after = null;
  for (let page = 0; page < 10; page++) {
    const response = await admin.graphql(
      `#graphql
        query LocksForRedact($after: String) {
          discountNodes(first: 100, after: $after, query: "method:code type:app") {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              lock: metafield(namespace: "tiered_discount", key: "customer_id") { value }
            }
          }
        }`,
      { variables: { after } },
    );
    const { data } = await response.json();
    const conn = data?.discountNodes;
    if (!conn) break;

    for (const node of conn.nodes) {
      const ids = (node.lock?.value ?? "").split(",").map((id) => id.trim()).filter(Boolean);
      if (!ids.includes(customerGid)) continue;
      const remaining = ids.filter((id) => id !== customerGid);
      if (remaining.length === 0) {
        const expired = await expireCode(admin, node.id);
        // Keep the lock (still unmatchable once the customer is gone) if the
        // code couldn't be expired, rather than opening it to everyone.
        if (!expired) continue;
      }
      await setCustomerLock(admin, node.id, remaining);
      changed++;
    }

    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return changed;
}

// metafieldsSet takes at most 25 metafields per call.
const BATCH = 25;

/**
 * Gives every code made by THIS app a lock matching the code's customer
 * eligibility, so codes created before the lock existed are protected too.
 * Never removes a lock. Other apps' discounts on the store are never touched.
 * Only writes what differs, in batches, so after the first run it's a single read.
 */
export async function syncCustomerLocks(admin) {
  const toSet = [];
  let appId = null;
  let after = null;

  for (let page = 0; page < 10; page++) {
    const response = await admin.graphql(
      `#graphql
        query CodesForLockSync($after: String) {
          currentAppInstallation { app { id } }
          discountNodes(first: 100, after: $after, query: "method:code type:app") {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              lock: metafield(namespace: "tiered_discount", key: "customer_id") { value }
              discount {
                __typename
                ... on DiscountCodeApp {
                  appDiscountType { app { id } }
                  context {
                    ... on DiscountCustomers { customers { id } }
                  }
                }
              }
            }
          }
        }`,
      { variables: { after } },
    );
    const { data } = await response.json();
    const conn = data?.discountNodes;
    appId = appId ?? data?.currentAppInstallation?.app?.id;
    if (!conn || !appId) return;

    for (const node of conn.nodes) {
      const discount = node.discount;
      if (discount?.__typename !== "DiscountCodeApp") continue;
      if (discount.appDiscountType?.app?.id !== appId) continue;
      const ids = (discount.context?.customers ?? []).map((c) => c.id);
      const wanted = ids.join(",");
      const current = node.lock?.value ?? "";
      // Only add or update locks, never clear one: a merchant removing the
      // customer clears it directly from the code page, while a code whose
      // customer list was emptied some other way (e.g. the customer was
      // deleted) must not silently become usable by anyone.
      if (!wanted || wanted === current) continue;
      toSet.push({
        ownerId: node.id,
        namespace: NAMESPACE,
        key: LOCK_KEY,
        type: "single_line_text_field",
        value: wanted,
      });
    }

    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }

  for (let i = 0; i < toSet.length; i += BATCH) {
    await admin.graphql(
      `#graphql
        mutation SyncLocksSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) { userErrors { message } }
        }`,
      { variables: { metafields: toSet.slice(i, i + BATCH) } },
    );
  }
}
