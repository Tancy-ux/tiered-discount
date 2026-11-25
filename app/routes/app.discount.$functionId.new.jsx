import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useNavigate, useParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
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
  CombinesSection,
  DatesSection,
  LimitsSection,
  NotesSection,
  TiersSection,
  datesProblems,
  usageLimitProblem,
} from "../components/DiscountSections";
import { confirmLargeDiscount, tiersForSubmit } from "../tiers";
import {
  NAMESPACE,
  cleanTiers,
  codeTiersMetafields,
  customerLockMetafields,
} from "../discount-metafields.server";
import { loadShop } from "../shop.server";
import { isoToShopDate, shopDateToIso } from "../dates";

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
    // Today in the shop's time zone, the default start date.
    today: isoToShopDate(new Date().toISOString(), shop.timeZone),
  };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const code = formData.get("code")?.toString().trim().toUpperCase() ?? "";
  const customerId = formData.get("customerId")?.toString().trim() ?? "";
  const startsAt = formData.get("startsAt")?.toString() ?? "";
  const endsAt = formData.get("endsAt")?.toString() ?? "";
  const usageLimitRaw = formData.get("usageLimit")?.toString().trim() ?? "";
  const appliesOncePerCustomer = formData.get("appliesOncePerCustomer") === "true";
  const notes = formData.get("notes")?.toString() ?? "";
  const combines = readCombines(formData);

  // Same checks as the form, so nothing invalid reaches Shopify.
  if (!code) return { ok: false, error: "Enter a code." };
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
      ? [{ namespace: NAMESPACE, key: "notes", type: "multi_line_text_field", value: notes }]
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
          ...(customerId ? { context: { customers: { add: [customerId] } } } : {}),
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
  const { defaultTiers, currencyCode, codePrefix, today } = useLoaderData();
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

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show("Discount code created");
      navigate(`/app/discount/${functionId}/${fetcher.data.id}`);
    }
  }, [fetcher.data, shopify, navigate, functionId]);

  const dateProblems = datesProblems(startsAt, endsAt);
  const canSave =
    Boolean(code.trim()) &&
    !isSaving &&
    !dateProblems.start &&
    !dateProblems.end &&
    !usageLimitProblem(usageLimit) &&
    !(useCustomTiers && (tiers.length === 0 || hasBadTiers(tiers)));

  const handleCustomerChange = (picked) => {
    setCustomer(picked);
    // Suggest a code until the merchant types their own.
    if (picked && !code.trim()) setCode(suggestCode(codePrefix, picked.displayName));
  };

  const handleSave = () => {
    if (!canSave) return;
    if (useCustomTiers && !confirmLargeDiscount(tiers)) return;
    fetcher.submit(
      {
        code: code.trim(),
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
      <s-link slot="breadcrumb-actions" href="/app/discounts">
        Discount codes
      </s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        {...(canSave ? {} : { disabled: true })}
        {...(isSaving ? { loading: true } : {})}
        onClick={handleSave}
      >
        Create code
      </s-button>
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
            <CustomerPicker value={customer} onChange={handleCustomerChange} />
            <s-text color="subdued">
              Optional. Only this customer can use the code, and only when
              logged in. Leave empty for anyone with the code.
            </s-text>
          </s-stack>
          <s-text-field
            label="Discount code"
            value={code}
            {...(codePrefix ? { placeholder: `${codePrefix}SUMMER` } : {})}
            onInput={(event) => setCode(event.currentTarget.value.toUpperCase())}
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

      <LimitsSection
        slot="aside"
        usageLimit={usageLimit}
        onUsageLimitChange={setUsageLimit}
        appliesOncePerCustomer={appliesOncePerCustomer}
        onAppliesOncePerCustomerChange={setAppliesOncePerCustomer}
      />
      <CombinesSection
        slot="aside"
        combines={combines}
        onCombinesChange={setCombines}
      />
      <NotesSection slot="aside" notes={notes} onNotesChange={setNotes} />
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
