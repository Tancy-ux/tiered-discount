import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, redirect } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { CustomerPicker } from "../components/CustomerPicker";
import { TierEditor, hasBadTiers } from "../components/TierEditor";
import { DEFAULT_TIERS, readTiers, tiersForSubmit } from "../tiers";
import {
  cleanTiers,
  clearCodeTiers,
  setCodeTiers,
  setCustomerLock,
} from "../discount-metafields.server";

function toDateInputValue(isoString) {
  return isoString ? isoString.slice(0, 10) : "";
}

export const loader = async ({ params, request }) => {
  const { admin } = await authenticate.admin(request);
  const { id } = params;

  const response = await admin.graphql(
    `#graphql
      query GetDiscount($id: ID!) {
        discountNode(id: $id) {
          id
          notesMetafield: metafield(namespace: "tiered_discount", key: "notes") {
            value
          }
          codeTiersMetafield: metafield(namespace: "tiered_discount", key: "tiers") {
            value
          }
          discount {
            __typename
            ... on DiscountCodeApp {
              appDiscountType {
                app {
                  id
                }
              }
              title
              status
              combinesWith {
                orderDiscounts
                productDiscounts
                shippingDiscounts
              }
              startsAt
              endsAt
              usageLimit
              appliesOncePerCustomer
              codes(first: 1) {
                nodes {
                  code
                }
              }
              context {
                ... on DiscountCustomers {
                  customers {
                    id
                    displayName
                    defaultEmailAddress {
                      emailAddress
                    }
                  }
                }
              }
            }
          }
        }
        currentAppInstallation {
          app {
            id
          }
        }
        shop {
          id
          metafield(namespace: "tiered_discount", key: "config") {
            id
            value
          }
        }
      }`,
    { variables: { id: `gid://shopify/DiscountNode/${id}` } },
  );
  const { data } = await response.json();

  const discount = data.discountNode?.discount;
  // Only this app's codes; another app's discount must never be edited here.
  if (
    !discount ||
    discount.__typename !== "DiscountCodeApp" ||
    discount.appDiscountType?.app?.id !== data.currentAppInstallation?.app?.id
  ) {
    return { notFound: true };
  }

  const rawCustomer = discount.context?.customers?.[0] ?? null;
  const customer = rawCustomer
    ? {
        id: rawCustomer.id,
        displayName: rawCustomer.displayName,
        email: rawCustomer.defaultEmailAddress?.emailAddress ?? null,
      }
    : null;

  const defaultTiers = readTiers(data.shop.metafield?.value) ?? DEFAULT_TIERS;
  // null = this code follows the default tiers
  const customTiers = readTiers(data.discountNode.codeTiersMetafield?.value);

  return {
    notFound: false,
    id,
    code: discount.codes.nodes[0]?.code ?? discount.title,
    status: discount.status,
    combinesWithShipping: discount.combinesWith.shippingDiscounts,
    startsAt: discount.startsAt,
    endsAt: discount.endsAt,
    usageLimit: discount.usageLimit,
    appliesOncePerCustomer: discount.appliesOncePerCustomer,
    customer,
    defaultTiers,
    customTiers,
    notes: data.discountNode.notesMetafield?.value ?? "",
    shopId: data.shop.id,
  };
};

export const action = async ({ params, request }) => {
  const { admin } = await authenticate.admin(request);
  const { id } = params;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "saveCodeTiers") {
    // Custom tiers for this code only; other codes are untouched.
    const { tiers, error } = cleanTiers(formData.get("tiers")?.toString());
    if (error) return { ok: false, intent, error };
    const errors = await setCodeTiers(
      admin,
      `gid://shopify/DiscountNode/${id}`,
      tiers,
    );
    return errors.length > 0
      ? { ok: false, intent, error: errors.join(" ") }
      : { ok: true, intent };
  }

  if (intent === "useDefaultTiers") {
    const errors = await clearCodeTiers(
      admin,
      `gid://shopify/DiscountNode/${id}`,
    );
    return errors.length > 0
      ? { ok: false, intent, error: errors.join(" ") }
      : { ok: true, intent };
  }

  if (intent === "updateTiers") {
    // The shop's default tiers, used by every code without custom tiers.
    const shopId = formData.get("shopId")?.toString() ?? "";
    const { tiers, error } = cleanTiers(formData.get("tiers")?.toString());
    if (error) return { ok: false, intent, error };

    const response = await admin.graphql(
      `#graphql
        mutation SetTierConfig($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields {
              id
            }
            userErrors {
              field
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
    const userErrors = data?.metafieldsSet?.userErrors ?? [];
    if (userErrors.length > 0) {
      return {
        ok: false,
        intent,
        error: userErrors.map((e) => e.message).join(" "),
      };
    }
    return { ok: true, intent };
  }

  if (intent === "delete") {
    const response = await admin.graphql(
      `#graphql
        mutation DeleteDiscountCode($id: ID!) {
          discountCodeDelete(id: $id) {
            deletedCodeDiscountId
            userErrors {
              field
              message
            }
          }
        }`,
      { variables: { id: `gid://shopify/DiscountCodeApp/${id}` } },
    );
    const { data } = await response.json();
    const userErrors = data?.discountCodeDelete?.userErrors ?? [];
    if (userErrors.length > 0) {
      return {
        ok: false,
        intent,
        error: userErrors.map((e) => e.message).join(" "),
      };
    }
    return redirect("/app/discounts");
  }

  const code = formData.get("code")?.toString().trim() ?? "";
  const customerId = formData.get("customerId")?.toString().trim() ?? "";
  const previousCustomerId =
    formData.get("previousCustomerId")?.toString().trim() ?? "";
  const combinesWithShipping = formData.get("combinesWithShipping") === "true";
  const startsAt = formData.get("startsAt")?.toString() ?? "";
  const endsAt = formData.get("endsAt")?.toString() ?? "";
  const usageLimitRaw = formData.get("usageLimit")?.toString().trim() ?? "";
  const appliesOncePerCustomer =
    formData.get("appliesOncePerCustomer") === "true";
  const notes = formData.get("notes")?.toString() ?? "";

  if (!code) {
    return {
      ok: false,
      intent: "updateDiscount",
      error: "Enter a code.",
    };
  }

  let context;
  if (customerId) {
    const customers = { add: [customerId] };
    if (previousCustomerId && previousCustomerId !== customerId) {
      customers.remove = [previousCustomerId];
    }
    context = { customers };
  } else if (previousCustomerId) {
    // Removing the only customer would leave an empty customer list, which
    // Shopify rejects. Open the code to all buyers instead.
    context = { all: "ALL" };
  }

  const response = await admin.graphql(
    `#graphql
      mutation UpdateCustomerCode($id: ID!, $discount: DiscountCodeAppInput!) {
        discountCodeAppUpdate(id: $id, codeAppDiscount: $discount) {
          codeAppDiscount {
            title
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        id: `gid://shopify/DiscountCodeApp/${id}`,
        discount: {
          title: code,
          code,
          combinesWith: {
            orderDiscounts: false,
            productDiscounts: false,
            shippingDiscounts: combinesWithShipping,
          },
          startsAt: startsAt ? `${startsAt}T00:00:00Z` : undefined,
          endsAt: endsAt ? `${endsAt}T00:00:00Z` : null,
          usageLimit: usageLimitRaw ? Number(usageLimitRaw) : null,
          appliesOncePerCustomer,
          ...(context ? { context } : {}),
        },
      },
    },
  );
  const { data } = await response.json();
  const userErrors = data?.discountCodeAppUpdate?.userErrors ?? [];

  if (userErrors.length > 0) {
    return {
      ok: false,
      intent: "updateDiscount",
      error: userErrors.map((e) => e.message).join(" "),
    };
  }

  // Keep the Function's customer lock in step with the chosen customer.
  const lockErrors = await setCustomerLock(
    admin,
    `gid://shopify/DiscountNode/${id}`,
    customerId,
  );
  if (lockErrors.length > 0) {
    return {
      ok: false,
      intent: "updateDiscount",
      error: lockErrors.join(" "),
    };
  }

  const notesResponse = await admin.graphql(
    `#graphql
      mutation SetDiscountNotes($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        metafields: [
          {
            ownerId: `gid://shopify/DiscountNode/${id}`,
            namespace: "tiered_discount",
            key: "notes",
            type: "multi_line_text_field",
            value: notes,
          },
        ],
      },
    },
  );
  const notesData = await notesResponse.json();
  const notesErrors = notesData?.data?.metafieldsSet?.userErrors ?? [];

  if (notesErrors.length > 0) {
    return {
      ok: false,
      intent: "updateDiscount",
      error: notesErrors.map((e) => e.message).join(" "),
    };
  }

  return { ok: true, intent: "updateDiscount" };
};

export default function DiscountDetail() {
  const loaderData = useLoaderData();
  const shopify = useAppBridge();
  const detailFetcher = useFetcher();
  const tiersFetcher = useFetcher();
  const deleteFetcher = useFetcher();

  const [customer, setCustomer] = useState(
    loaderData.notFound ? null : loaderData.customer,
  );
  const [code, setCode] = useState(loaderData.notFound ? "" : loaderData.code);
  const [combinesWithShipping, setCombinesWithShipping] = useState(
    loaderData.notFound ? true : loaderData.combinesWithShipping,
  );
  const [startsAt, setStartsAt] = useState(
    loaderData.notFound ? "" : toDateInputValue(loaderData.startsAt),
  );
  const [endsAt, setEndsAt] = useState(
    loaderData.notFound ? "" : toDateInputValue(loaderData.endsAt),
  );
  const [usageLimit, setUsageLimit] = useState(
    loaderData.notFound ? "" : (loaderData.usageLimit ?? ""),
  );
  const [appliesOncePerCustomer, setAppliesOncePerCustomer] = useState(
    loaderData.notFound ? false : loaderData.appliesOncePerCustomer,
  );
  // Codes follow the shop's default tiers unless given their own.
  const [useCustomTiers, setUseCustomTiers] = useState(
    !loaderData.notFound && loaderData.customTiers != null,
  );
  const [defaultTiersDraft, setDefaultTiersDraft] = useState(
    loaderData.notFound ? [] : loaderData.defaultTiers,
  );
  const [customTiersDraft, setCustomTiersDraft] = useState(
    loaderData.notFound
      ? []
      : (loaderData.customTiers ?? loaderData.defaultTiers),
  );
  const tiers = useCustomTiers ? customTiersDraft : defaultTiersDraft;
  const setTiers = useCustomTiers ? setCustomTiersDraft : setDefaultTiersDraft;

  // After a save the server returns the tiers sorted by subtotal; show that
  // saved version so the form doesn't look unsaved. Keyed on the values (not
  // the loaderData object) so saving other details doesn't wipe tier edits.
  const savedDefaultKey = loaderData.notFound ? "" : JSON.stringify(loaderData.defaultTiers);
  const savedCustomKey = loaderData.notFound ? "" : JSON.stringify(loaderData.customTiers);
  useEffect(() => {
    if (savedDefaultKey) setDefaultTiersDraft(JSON.parse(savedDefaultKey));
  }, [savedDefaultKey]);
  useEffect(() => {
    const saved = savedCustomKey ? JSON.parse(savedCustomKey) : null;
    if (saved) setCustomTiersDraft(saved);
  }, [savedCustomKey]);

  const [notes, setNotes] = useState(loaderData.notFound ? "" : loaderData.notes);

  const isSavingDetail = detailFetcher.state !== "idle";
  const isSavingTiers = tiersFetcher.state !== "idle";
  const isDeleting = deleteFetcher.state !== "idle";

  const isDetailDirty =
    !loaderData.notFound &&
    ((customer?.id ?? null) !== (loaderData.customer?.id ?? null) ||
      code.trim() !== loaderData.code ||
      combinesWithShipping !== loaderData.combinesWithShipping ||
      startsAt !== toDateInputValue(loaderData.startsAt) ||
      endsAt !== toDateInputValue(loaderData.endsAt) ||
      String(usageLimit) !== String(loaderData.usageLimit ?? "") ||
      appliesOncePerCustomer !== loaderData.appliesOncePerCustomer ||
      notes !== (loaderData.notes ?? ""));

  const normalizeTiers = (list) => JSON.stringify(tiersForSubmit(list));
  const hasSavedCustomTiers = !loaderData.notFound && loaderData.customTiers != null;
  // Switching a custom code back to the defaults: save that first, then the
  // defaults can be edited (one save never does both).
  const isSwitchingToDefault = !useCustomTiers && hasSavedCustomTiers;
  const canEditTiers = useCustomTiers || !hasSavedCustomTiers;
  let isTiersDirty = false;
  if (!loaderData.notFound) {
    if (useCustomTiers) {
      isTiersDirty =
        !hasSavedCustomTiers ||
        normalizeTiers(customTiersDraft) !== normalizeTiers(loaderData.customTiers);
    } else {
      isTiersDirty =
        isSwitchingToDefault ||
        normalizeTiers(defaultTiersDraft) !== normalizeTiers(loaderData.defaultTiers);
    }
  }

  useEffect(() => {
    if (detailFetcher.data?.ok) {
      shopify.toast.show("Discount code updated");
    }
  }, [detailFetcher.data, shopify]);

  useEffect(() => {
    if (!tiersFetcher.data?.ok) return;
    const messages = {
      saveCodeTiers: "Custom tiers saved for this code",
      useDefaultTiers: "This code now uses the default tiers",
      updateTiers: "Default tiers updated",
    };
    shopify.toast.show(messages[tiersFetcher.data.intent] ?? "Tiers updated");
  }, [tiersFetcher.data, shopify]);

  useEffect(() => {
    if (deleteFetcher.data?.ok === false) {
      shopify.toast.show("Couldn't delete code", { isError: true });
    }
  }, [deleteFetcher.data, shopify]);

  if (loaderData.notFound) {
    return (
      <s-page heading="Discount not found">
        <s-link slot="breadcrumb-actions" href="/app/discounts">
          Back to discount codes
        </s-link>
        <s-section>
          <s-banner tone="warning" heading="We couldn't find this discount">
            <s-paragraph>
              It may have been deleted. Head back to the list and try again.
            </s-paragraph>
          </s-banner>
        </s-section>
      </s-page>
    );
  }

  const handleDelete = () => {
    if (isDeleting) return;
    if (!confirm(`Delete the code "${loaderData.code}"? This can't be undone.`)) {
      return;
    }
    deleteFetcher.submit({ intent: "delete" }, { method: "post" });
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      shopify.toast.show("Code copied");
    } catch {
      shopify.toast.show("Couldn't copy code", { isError: true });
    }
  };

  const handleSaveDetail = () => {
    if (!code.trim() || isSavingDetail) return;
    detailFetcher.submit(
      {
        code: code.trim(),
        customerId: customer?.id ?? "",
        previousCustomerId: loaderData.customer?.id ?? "",
        combinesWithShipping: String(combinesWithShipping),
        startsAt,
        endsAt,
        usageLimit: String(usageLimit),
        appliesOncePerCustomer: String(appliesOncePerCustomer),
        notes,
      },
      { method: "post" },
    );
  };

  const handleSaveTiers = () => {
    if (isSavingTiers || !isTiersDirty) return;
    if (canEditTiers && hasBadTiers(tiers)) return;
    if (isSwitchingToDefault) {
      tiersFetcher.submit({ intent: "useDefaultTiers" }, { method: "post" });
      return;
    }
    const cleaned = tiersForSubmit(tiers);
    tiersFetcher.submit(
      useCustomTiers
        ? { intent: "saveCodeTiers", tiers: JSON.stringify(cleaned) }
        : {
            intent: "updateTiers",
            shopId: loaderData.shopId,
            tiers: JSON.stringify(cleaned),
          },
      { method: "post" },
    );
  };

  return (
    <s-page heading={loaderData.code}>
      <s-link slot="breadcrumb-actions" href="/app/discounts">
        Back to discount codes
      </s-link>

      <s-button
        slot="primary-action"
        variant="primary"
        {...(!code.trim() || isSavingDetail || !isDetailDirty
          ? { disabled: true }
          : {})}
        {...(isSavingDetail ? { loading: true } : {})}
        onClick={handleSaveDetail}
      >
        Save changes
      </s-button>

      <s-button
        slot="secondary-actions"
        variant="secondary"
        tone="critical"
        {...(isDeleting ? { disabled: true, loading: true } : {})}
        onClick={handleDelete}
      >
        Delete
      </s-button>

      {detailFetcher.data?.ok === false && (
        <s-banner tone="critical" heading="Couldn't save changes">
          <s-paragraph>{detailFetcher.data.error}</s-paragraph>
        </s-banner>
      )}

      <s-section heading="Discount details">
        <s-stack direction="block" gap="base">
          <CustomerPicker value={customer} onChange={setCustomer} />
          <s-text-field
            label="Code"
            value={code}
            onInput={(event) =>
              setCode(event.currentTarget.value.toUpperCase())
            }
          >
            <s-button
              slot="accessory"
              variant="tertiary"
              onClick={handleCopyCode}
              accessibilityLabel="Copy code"
            >
              📋
            </s-button>
          </s-text-field>
        </s-stack>
      </s-section>

      <s-section heading="Discount tiers">
        <s-stack direction="block" gap="base">
          <s-checkbox
            label="Use custom tiers for this code"
            details="Only this code changes. Other codes keep the default tiers."
            {...(useCustomTiers ? { checked: true } : {})}
            onChange={(event) => setUseCustomTiers(event.currentTarget.checked)}
          ></s-checkbox>

          {useCustomTiers ? (
            <s-banner tone="info" heading="Custom tiers for this code only">
              <s-paragraph>
                {`These tiers apply only to ${loaderData.code}. Changing the default tiers won't affect it.`}
              </s-paragraph>
            </s-banner>
          ) : isSwitchingToDefault ? (
            <s-banner tone="info" heading="Back to the default tiers">
              <s-paragraph>
                {"Save to remove this code's custom tiers. It will then use the default tiers below."}
              </s-paragraph>
            </s-banner>
          ) : (
            <s-banner tone="warning" heading="Default tiers, shared across codes">
              <s-paragraph>
                {`Changing these updates every code that uses the default tiers. Codes with custom tiers aren't affected. To change only this code, tick "Use custom tiers for this code".`}
              </s-paragraph>
            </s-banner>
          )}
        </s-stack>

        {tiersFetcher.data?.ok === false && (
          <s-banner tone="critical" heading="Couldn't save tiers">
            <s-paragraph>{tiersFetcher.data.error}</s-paragraph>
          </s-banner>
        )}

        <s-stack direction="block" gap="base">
          <TierEditor
            tiers={tiers}
            onChange={setTiers}
            disabled={!canEditTiers}
          />

          <s-stack direction="inline" gap="base">
            <s-button
              variant="primary"
              {...(isSavingTiers ||
              !isTiersDirty ||
              (canEditTiers && hasBadTiers(tiers))
                ? { disabled: true }
                : {})}
              {...(isSavingTiers ? { loading: true } : {})}
              onClick={handleSaveTiers}
            >
              {useCustomTiers
                ? "Save custom tiers"
                : isSwitchingToDefault
                  ? "Use default tiers"
                  : "Save default tiers"}
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Summary">
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="small-300">
            <s-text color="subdued">Status</s-text>
            <s-badge tone={loaderData.status === "ACTIVE" ? "success" : "info"}>
              {loaderData.status}
            </s-badge>
          </s-stack>
          <s-stack direction="block" gap="small-300">
            <s-text color="subdued">Made for</s-text>
            <s-text type="strong">
              {customer?.displayName ?? "Anyone with the code"}
            </s-text>
            {customer?.email && <s-text color="subdued">{customer.email}</s-text>}
          </s-stack>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Rules">
        <s-stack direction="block" gap="base">
          <s-checkbox
            label="Combine with shipping discounts"
            {...(combinesWithShipping ? { checked: true } : {})}
            onChange={(event) =>
              setCombinesWithShipping(event.currentTarget.checked)
            }
          ></s-checkbox>
          <s-checkbox
            label="Limit to one use per customer"
            {...(appliesOncePerCustomer ? { checked: true } : {})}
            onChange={(event) =>
              setAppliesOncePerCustomer(event.currentTarget.checked)
            }
          ></s-checkbox>
          <s-number-field
            label="Total usage limit"
            placeholder="Unlimited"
            value={usageLimit}
            onInput={(event) => setUsageLimit(event.currentTarget.value)}
          ></s-number-field>
          <s-date-field
            label="Start date"
            value={startsAt}
            onChange={(event) => setStartsAt(event.currentTarget.value)}
          ></s-date-field>
          <s-date-field
            label="End date (optional)"
            value={endsAt}
            onChange={(event) => setEndsAt(event.currentTarget.value)}
          ></s-date-field>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Notes">
        <s-text-area
          label="Notes"
          labelAccessibilityVisibility="exclusive"
          placeholder="Anything worth remembering about this code…"
          rows={4}
          value={notes}
          onInput={(event) => setNotes(event.currentTarget.value)}
        ></s-text-area>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
