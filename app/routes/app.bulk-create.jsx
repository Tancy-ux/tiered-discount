import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

const FUNCTION_HANDLE = "tiered-order-discount";
const MAX_CODES_PER_SUBMIT = 100;

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return {};
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

  return { ok: true, results };
};

export default function BulkCreate() {
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const [codesText, setCodesText] = useState("");

  const isSubmitting = fetcher.state !== "idle";
  const lineCount = codesText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;

  useEffect(() => {
    if (fetcher.data?.ok) {
      const succeeded = fetcher.data.results.filter((r) => r.ok).length;
      const failed = fetcher.data.results.length - succeeded;
      shopify.toast.show(
        failed > 0
          ? `Created ${succeeded} code(s), ${failed} failed`
          : `Created ${succeeded} code(s)`,
      );
      if (failed === 0) {
        setCodesText("");
      }
    }
  }, [fetcher.data, shopify]);

  const handleSubmit = () => {
    if (!codesText.trim() || isSubmitting) return;
    fetcher.submit({ codes: codesText }, { method: "post" });
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

          <s-button
            variant="primary"
            {...(!codesText.trim() || isSubmitting ? { disabled: true } : {})}
            {...(isSubmitting ? { loading: true } : {})}
            onClick={handleSubmit}
          >
            Create codes
          </s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
