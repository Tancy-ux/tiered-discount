import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { CustomerPicker } from "../components/CustomerPicker";

const DEFAULT_TIERS = [
  { minSubtotal: 0, percentage: 5 },
  { minSubtotal: 50000, percentage: 7.5 },
  { minSubtotal: 300000, percentage: 10 },
];

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
          discount {
            __typename
            ... on DiscountCodeApp {
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
  if (!discount || discount.__typename !== "DiscountCodeApp") {
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

  let tiers = DEFAULT_TIERS;
  const metafield = data.shop.metafield;
  if (metafield?.value) {
    try {
      const parsed = JSON.parse(metafield.value);
      if (Array.isArray(parsed.tiers) && parsed.tiers.length > 0) {
        tiers = parsed.tiers;
      }
    } catch {
      tiers = DEFAULT_TIERS;
    }
  }

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
    tiers,
    notes: data.discountNode.notesMetafield?.value ?? "",
    shopId: data.shop.id,
  };
};

export const action = async ({ params, request }) => {
  const { admin } = await authenticate.admin(request);
  const { id } = params;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "updateTiers") {
    const shopId = formData.get("shopId")?.toString() ?? "";
    let tiers;
    try {
      tiers = JSON.parse(formData.get("tiers")?.toString() ?? "[]");
    } catch {
      return { ok: false, intent, error: "Couldn't read the tier values." };
    }

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
    context = { customers: { remove: [previousCustomerId] } };
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
  const [tiers, setTiers] = useState(
    loaderData.notFound ? [] : loaderData.tiers,
  );
  const [notes, setNotes] = useState(loaderData.notFound ? "" : loaderData.notes);

  const isSavingDetail = detailFetcher.state !== "idle";
  const isSavingTiers = tiersFetcher.state !== "idle";

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

  const normalizeTiers = (list) =>
    JSON.stringify(
      list.map((tier) => ({
        minSubtotal: Number(tier.minSubtotal) || 0,
        percentage: Number(tier.percentage) || 0,
      })),
    );
  const isTiersDirty =
    !loaderData.notFound &&
    normalizeTiers(tiers) !== normalizeTiers(loaderData.tiers);

  useEffect(() => {
    if (detailFetcher.data?.ok) {
      shopify.toast.show("Discount code updated");
    }
  }, [detailFetcher.data, shopify]);

  useEffect(() => {
    if (tiersFetcher.data?.ok) {
      shopify.toast.show("Tiers updated");
    }
  }, [tiersFetcher.data, shopify]);

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

  const handleTierChange = (index, field, value) => {
    setTiers((current) =>
      current.map((tier, i) =>
        i === index ? { ...tier, [field]: value } : tier,
      ),
    );
  };

  const handleRemoveTier = (index) => {
    setTiers((current) => current.filter((_, i) => i !== index));
  };

  const handleAddTier = () => {
    setTiers((current) => [...current, { minSubtotal: 0, percentage: 0 }]);
  };

  const handleSaveTiers = () => {
    if (isSavingTiers) return;
    const cleaned = tiers.map((tier) => ({
      minSubtotal: Number(tier.minSubtotal) || 0,
      percentage: Number(tier.percentage) || 0,
    }));
    tiersFetcher.submit(
      {
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
        <s-banner tone="warning" heading="Shared across every code">
          <s-paragraph>
            These tiers apply to every discount code this app creates - changing
            them here updates the discount for all customers, not just this one.
          </s-paragraph>
        </s-banner>

        {tiersFetcher.data?.ok === false && (
          <s-banner tone="critical" heading="Couldn't save tiers">
            <s-paragraph>{tiersFetcher.data.error}</s-paragraph>
          </s-banner>
        )}

        <s-stack direction="block" gap="base">
          {tiers.map((tier, index) => (
            <s-stack direction="inline" gap="base" alignItems="end" key={index}>
              <s-number-field
                label="Cart subtotal at or above"
                value={String(tier.minSubtotal)}
                onInput={(event) =>
                  handleTierChange(
                    index,
                    "minSubtotal",
                    event.currentTarget.value,
                  )
                }
              ></s-number-field>
              <s-number-field
                label="Discount %"
                value={String(tier.percentage)}
                onInput={(event) =>
                  handleTierChange(
                    index,
                    "percentage",
                    event.currentTarget.value,
                  )
                }
              ></s-number-field>
              <s-button
                variant="tertiary"
                onClick={() => handleRemoveTier(index)}
              >
                Remove
              </s-button>
            </s-stack>
          ))}

          <s-stack direction="inline" gap="base">
            <s-button variant="secondary" onClick={handleAddTier}>
              Add tier
            </s-button>
            <s-button
              variant="primary"
              {...(isSavingTiers || !isTiersDirty ? { disabled: true } : {})}
              {...(isSavingTiers ? { loading: true } : {})}
              onClick={handleSaveTiers}
            >
              Save tiers
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
