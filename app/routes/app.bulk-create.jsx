import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { TierEditor, hasBadTiers } from "../components/TierEditor";
import { DEFAULT_TIERS, readTiers, tiersForSubmit } from "../tiers";
import {
  cleanTiers,
  codeTiersMetafields,
} from "../discount-metafields.server";

const FUNCTION_HANDLE = "tiered-order-discount";
const MAX_CODES_PER_SUBMIT = 100;

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const response = await admin.graphql(
    `#graphql
      query BulkCreateDefaults {
        shop {
          metafield(namespace: "tiered_discount", key: "config") {
            value
          }
        }
      }`,
  );
  const { data } = await response.json();
  return {
    defaultTiers: readTiers(data?.shop?.metafield?.value) ?? DEFAULT_TIERS,
  };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const formData = await request.formData();
  const raw = formData.get("codes")?.toString() ?? "";

  const codes = [
    ...new Set(
      raw
        .split("\n")
        .map((line) => line.trim().toUpperCase())
        .filter(Boolean),
    ),
  ].slice(0, MAX_CODES_PER_SUBMIT);

  if (codes.length === 0) {
    return { ok: false, error: "Enter at least one code." };
  }

  // Optional: every code in this batch gets the same custom tiers.
  let customTiers = null;
  if (formData.get("useCustomTiers") === "true") {
    const { tiers, error } = cleanTiers(formData.get("tiers")?.toString());
    if (error) return { ok: false, error };
    customTiers = tiers;
  }

  const results = [];
  for (const code of codes) {
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
            combinesWith: {
              orderDiscounts: false,
              productDiscounts: false,
              shippingDiscounts: true,
            },
            startsAt: new Date().toISOString(),
            ...(customTiers
              ? { metafields: codeTiersMetafields(customTiers) }
              : {}),
          },
        },
      },
    );
    const { data } = await response.json();
    const userErrors = data?.discountCodeAppCreate?.userErrors ?? [];

    results.push({
      code,
      ok: userErrors.length === 0,
      error: userErrors.map((e) => e.message).join(" "),
    });
  }

  return { ok: true, results, customTiers: Boolean(customTiers) };
};

export default function BulkCreate() {
  const { defaultTiers } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const [codesText, setCodesText] = useState("");
  const [useCustomTiers, setUseCustomTiers] = useState(false);
  const [tiers, setTiers] = useState(defaultTiers);

  const isSubmitting = fetcher.state !== "idle";
  const lineCount = codesText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;

  useEffect(() => {
    if (fetcher.data?.ok) {
      const succeeded = fetcher.data.results.filter((r) => r.ok).length;
      const failed = fetcher.data.results.length - succeeded;
      const tierNote = fetcher.data.customTiers ? " with custom tiers" : "";
      shopify.toast.show(
        failed > 0
          ? `Created ${succeeded} code(s)${tierNote}, ${failed} failed`
          : `Created ${succeeded} code(s)${tierNote}`,
      );
      if (failed === 0) {
        setCodesText("");
      }
    }
  }, [fetcher.data, shopify]);

  const tiersInvalid = useCustomTiers && hasBadTiers(tiers);

  const handleSubmit = () => {
    if (!codesText.trim() || isSubmitting || tiersInvalid) return;
    fetcher.submit(
      {
        codes: codesText,
        useCustomTiers: String(useCustomTiers),
        tiers: JSON.stringify(tiersForSubmit(tiers)),
      },
      { method: "post" },
    );
  };

  return (
    <s-page heading="Bulk create discount codes">
      <s-link slot="breadcrumb-actions" href="/app/discounts">
        Back to discount codes
      </s-link>

      <s-section heading="Create multiple codes">
        <s-banner tone="info" heading="Usable by anyone">
          <s-paragraph>
            Every code created here is unrestricted — anyone with the code
            can use it. To restrict a code to a specific customer, create it
            individually from the home page instead.
          </s-paragraph>
        </s-banner>

        {fetcher.data?.ok === false && (
          <s-banner tone="critical" heading="Couldn't create codes">
            <s-paragraph>{fetcher.data.error}</s-paragraph>
          </s-banner>
        )}

        {fetcher.data?.ok && fetcher.data.results.some((r) => !r.ok) && (
          <s-banner tone="warning" heading="Some codes couldn't be created">
            <s-stack direction="block" gap="small-300">
              {fetcher.data.results
                .filter((r) => !r.ok)
                .map((r) => (
                  <s-text key={r.code}>
                    {r.code}: {r.error}
                  </s-text>
                ))}
            </s-stack>
          </s-banner>
        )}

        <s-stack direction="block" gap="base">
          <s-text-area
            label="Codes"
            labelAccessibilityVisibility="exclusive"
            placeholder={"One code per line, e.g.\nWARE-SUMMER25\nWARE-VIP01\nWARE-VIP02"}
            rows={10}
            value={codesText}
            onInput={(event) => setCodesText(event.currentTarget.value)}
          ></s-text-area>

          <s-text color="subdued">
            {lineCount} code{lineCount === 1 ? "" : "s"} ready
            {lineCount > MAX_CODES_PER_SUBMIT
              ? ` — only the first ${MAX_CODES_PER_SUBMIT} will be created per submit`
              : ""}
          </s-text>
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
              <s-paragraph>
                {"Every code in this batch gets these tiers. Changing the default tiers later won't affect them, and you can still change any one code from its own page."}
              </s-paragraph>
              <TierEditor tiers={tiers} onChange={setTiers} />
            </>
          ) : (
            <>
              <s-text color="subdued">Default tiers:</s-text>
              <TierEditor tiers={defaultTiers} onChange={() => {}} disabled />
            </>
          )}
        </s-stack>
      </s-section>

      <s-section>
        <s-button
          variant="primary"
          {...(!codesText.trim() || isSubmitting || tiersInvalid
            ? { disabled: true }
            : {})}
          {...(isSubmitting ? { loading: true } : {})}
          onClick={handleSubmit}
        >
          {useCustomTiers ? "Create codes with custom tiers" : "Create codes"}
        </s-button>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
