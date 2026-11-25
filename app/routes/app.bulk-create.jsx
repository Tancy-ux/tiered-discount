import { useCallback, useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { TierEditor, TierSummary, hasBadTiers } from "../components/TierEditor";
import {
  DEFAULT_COMBINES,
  combinesFormFields,
  combinesWithInput,
  readCombines,
} from "../components/CombineOptions";
import {
  DatesSection,
  MoreSettingsSection,
  datesProblems,
  usageLimitProblem,
} from "../components/DiscountSections";
import { ConfirmModal } from "../components/ConfirmModal";
import { hasLargeDiscount, largeDiscountText, tiersForSubmit } from "../tiers";
import {
  NAMESPACE,
  cleanTiers,
  codeTiersMetafields,
} from "../discount-metafields.server";
import { loadShop } from "../shop.server";
import { isoToShopDate, shopDateToIso } from "../dates";
import { MAX_BULK_CODES, parseBulkCodes } from "../codes";
import { findExistingCodes } from "../code-lookup.server";

const FUNCTION_HANDLE = "tiered-order-discount";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const shop = await loadShop(admin);
  return {
    defaultTiers: shop.defaultTiers,
    currencyCode: shop.currencyCode,
    today: isoToShopDate(new Date().toISOString(), shop.timeZone),
  };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const { codes } = parseBulkCodes(formData.get("codes"));
  if (codes.length === 0) {
    return { ok: false, error: "Enter at least one valid code." };
  }

  const startsAt = formData.get("startsAt")?.toString() ?? "";
  const endsAt = formData.get("endsAt")?.toString() ?? "";
  const dateProblems = datesProblems(startsAt, endsAt);
  if (dateProblems.start || dateProblems.end) {
    return { ok: false, error: `${dateProblems.start ?? dateProblems.end}.` };
  }
  const usageLimitRaw = formData.get("usageLimit")?.toString().trim() ?? "";
  const limitProblem = usageLimitProblem(usageLimitRaw);
  if (limitProblem) return { ok: false, error: `Total uses: ${limitProblem}.` };
  const appliesOncePerCustomer =
    formData.get("appliesOncePerCustomer") === "true";
  const notes = formData.get("notes")?.toString() ?? "";
  const combines = readCombines(formData);

  // Optional: every code in this batch gets the same custom tiers.
  let customTiers = null;
  if (formData.get("useCustomTiers") === "true") {
    const { tiers, error } = cleanTiers(formData.get("tiers")?.toString());
    if (error) return { ok: false, error };
    customTiers = tiers;
  }

  // Codes already used by any discount in the store are skipped.
  const existing = new Set(await findExistingCodes(admin, codes));
  const { timeZone } = await loadShop(admin);
  const metafields = [
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

  const results = [];
  for (const code of codes) {
    if (existing.has(code)) {
      results.push({ code, ok: false, error: "Already exists in your store." });
      continue;
    }
    const response = await admin.graphql(
      `#graphql
        mutation CreateBulkCode($discount: DiscountCodeAppInput!) {
          discountCodeAppCreate(codeAppDiscount: $discount) {
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
            ...(metafields.length > 0 ? { metafields } : {}),
          },
        },
      },
    );
    const { data } = await response.json();
    const userErrors = data?.discountCodeAppCreate?.userErrors ?? [];
    results.push({
      code,
      ok: userErrors.length === 0 && Boolean(data?.discountCodeAppCreate),
      error:
        userErrors.map((e) => e.message).join(" ") ||
        (data?.discountCodeAppCreate ? "" : "Shopify didn't create it."),
    });
  }

  return { ok: true, results, customTiers: Boolean(customTiers) };
};

export default function BulkCreate() {
  const { defaultTiers, currencyCode, today } = useLoaderData();
  const fetcher = useFetcher();
  const checkFetcher = useFetcher();
  const shopify = useAppBridge();
  const [codesText, setCodesText] = useState("");
  const [useCustomTiers, setUseCustomTiers] = useState(false);
  const [tiers, setTiers] = useState(defaultTiers);
  const [startsAt, setStartsAt] = useState(today);
  const [endsAt, setEndsAt] = useState("");
  const [usageLimit, setUsageLimit] = useState("");
  const [appliesOncePerCustomer, setAppliesOncePerCustomer] = useState(false);
  const [combines, setCombines] = useState(DEFAULT_COMBINES);
  const [notes, setNotes] = useState("");
  const [confirmingLarge, setConfirmingLarge] = useState(false);
  const closeLargeConfirm = useCallback(() => setConfirmingLarge(false), []);

  const parsed = parseBulkCodes(codesText);
  const codesKey = parsed.codes.join(",");

  // Ask which codes already exist, once the merchant pauses typing.
  useEffect(() => {
    if (!codesKey) return undefined;
    const timeout = setTimeout(() => {
      checkFetcher.load(
        `/app/code-check?codes=${encodeURIComponent(codesKey)}`,
      );
    }, 500);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codesKey]);
  const existing = new Set(
    checkFetcher.data?.checked?.join(",") === codesKey
      ? checkFetcher.data.existing
      : [],
  );
  const readyCodes = parsed.codes.filter((code) => !existing.has(code));

  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (!fetcher.data?.ok) return;
    const succeeded = fetcher.data.results.filter((r) => r.ok).length;
    const failed = fetcher.data.results.length - succeeded;
    const tierNote = fetcher.data.customTiers ? " with custom tiers" : "";
    shopify.toast.show(
      failed > 0
        ? `Created ${succeeded} code(s)${tierNote}, ${failed} not created`
        : `Created ${succeeded} code(s)${tierNote}`,
    );
    if (failed === 0) setCodesText("");
  }, [fetcher.data, shopify]);

  const dateProblems = datesProblems(startsAt, endsAt);
  const tiersInvalid =
    useCustomTiers && (tiers.length === 0 || hasBadTiers(tiers));
  const canSave =
    readyCodes.length > 0 &&
    !isSubmitting &&
    !tiersInvalid &&
    !dateProblems.start &&
    !dateProblems.end &&
    !usageLimitProblem(usageLimit);

  // confirmed: true once the merchant has accepted a large discount.
  const handleSave = (confirmed = false) => {
    if (!canSave) return;
    if (!confirmed && useCustomTiers && hasLargeDiscount(tiers)) {
      setConfirmingLarge(true);
      return;
    }
    fetcher.submit(
      {
        codes: readyCodes.join("\n"),
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

  const alreadyExisting = parsed.codes.filter((code) => existing.has(code));
  const hasProblems =
    parsed.invalid.length > 0 ||
    parsed.repeats.length > 0 ||
    alreadyExisting.length > 0 ||
    parsed.overLimit > 0;

  return (
    <s-page heading="Bulk create discount codes">
      <s-link slot="breadcrumb-actions" href="/app/discounts">
        Discount codes
      </s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        {...(canSave ? {} : { disabled: true })}
        {...(isSubmitting ? { loading: true } : {})}
        onClick={() => handleSave()}
      >
        {readyCodes.length > 0
          ? `Create ${readyCodes.length} code${readyCodes.length === 1 ? "" : "s"}`
          : "Create codes"}
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

      {fetcher.data?.ok === false && (
        <s-banner tone="critical" heading="Couldn't create codes">
          <s-paragraph>{fetcher.data.error}</s-paragraph>
        </s-banner>
      )}

      {fetcher.data?.ok && fetcher.data.results.some((r) => !r.ok) && (
        <s-banner tone="warning" heading="Some codes weren't created">
          <s-stack direction="block" gap="small-300">
            {fetcher.data.results
              .filter((r) => !r.ok)
              .map((r) => (
                <s-text key={r.code}>{`${r.code}: ${r.error}`}</s-text>
              ))}
          </s-stack>
        </s-banner>
      )}

      <s-section heading="Codes">
        <s-stack direction="block" gap="base">
          <s-text color="subdued">
            One code per line. Letters, numbers, - and _ only; codes are saved
            in capitals. Codes made here can be used by anyone who has them. To
            make a code for one customer, use Create code.
          </s-text>
          <s-text-area
            label="Codes"
            labelAccessibilityVisibility="exclusive"
            placeholder={"SUMMER25\nVIP01\nVIP02"}
            rows={10}
            value={codesText}
            onInput={(event) => setCodesText(event.currentTarget.value)}
          ></s-text-area>

          <s-text type="strong">
            {`${readyCodes.length} code${readyCodes.length === 1 ? "" : "s"} ready`}
          </s-text>

          {hasProblems && (
            <s-box
              padding="small-200 base"
              background="subdued"
              borderRadius="base"
            >
              <s-stack direction="block" gap="small-300">
                {parsed.invalid.map((item) => (
                  <s-text key={`line-${item.line}`}>
                    {`Line ${item.line} "${item.text}": ${item.error}.`}
                  </s-text>
                ))}
                {alreadyExisting.length > 0 && (
                  <s-text>
                    {`Already in your store, skipped: ${alreadyExisting.join(", ")}.`}
                  </s-text>
                )}
                {parsed.repeats.length > 0 && (
                  <s-text color="subdued">
                    {`Entered more than once, counted once: ${parsed.repeats.join(", ")}.`}
                  </s-text>
                )}
                {parsed.overLimit > 0 && (
                  <s-text>
                    {`Only ${MAX_BULK_CODES} codes can be created at a time; the last ${parsed.overLimit} will be left out.`}
                  </s-text>
                )}
              </s-stack>
            </s-box>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Discount tiers">
        <s-stack direction="block" gap="base">
          <s-checkbox
            label="Use custom tiers for these codes"
            details="Off: the codes use the default tiers and follow any later changes to them."
            {...(useCustomTiers ? { checked: true } : {})}
            onChange={(event) => setUseCustomTiers(event.currentTarget.checked)}
          ></s-checkbox>

          {useCustomTiers ? (
            <>
              <s-text color="subdued">
                Every code in this batch gets these tiers. Changing the default
                tiers later won&apos;t affect them.
              </s-text>
              <TierEditor
                tiers={tiers}
                onChange={setTiers}
                currencyCode={currencyCode}
              />
            </>
          ) : (
            <>
              <s-box
                padding="small-200 base"
                background="subdued"
                borderRadius="base"
              >
                <TierSummary tiers={defaultTiers} currencyCode={currencyCode} />
              </s-box>
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-text color="subdued">Uses your default tiers.</s-text>
                <s-link href="/app/settings">Change default tiers</s-link>
              </s-stack>
            </>
          )}
        </s-stack>
      </s-section>

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
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
