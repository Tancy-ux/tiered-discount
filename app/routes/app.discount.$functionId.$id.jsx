import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, redirect } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { CustomerPicker } from "../components/CustomerPicker";
import { TierEditor, hasBadTiers } from "../components/TierEditor";
import {
  CombineOptions,
  combinesFormFields,
  combinesWithInput,
  readCombines,
  sameCombines,
} from "../components/CombineOptions";
import {
  DEFAULT_TIERS,
  confirmLargeDiscount,
  readTiers,
  statusBadge,
  tiersForSubmit,
} from "../tiers";
import {
  cleanTiers,
  clearCodeTiers,
  setCodeTiers,
  setCustomerLock,
} from "../discount-metafields.server";
import { isoToShopDate, shopDateToIso } from "../dates";

async function loadShopTimeZone(admin) {
  const response = await admin.graphql(
    `#graphql
      query ShopTimeZone {
        shop {
          ianaTimezone
        }
      }`,
  );
  const { data } = await response.json();
  return data?.shop?.ianaTimezone ?? "UTC";
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
          ianaTimezone
          currencyCode
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
    combines: {
      order: discount.combinesWith.orderDiscounts,
      product: discount.combinesWith.productDiscounts,
      shipping: discount.combinesWith.shippingDiscounts,
    },
    // Dates as the merchant sees them, in the shop's time zone.
    startsAt: isoToShopDate(discount.startsAt, data.shop.ianaTimezone),
    endsAt: isoToShopDate(discount.endsAt, data.shop.ianaTimezone),
    usageLimit: discount.usageLimit,
    appliesOncePerCustomer: discount.appliesOncePerCustomer,
    customer,
    defaultTiers,
    currencyCode: data.shop.currencyCode,
    customTiers,
    notes: data.discountNode.notesMetafield?.value ?? "",
  };
};

export const action = async ({ params, request }) => {
  const { admin } = await authenticate.admin(request);
  const { id } = params;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "pause" || intent === "resume") {
    // Pausing ends the code now (Shopify keeps it); resuming makes it
    // usable again with no end date.
    const field = intent === "pause" ? "discountCodeDeactivate" : "discountCodeActivate";
    const response = await admin.graphql(
      intent === "pause"
        ? `#graphql
          mutation PauseCode($id: ID!) {
            discountCodeDeactivate(id: $id) {
              userErrors {
                message
              }
            }
          }`
        : `#graphql
          mutation ResumeCode($id: ID!) {
            discountCodeActivate(id: $id) {
              userErrors {
                message
              }
            }
          }`,
      { variables: { id: `gid://shopify/DiscountCodeNode/${id}` } },
    );
    const { data } = await response.json();
    const userErrors = data?.[field]?.userErrors ?? [];
    return userErrors.length > 0 || !data?.[field]
      ? {
          ok: false,
          intent,
          error:
            userErrors.map((e) => e.message).join(" ") ||
            "Shopify didn't accept the change.",
        }
      : { ok: true, intent };
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
  const combines = readCombines(formData);
  // Dates are only sent when the merchant changed them, so saving other
  // details never moves a code's existing start or end time.
  const startsAt = formData.has("startsAt")
    ? (formData.get("startsAt")?.toString() ?? "")
    : null;
  const endsAt = formData.has("endsAt")
    ? (formData.get("endsAt")?.toString() ?? "")
    : null;
  const usageLimitRaw = formData.get("usageLimit")?.toString().trim() ?? "";
  const appliesOncePerCustomer =
    formData.get("appliesOncePerCustomer") === "true";
  const notes = formData.get("notes")?.toString() ?? "";
  const useCustomTiers = formData.get("useCustomTiers") === "true";
  const hadCustomTiers = formData.get("hadCustomTiers") === "true";

  if (!code) {
    return {
      ok: false,
      intent: "updateDiscount",
      error: "Enter a code.",
    };
  }

  // Check the tiers before changing anything, so a bad tier never leaves
  // the code half saved.
  let customTiers = null;
  if (useCustomTiers) {
    const { tiers, error } = cleanTiers(formData.get("tiers")?.toString());
    if (error) return { ok: false, intent: "updateDiscount", error };
    customTiers = tiers;
  }

  const timeZone =
    startsAt || endsAt ? await loadShopTimeZone(admin) : "UTC";
  const dates = {};
  if (startsAt) dates.startsAt = shopDateToIso(startsAt, timeZone);
  if (endsAt !== null) {
    dates.endsAt = endsAt ? shopDateToIso(endsAt, timeZone, true) : null;
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
          combinesWith: combinesWithInput(combines),
          ...dates,
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

  // This code's own tiers, or back to the shop's default tiers.
  const tierErrors = customTiers
    ? await setCodeTiers(admin, `gid://shopify/DiscountNode/${id}`, customTiers)
    : hadCustomTiers
      ? await clearCodeTiers(admin, `gid://shopify/DiscountNode/${id}`)
      : [];
  if (tierErrors.length > 0) {
    return {
      ok: false,
      intent: "updateDiscount",
      error: tierErrors.join(" "),
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
  const deleteFetcher = useFetcher();
  const statusFetcher = useFetcher();

  const [customer, setCustomer] = useState(
    loaderData.notFound ? null : loaderData.customer,
  );
  const [code, setCode] = useState(loaderData.notFound ? "" : loaderData.code);
  const [combines, setCombines] = useState(
    loaderData.notFound ? null : loaderData.combines,
  );
  const [startsAt, setStartsAt] = useState(
    loaderData.notFound ? "" : loaderData.startsAt,
  );
  const [endsAt, setEndsAt] = useState(
    loaderData.notFound ? "" : loaderData.endsAt,
  );
  const [usageLimit, setUsageLimit] = useState(
    loaderData.notFound ? "" : (loaderData.usageLimit ?? ""),
  );
  const [appliesOncePerCustomer, setAppliesOncePerCustomer] = useState(
    loaderData.notFound ? false : loaderData.appliesOncePerCustomer,
  );
  // Codes follow the shop's default tiers unless given their own.
  const hasSavedCustomTiers =
    !loaderData.notFound && loaderData.customTiers != null;
  const [useCustomTiers, setUseCustomTiers] = useState(hasSavedCustomTiers);
  const [customTiersDraft, setCustomTiersDraft] = useState(
    loaderData.notFound
      ? []
      : (loaderData.customTiers ?? loaderData.defaultTiers),
  );

  // After a save the server returns the tiers sorted by subtotal; show that
  // saved version so the form doesn't look unsaved.
  const savedCustomKey = loaderData.notFound
    ? ""
    : JSON.stringify(loaderData.customTiers);
  useEffect(() => {
    const saved = savedCustomKey ? JSON.parse(savedCustomKey) : null;
    if (saved) setCustomTiersDraft(saved);
  }, [savedCustomKey]);

  const [notes, setNotes] = useState(loaderData.notFound ? "" : loaderData.notes);

  const isSaving = detailFetcher.state !== "idle";
  const isDeleting = deleteFetcher.state !== "idle";
  const isChangingStatus = statusFetcher.state !== "idle";

  const normalizeTiers = (list) => JSON.stringify(tiersForSubmit(list));
  const isTiersDirty =
    !loaderData.notFound &&
    (useCustomTiers !== hasSavedCustomTiers ||
      (useCustomTiers &&
        normalizeTiers(customTiersDraft) !==
          normalizeTiers(loaderData.customTiers)));

  const isDirty =
    !loaderData.notFound &&
    ((customer?.id ?? null) !== (loaderData.customer?.id ?? null) ||
      code.trim() !== loaderData.code ||
      !sameCombines(combines, loaderData.combines) ||
      startsAt !== loaderData.startsAt ||
      endsAt !== loaderData.endsAt ||
      String(usageLimit) !== String(loaderData.usageLimit ?? "") ||
      appliesOncePerCustomer !== loaderData.appliesOncePerCustomer ||
      notes !== (loaderData.notes ?? "") ||
      isTiersDirty);

  const tiersInvalid =
    useCustomTiers &&
    (customTiersDraft.length === 0 || hasBadTiers(customTiersDraft));
  // Same-format date strings ("YYYY-MM-DD") compare correctly as text.
  const datesInvalid = Boolean(startsAt && endsAt && endsAt < startsAt);
  const canSave =
    Boolean(code.trim()) &&
    isDirty &&
    !isSaving &&
    !tiersInvalid &&
    !datesInvalid;

  useEffect(() => {
    if (detailFetcher.data?.ok) {
      shopify.toast.show("Discount code updated");
    }
  }, [detailFetcher.data, shopify]);

  // Pausing or resuming changes the saved dates; show them.
  const savedStartsAt = loaderData.notFound ? "" : loaderData.startsAt;
  const savedEndsAt = loaderData.notFound ? "" : loaderData.endsAt;
  useEffect(() => {
    setStartsAt(savedStartsAt);
  }, [savedStartsAt]);
  useEffect(() => {
    setEndsAt(savedEndsAt);
  }, [savedEndsAt]);

  useEffect(() => {
    if (!statusFetcher.data) return;
    if (statusFetcher.data.ok) {
      shopify.toast.show(
        statusFetcher.data.intent === "pause" ? "Code paused" : "Code resumed",
      );
    } else {
      shopify.toast.show(statusFetcher.data.error, { isError: true });
    }
  }, [statusFetcher.data, shopify]);

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

  const handleSave = () => {
    if (!canSave) return;
    if (useCustomTiers && !confirmLargeDiscount(customTiersDraft)) return;
    detailFetcher.submit(
      {
        code: code.trim(),
        customerId: customer?.id ?? "",
        previousCustomerId: loaderData.customer?.id ?? "",
        ...combinesFormFields(combines),
        ...(startsAt !== loaderData.startsAt ? { startsAt } : {}),
        ...(endsAt !== loaderData.endsAt ? { endsAt } : {}),
        usageLimit: String(usageLimit),
        appliesOncePerCustomer: String(appliesOncePerCustomer),
        notes,
        useCustomTiers: String(useCustomTiers),
        hadCustomTiers: String(hasSavedCustomTiers),
        tiers: JSON.stringify(tiersForSubmit(customTiersDraft)),
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
        {...(canSave ? {} : { disabled: true })}
        {...(isSaving ? { loading: true } : {})}
        onClick={handleSave}
      >
        Save changes
      </s-button>

      <s-button
        slot="secondary-actions"
        variant="secondary"
        {...(isChangingStatus || isDirty ? { disabled: true } : {})}
        {...(isChangingStatus ? { loading: true } : {})}
        onClick={() =>
          statusFetcher.submit(
            { intent: loaderData.status === "EXPIRED" ? "resume" : "pause" },
            { method: "post" },
          )
        }
      >
        {loaderData.status === "EXPIRED" ? "Resume code" : "Pause code"}
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
            <>
              <s-text color="subdued">
                {`These tiers apply only to ${loaderData.code}. Changing the default tiers won't affect it.`}
              </s-text>
              <TierEditor
                tiers={customTiersDraft}
                onChange={setCustomTiersDraft}
                currencyCode={loaderData.currencyCode}
              />
              {customTiersDraft.length === 0 && (
                <s-text color="subdued">Add at least one tier.</s-text>
              )}
            </>
          ) : (
            <>
              <s-text color="subdued">
                {hasSavedCustomTiers
                  ? "Save changes to remove this code's custom tiers. It will then use the default tiers:"
                  : "This code uses the default tiers, shared by every code without custom tiers:"}
              </s-text>
              <TierEditor
                tiers={loaderData.defaultTiers}
                onChange={() => {}}
                disabled
                currencyCode={loaderData.currencyCode}
              />
              <s-link href="/app/settings">
                Change default tiers in Settings
              </s-link>
            </>
          )}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Summary">
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="small-300">
            <s-text color="subdued">Status</s-text>
            <s-badge tone={statusBadge(loaderData.status).tone}>
              {statusBadge(loaderData.status).label}
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
          <CombineOptions value={combines} onChange={setCombines} />
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
            details="The code works until the end of this day."
            {...(datesInvalid
              ? { error: "End date must be on or after the start date" }
              : {})}
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
