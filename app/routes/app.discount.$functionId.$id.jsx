import { useCallback, useEffect, useState } from "react";
import { useFetcher, useLoaderData, redirect } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { CustomerPicker } from "../components/CustomerPicker";
import { ConfirmModal } from "../components/ConfirmModal";
import { hasBadTiers } from "../components/TierEditor";
import {
  combinesFormFields,
  combinesWithInput,
  readCombines,
  sameCombines,
} from "../components/CombineOptions";
import {
  DatesSection,
  MoreSettingsSection,
  TiersSection,
  datesProblems,
  usageLimitProblem,
} from "../components/DiscountSections";
import {
  DEFAULT_TIERS,
  hasLargeDiscount,
  largeDiscountText,
  describeTiers,
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
import { copyText } from "../clipboard";
import { codeFormatError, normalizeCode } from "../codes";
import { findExistingCodes } from "../code-lookup.server";
import { useCodeTaken } from "../components/useCodeTaken";

/** "2026-12-31" → "31 Dec 2026" */
function readableDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/**
 * Ready-to-send message for a customer-specific code, from the SAVED code
 * (so it never describes unsaved edits). null for codes open to anyone.
 * @returns {string[] | null} paragraphs
 */
function buildCustomerMessage(saved) {
  if (!saved.customer) return null;
  // Customers saved without a name have their email as display name.
  const firstWord = (saved.customer.displayName ?? "").trim().split(/\s+/)[0];
  const firstName = firstWord.includes("@") ? "" : firstWord;
  const tiers = saved.customTiers ?? saved.defaultTiers;
  const where = saved.storeUrl
    ? `at ${saved.storeUrl.replace(/^https?:\/\//, "")}`
    : "on our store";
  return [
    `Hi${firstName ? ` ${firstName}` : ""}, here's your personal discount code: ${saved.code}`,
    `Your discount: ${describeTiers(tiers, saved.currencyCode)}.${
      saved.endsAt ? ` Valid until ${readableDate(saved.endsAt)}.` : ""
    }`,
    `Log in to your account ${where} before you check out. The code only works when you're logged in.`,
  ];
}

/**
 * True only when this discount is a code made by THIS app. Every change
 * checks it first, so a crafted request can never edit, pause or delete a
 * discount made in Shopify admin or by another app.
 */
async function isOwnCode(admin, id) {
  const response = await admin.graphql(
    `#graphql
      query CodeOwner($id: ID!) {
        currentAppInstallation {
          app {
            id
          }
        }
        discountNode(id: $id) {
          discount {
            __typename
            ... on DiscountCodeApp {
              appDiscountType {
                app {
                  id
                }
              }
            }
          }
        }
      }`,
    { variables: { id: `gid://shopify/DiscountNode/${id}` } },
  );
  const { data } = await response.json();
  const discount = data?.discountNode?.discount;
  const appId = data?.currentAppInstallation?.app?.id;
  return Boolean(
    appId &&
    discount?.__typename === "DiscountCodeApp" &&
    discount.appDiscountType?.app?.id === appId,
  );
}

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
              asyncUsageCount
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
          primaryDomain {
            url
          }
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
    used: discount.asyncUsageCount,
    appliesOncePerCustomer: discount.appliesOncePerCustomer,
    customer,
    defaultTiers,
    currencyCode: data.shop.currencyCode,
    storeUrl: data.shop.primaryDomain?.url ?? "",
    customTiers,
    notes: data.discountNode.notesMetafield?.value ?? "",
  };
};

export const action = async ({ params, request }) => {
  const { admin } = await authenticate.admin(request);
  const { id } = params;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (!/^\d+$/.test(id ?? "") || !(await isOwnCode(admin, id))) {
    return {
      ok: false,
      intent,
      error: "This code wasn't made by this app, so it can't be changed here.",
    };
  }

  if (intent === "pause" || intent === "resume") {
    // Pausing ends the code now (Shopify keeps it); resuming makes it
    // usable again with no end date.
    const field =
      intent === "pause" ? "discountCodeDeactivate" : "discountCodeActivate";
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

  const code = normalizeCode(formData.get("code"));
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

  const formatError = codeFormatError(code);
  if (formatError) {
    return { ok: false, intent: "updateDiscount", error: `${formatError}.` };
  }
  // Renaming to a code another discount already uses (this one is ignored).
  if ((await findExistingCodes(admin, [code], id)).length > 0) {
    return {
      ok: false,
      intent: "updateDiscount",
      error:
        "A discount with this code already exists in your store. Choose another code.",
    };
  }

  const limitProblem = usageLimitProblem(usageLimitRaw);
  if (limitProblem) {
    return {
      ok: false,
      intent: "updateDiscount",
      error: `Total uses: ${limitProblem}.`,
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

  const timeZone = startsAt || endsAt ? await loadShopTimeZone(admin) : "UTC";
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

  const [notes, setNotes] = useState(
    loaderData.notFound ? "" : loaderData.notes,
  );
  // The customer message starts folded away.
  const [messageOpen, setMessageOpen] = useState(false);
  const [confirmingLarge, setConfirmingLarge] = useState(false);
  const closeLargeConfirm = useCallback(() => setConfirmingLarge(false), []);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const closeDeleteConfirm = useCallback(() => setConfirmingDelete(false), []);

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
  // Code name: format, and (only when renamed) whether it's already taken.
  const normalizedCode = normalizeCode(code);
  const codeChanged =
    !loaderData.notFound && normalizedCode !== loaderData.code;
  const { taken: codeTaken } = useCodeTaken(code, {
    ignoreId: loaderData.notFound ? undefined : loaderData.id,
    skip: !codeChanged,
  });
  const codeError = !normalizedCode
    ? "Enter a code"
    : (codeFormatError(normalizedCode) ??
      (codeTaken
        ? "A discount with this code already exists in your store"
        : null));

  const dateProblems = datesProblems(startsAt, endsAt);
  const canSave =
    !codeError &&
    isDirty &&
    !isSaving &&
    !tiersInvalid &&
    !dateProblems.start &&
    !dateProblems.end &&
    !usageLimitProblem(usageLimit);

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
    setConfirmingDelete(true);
  };

  const handleCopyCode = async () => {
    if (await copyText(code)) shopify.toast.show("Code copied");
    else shopify.toast.show("Couldn't copy code", { isError: true });
  };

  // confirmed: true once the merchant has accepted a large discount.
  const handleSave = (confirmed = false) => {
    if (!canSave) return;
    if (!confirmed && useCustomTiers && hasLargeDiscount(customTiersDraft)) {
      setConfirmingLarge(true);
      return;
    }
    detailFetcher.submit(
      {
        code: normalizedCode,
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

  const badge = statusBadge(loaderData.status);
  const customerMessage = buildCustomerMessage(loaderData);
  const handleCopyMessage = async () => {
    if (await copyText(customerMessage.join("\n\n"))) {
      shopify.toast.show("Message copied");
    } else {
      shopify.toast.show("Couldn't copy message", { isError: true });
    }
  };

  return (
    <s-page heading={loaderData.code}>
      <s-badge slot="accessory" tone={badge.tone} icon={badge.icon}>
        {badge.label}
      </s-badge>
      <s-link slot="breadcrumb-actions" href="/app/discounts">
        Discount codes
      </s-link>

      <s-button
        slot="primary-action"
        variant="primary"
        {...(canSave ? {} : { disabled: true })}
        {...(isSaving ? { loading: true } : {})}
        onClick={() => handleSave()}
      >
        Save changes
      </s-button>

      <ConfirmModal
        id="large-discount"
        open={confirmingLarge}
        heading="Save a large discount?"
        confirmLabel="Save anyway"
        onConfirm={() => {
          setConfirmingLarge(false);
          handleSave(true);
        }}
        onCancel={closeLargeConfirm}
      >
        {largeDiscountText(customTiersDraft)}
      </ConfirmModal>

      <ConfirmModal
        id="delete-code"
        open={confirmingDelete}
        heading={`Delete ${loaderData.code}?`}
        confirmLabel="Delete code"
        destructive
        onConfirm={() => {
          setConfirmingDelete(false);
          deleteFetcher.submit({ intent: "delete" }, { method: "post" });
        }}
        onCancel={closeDeleteConfirm}
      >
        The code stops working right away and can&apos;t be brought back.
        Customers who have it will no longer get the discount.
      </ConfirmModal>

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

      <s-section heading="Code">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Discount code"
            details="Letters, numbers, - and _ only. Saved in capitals."
            {...(codeError ? { error: codeError } : {})}
            value={code}
            onInput={(event) =>
              setCode(event.currentTarget.value.toUpperCase())
            }
          >
            <s-button
              slot="accessory"
              variant="tertiary"
              icon="clipboard"
              onClick={handleCopyCode}
              accessibilityLabel="Copy code"
            ></s-button>
          </s-text-field>
          <s-stack direction="block" gap="small-300">
            <CustomerPicker
              value={customer}
              onChange={setCustomer}
              badge="Logged-in only"
            />
            <s-text color="subdued">
              {customer
                ? `Only ${customer.displayName} can use this code, and only while logged in.`
                : "Anyone with the code can use it. Pick a customer to make it theirs only."}
            </s-text>
          </s-stack>
        </s-stack>
      </s-section>

      <TiersSection
        useCustomTiers={useCustomTiers}
        onUseCustomTiersChange={setUseCustomTiers}
        tiers={customTiersDraft}
        onTiersChange={setCustomTiersDraft}
        defaultTiers={loaderData.defaultTiers}
        currencyCode={loaderData.currencyCode}
        customNote={`These tiers apply to ${loaderData.code} only. Changing the default tiers won't affect it.`}
        defaultNote={
          hasSavedCustomTiers
            ? "Save changes to remove this code's custom tiers and use your default tiers."
            : "Uses your default tiers."
        }
      />

      <DatesSection
        startsAt={startsAt}
        endsAt={endsAt}
        onStartsAtChange={setStartsAt}
        onEndsAtChange={setEndsAt}
      />

      <s-section slot="aside" heading="Summary">
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="none">
            <s-text color="subdued">Made for</s-text>
            <s-text type="strong">
              {loaderData.customer
                ? `${loaderData.customer.displayName} only`
                : "Anyone with the code"}
            </s-text>
          </s-stack>
          <s-stack direction="block" gap="none">
            <s-text color="subdued">Used</s-text>
            <s-text type="strong">
              {loaderData.usageLimit
                ? `${loaderData.used} of ${loaderData.usageLimit} times`
                : `${loaderData.used} ${loaderData.used === 1 ? "time" : "times"}`}
            </s-text>
          </s-stack>
          <s-text color="subdued">
            Usage can take a few minutes to update.
          </s-text>
        </s-stack>
      </s-section>

      <MoreSettingsSection
        slot="aside"
        usageLimit={usageLimit}
        onUsageLimitChange={setUsageLimit}
        appliesOncePerCustomer={appliesOncePerCustomer}
        onAppliesOncePerCustomerChange={setAppliesOncePerCustomer}
        combines={combines}
        onCombinesChange={setCombines}
        notes={notes}
        onNotesChange={setNotes}
      />

      {/* Last on the page: a message the merchant copies and sends. */}
      {customerMessage && (
        <s-section slot="aside" heading="Send to customer">
          <s-stack direction="block" gap="base">
            <s-text color="subdued">
              A ready-made message to paste into email, SMS or WhatsApp, with
              the code and how to use it.
            </s-text>
            <s-stack direction="inline">
              <s-button
                variant="tertiary"
                icon={messageOpen ? "chevron-up" : "chevron-down"}
                onClick={() => setMessageOpen(!messageOpen)}
              >
                {messageOpen ? "Hide message" : "Show message"}
              </s-button>
            </s-stack>
          </s-stack>
          {messageOpen && (
            <s-stack direction="block" gap="base">
              <s-box
                padding="small-200 base"
                background="subdued"
                borderRadius="base"
              >
                <s-stack direction="block" gap="small-200">
                  {customerMessage.map((line) => (
                    <s-text key={line}>{line}</s-text>
                  ))}
                </s-stack>
              </s-box>
              {isDirty && (
                <s-text color="subdued">
                  Save your changes to update this message.
                </s-text>
              )}
              <s-stack direction="inline">
                <s-button icon="clipboard" onClick={handleCopyMessage}>
                  Copy message
                </s-button>
              </s-stack>
            </s-stack>
          )}
        </s-section>
      )}
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
