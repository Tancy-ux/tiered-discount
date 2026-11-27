import { useCallback, useEffect, useState } from "react";
import {
  useFetcher,
  useLoaderData,
  useNavigate,
  useParams,
} from "react-router";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { CustomerPicker } from "../components/CustomerPicker";
import { hasBadTiers } from "../components/TierEditor";
import {
  DEFAULT_COMBINES,
  combinesFormFields,
  combinesWithInput,
  readCombines,
} from "../components/CombineOptions";
import {
  DatesSection,
  MoreSettingsSection,
  TiersSection,
  datesProblems,
  usageLimitProblem,
} from "../components/DiscountSections";
import { hasLargeDiscount, largeDiscountText, tiersForSubmit } from "../tiers";
import { ConfirmModal } from "../components/ConfirmModal";
import {
  NAMESPACE,
  cleanTiers,
  codeTiersMetafields,
  customerLockMetafields,
} from "../discount-metafields.server";
import { loadShop } from "../shop.server";
import { codeFormatError, normalizeCode } from "../codes";
import { findExistingCodes } from "../code-lookup.server";
import { useCodeTaken } from "../components/useCodeTaken";
import { isoToShopDate, shopDateToIso } from "../dates";
import { copyText } from "../clipboard";
import { buildCustomerMessage } from "../customer-message";

const FUNCTION_HANDLE = "tiered-order-discount";

// "WARE-" + "Priya Shah" → "WARE-PRIYA"
function suggestCode(codePrefix, displayName) {
  const firstName = (displayName ?? "").trim().split(/\s+/)[0] ?? "";
  const cleaned = firstName.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return cleaned ? `${codePrefix}${cleaned}` : "";
}

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const shop = await loadShop(admin);
  return {
    defaultTiers: shop.defaultTiers,
    currencyCode: shop.currencyCode,
    codePrefix: shop.codePrefix,
    storeUrl: shop.storeUrl,
    // Today in the shop's time zone, the default start date.
    today: isoToShopDate(new Date().toISOString(), shop.timeZone),
  };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const code = normalizeCode(formData.get("code"));
  const customerId = formData.get("customerId")?.toString().trim() ?? "";
  const startsAt = formData.get("startsAt")?.toString() ?? "";
  const endsAt = formData.get("endsAt")?.toString() ?? "";
  const usageLimitRaw = formData.get("usageLimit")?.toString().trim() ?? "";
  const appliesOncePerCustomer =
    formData.get("appliesOncePerCustomer") === "true";
  const notes = formData.get("notes")?.toString() ?? "";
  const combines = readCombines(formData);

  // Same checks as the form, so nothing invalid reaches Shopify.
  const formatError = codeFormatError(code);
  if (formatError) return { ok: false, error: `${formatError}.` };
  if ((await findExistingCodes(admin, [code])).length > 0) {
    return {
      ok: false,
      error:
        "A discount with this code already exists in your store. Choose another code.",
    };
  }
  const dateProblems = datesProblems(startsAt, endsAt);
  if (dateProblems.start || dateProblems.end) {
    return { ok: false, error: dateProblems.start ?? dateProblems.end };
  }
  const limitProblem = usageLimitProblem(usageLimitRaw);
  if (limitProblem) return { ok: false, error: `Total uses: ${limitProblem}.` };

  let customTiers = null;
  if (formData.get("useCustomTiers") === "true") {
    const { tiers, error } = cleanTiers(formData.get("tiers")?.toString());
    if (error) return { ok: false, error };
    customTiers = tiers;
  }

  const { timeZone } = await loadShop(admin);
  const metafields = [
    ...customerLockMetafields(customerId),
    ...codeTiersMetafields(customTiers),
    ...(notes.trim()
      ? [
          {
            namespace: NAMESPACE,
            key: "notes",
            type: "multi_line_text_field",
            value: notes,
          },
        ]
      : []),
  ];

  const response = await admin.graphql(
    `#graphql
      mutation CreateTieredCode($discount: DiscountCodeAppInput!) {
        discountCodeAppCreate(codeAppDiscount: $discount) {
          codeAppDiscount {
            discountId
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        discount: {
          title: code,
          code,
          functionHandle: FUNCTION_HANDLE,
          discountClasses: ["ORDER"],
          combinesWith: combinesWithInput(combines),
          startsAt: shopDateToIso(startsAt, timeZone),
          endsAt: endsAt ? shopDateToIso(endsAt, timeZone, true) : null,
          usageLimit: usageLimitRaw ? Number(usageLimitRaw) : null,
          appliesOncePerCustomer,
          // No customer: Shopify's default, open to all buyers.
          ...(customerId
            ? { context: { customers: { add: [customerId] } } }
            : {}),
          ...(metafields.length > 0 ? { metafields } : {}),
        },
      },
    },
  );
  const { data } = await response.json();
  const userErrors = data?.discountCodeAppCreate?.userErrors ?? [];
  if (userErrors.length > 0 || !data?.discountCodeAppCreate?.codeAppDiscount) {
    return {
      ok: false,
      error:
        userErrors.map((e) => e.message).join(" ") ||
        "Shopify didn't create the code. Try again.",
    };
  }

  return {
    ok: true,
    id: data.discountCodeAppCreate.codeAppDiscount.discountId.split("/").pop(),
  };
};

export default function NewDiscount() {
  const { defaultTiers, currencyCode, codePrefix, storeUrl, today } =
    useLoaderData();
  const { functionId } = useParams();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const navigate = useNavigate();

  const [customer, setCustomer] = useState(null);
  const [code, setCode] = useState("");
  const [useCustomTiers, setUseCustomTiers] = useState(false);
  const [tiers, setTiers] = useState(defaultTiers);
  const [startsAt, setStartsAt] = useState(today);
  const [endsAt, setEndsAt] = useState("");
  const [usageLimit, setUsageLimit] = useState("");
  const [appliesOncePerCustomer, setAppliesOncePerCustomer] = useState(false);
  const [combines, setCombines] = useState(DEFAULT_COMBINES);
  const [notes, setNotes] = useState("");

  const isSaving = fetcher.state !== "idle";
  const created = Boolean(fetcher.data?.ok);

  // Anything entered that would be lost by leaving (drives the save bar).
  const hasEntries =
    !created &&
    (Boolean(code.trim()) ||
      Boolean(customer) ||
      useCustomTiers ||
      startsAt !== today ||
      Boolean(endsAt) ||
      Boolean(String(usageLimit).trim()) ||
      appliesOncePerCustomer ||
      combines.order !== DEFAULT_COMBINES.order ||
      combines.product !== DEFAULT_COMBINES.product ||
      combines.shipping !== DEFAULT_COMBINES.shipping ||
      Boolean(notes.trim()));
  const handleDiscard = () => {
    setCustomer(null);
    setCode("");
    setUseCustomTiers(false);
    setTiers(defaultTiers);
    setStartsAt(today);
    setEndsAt("");
    setUsageLimit("");
    setAppliesOncePerCustomer(false);
    setCombines(DEFAULT_COMBINES);
    setNotes("");
  };

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show("Discount code created");
      navigate(`/app/discounts/${functionId}/${fetcher.data.id}`);
    }
  }, [fetcher.data, shopify, navigate, functionId]);

  const normalizedCode = normalizeCode(code);
  const { taken: codeTaken } = useCodeTaken(code);
  // Show format problems once something is typed.
  const codeError = !normalizedCode
    ? null
    : (codeFormatError(normalizedCode) ??
      (codeTaken
        ? "A discount with this code already exists in your store"
        : null));

  const dateProblems = datesProblems(startsAt, endsAt);
  const canSave =
    Boolean(normalizedCode) &&
    !codeError &&
    !isSaving &&
    !dateProblems.start &&
    !dateProblems.end &&
    !usageLimitProblem(usageLimit) &&
    !(useCustomTiers && (tiers.length === 0 || hasBadTiers(tiers)));

  const handleCustomerChange = (picked) => {
    setCustomer(picked);
    // Suggest a code until the merchant types their own.
    if (picked && !code.trim())
      setCode(suggestCode(codePrefix, picked.displayName));
  };

  // Live preview of the message for the chosen customer, from what's entered.
  const customerMessage = buildCustomerMessage({
    customer,
    code: normalizedCode || "YOURCODE",
    // Custom tiers as typed, so the preview always matches the screen.
    customTiers: useCustomTiers && tiers.length > 0 ? tiers : null,
    defaultTiers,
    currencyCode,
    endsAt,
    storeUrl,
  });
  const handleCopyMessage = async () => {
    if (await copyText(customerMessage.join("\n\n"))) {
      shopify.toast.show("Message copied");
    } else {
      shopify.toast.show("Couldn't copy message", { isError: true });
    }
  };

  const [confirmingLarge, setConfirmingLarge] = useState(false);
  const closeLargeConfirm = useCallback(() => setConfirmingLarge(false), []);

  // confirmed: true once the merchant has accepted a large discount.
  const handleSave = (confirmed = false) => {
    if (!canSave) return;
    if (!confirmed && useCustomTiers && hasLargeDiscount(tiers)) {
      setConfirmingLarge(true);
      return;
    }
    fetcher.submit(
      {
        code: normalizedCode,
        customerId: customer?.id ?? "",
        startsAt,
        endsAt,
        usageLimit: String(usageLimit).trim(),
        appliesOncePerCustomer: String(appliesOncePerCustomer),
        notes,
        useCustomTiers: String(useCustomTiers),
        tiers: JSON.stringify(tiersForSubmit(tiers)),
        ...combinesFormFields(combines),
      },
      { method: "post" },
    );
  };

  return (
    <s-page heading="Create discount code">
      {/* Shopify's save bar: shows while there are unsaved changes, and the
          admin asks before leaving the page while it's open. */}
      <SaveBar id="create-save-bar" open={hasEntries}>
        <button
          variant="primary"
          {...(isSaving ? { loading: "" } : {})}
          {...(canSave ? {} : { disabled: true })}
          onClick={() => handleSave()}
        >
          Save
        </button>
        <button onClick={handleDiscard}>Discard</button>
      </SaveBar>

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
        Create code
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
        {largeDiscountText(tiers)}
      </ConfirmModal>

      <s-button slot="secondary-actions" href="/app">
        Cancel
      </s-button>

      {fetcher.data?.ok === false && (
        <s-banner tone="critical" heading="Couldn't create the code">
          <s-paragraph>{fetcher.data.error}</s-paragraph>
        </s-banner>
      )}

      <s-section heading="Code">
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="small-300">
            <CustomerPicker
              value={customer}
              onChange={handleCustomerChange}
              badge="Logged-in only"
            />
            <s-text color="subdued">
              Optional. Only this customer can use the code, and only when
              logged in. Leave empty for anyone with the code.
            </s-text>
          </s-stack>
          <s-text-field
            label="Discount code"
            details="Letters, numbers, - and _ only. Saved in capitals."
            {...(codeError ? { error: codeError } : {})}
            value={code}
            {...(codePrefix ? { placeholder: `${codePrefix}SUMMER` } : {})}
            onInput={(event) =>
              setCode(event.currentTarget.value.toUpperCase())
            }
          ></s-text-field>
        </s-stack>
      </s-section>

      <TiersSection
        useCustomTiers={useCustomTiers}
        onUseCustomTiersChange={setUseCustomTiers}
        tiers={tiers}
        onTiersChange={setTiers}
        defaultTiers={defaultTiers}
        currencyCode={currencyCode}
        customNote="These tiers apply to this code only."
        defaultNote="Uses your default tiers."
      />

      <DatesSection
        startsAt={startsAt}
        endsAt={endsAt}
        onStartsAtChange={setStartsAt}
        onEndsAtChange={setEndsAt}
      />

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

      {/* For a customer-only code: the message to send them, updated live. */}
      {customerMessage && (
        <s-section slot="aside" heading="Send to customer">
          <s-stack direction="block" gap="base">
            <s-text color="subdued">
              A ready-made message to paste into email, SMS or WhatsApp. The
              code only works once you click Create code.
            </s-text>
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
            <s-stack direction="inline">
              <s-button
                icon="clipboard"
                {...(normalizedCode && !codeError ? {} : { disabled: true })}
                onClick={handleCopyMessage}
              >
                Copy message
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
