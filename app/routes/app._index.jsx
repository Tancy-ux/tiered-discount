import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { TierSummary } from "../components/TierEditor";
import { syncCustomerLocks } from "../discount-metafields.server";
import { loadShop, saveOnboarding } from "../shop.server";
import {
  formatMoney,
  statusBadge,
  tierForAmount,
  tiersForSubmit,
} from "../tiers";

function legacyId(gid) {
  return gid.split("/").pop();
}

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // Make sure older customer-specific codes carry the lock the Function checks.
  try {
    await syncCustomerLocks(admin);
  } catch (error) {
    console.error("Customer lock sync failed", error);
  }

  const response = await admin.graphql(
    `#graphql
      query DiscountStats {
        currentAppInstallation {
          app {
            id
          }
        }
        discountNodes(first: 100, reverse: true, query: "method:code type:app") {
          pageInfo {
            hasNextPage
          }
          nodes {
            id
            discount {
              __typename
              ... on DiscountCodeApp {
                title
                status
                asyncUsageCount
                codes(first: 1) {
                  nodes {
                    code
                  }
                }
                context {
                  ... on DiscountCustomers {
                    customers {
                      displayName
                    }
                  }
                }
                appDiscountType {
                  app {
                    id
                  }
                }
              }
            }
          }
        }
        shopifyFunctions(first: 25) {
          nodes {
            id
            title
          }
        }
      }`,
  );
  const { data } = await response.json();

  // "type:app" also returns other apps' discounts; count only this app's codes.
  const appId = data.currentAppInstallation.app.id;
  const codes = data.discountNodes.nodes.filter(
    (node) =>
      node.discount.__typename === "DiscountCodeApp" &&
      node.discount.appDiscountType?.app?.id === appId,
  );
  // Counts read the newest 100 app discounts; show "100+" style when there are more.
  const more = data.discountNodes.pageInfo.hasNextPage ? "+" : "";

  const tieredFunction =
    data.shopifyFunctions.nodes.find(
      (node) => node.title === "Tiered order discount",
    ) ?? data.shopifyFunctions.nodes[0];

  const shop = await loadShop(admin);

  return {
    defaultTiers: shop.defaultTiers,
    currencyCode: shop.currencyCode,
    hasSavedTiers: shop.hasSavedTiers,
    onboarding: shop.onboarding,
    totalCodes: codes.length,
    timesUsed: `${codes.reduce((sum, node) => sum + (node.discount.asyncUsageCount ?? 0), 0)}${more}`,
    customerOnly: `${codes.filter((node) => (node.discount.context?.customers ?? []).length > 0).length}${more}`,
    // Newest first (the query is reversed).
    recentCodes: codes.slice(0, 4).map((node) => ({
      id: legacyId(node.id),
      code: node.discount.codes.nodes[0]?.code ?? node.discount.title,
      forWho: node.discount.context?.customers?.[0]?.displayName ?? "Anyone",
      status: node.discount.status,
    })),
    activeLabel: `${codes.filter((node) => node.discount.status === "ACTIVE").length}${more}`,
    functionId: tieredFunction ? legacyId(tieredFunction.id) : null,
  };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  if (intent !== "markTested" && intent !== "hideGuide") {
    return { ok: false, error: "Unknown action." };
  }

  const shop = await loadShop(admin);
  const errors = await saveOnboarding(admin, shop.shopId, {
    ...shop.onboarding,
    ...(intent === "markTested" ? { tested: true } : { dismissed: true }),
  });
  return errors.length > 0
    ? { ok: false, error: errors.join(" ") }
    : { ok: true, intent };
};

// eslint-disable-next-line react/prop-types
function GuideStep({ done, title, details, action }) {
  return (
    <s-box
      padding="small-200 base"
      {...(done ? {} : { background: "subdued" })}
      borderRadius="base"
    >
      <s-grid
        gridTemplateColumns="auto 1fr auto"
        gap="base"
        alignItems="center"
      >
        <s-icon
          type={done ? "check-circle-filled" : "circle-dashed"}
          {...(done ? { tone: "success" } : {})}
        ></s-icon>
        <s-stack direction="block" gap="none">
          <s-text type="strong" {...(done ? { color: "subdued" } : {})}>
            {title}
          </s-text>
          {!done && details && <s-text color="subdued">{details}</s-text>}
        </s-stack>
        <s-box>{!done && action}</s-box>
      </s-grid>
    </s-box>
  );
}

export default function Home() {
  const {
    defaultTiers,
    currencyCode,
    hasSavedTiers,
    onboarding,
    totalCodes,
    activeLabel,
    timesUsed,
    customerOnly,
    recentCodes,
    functionId,
  } = useLoaderData();
  // Start the cart check at the store's own second tier (its first amount
  // above zero), so it suits any currency.
  const [cartAmount, setCartAmount] = useState(() => {
    const amounts = tiersForSubmit(defaultTiers)
      .map((tier) => tier.minSubtotal)
      .sort((a, b) => a - b);
    return String(amounts.find((amount) => amount > 0) ?? amounts[0] ?? "");
  });
  const cartValue = String(cartAmount ?? "").trim();
  const cartNumber = Number(cartValue);
  const cartError =
    cartValue && (!Number.isFinite(cartNumber) || cartNumber < 0)
      ? "Enter 0 or more"
      : null;
  // Nothing to say until a valid amount is typed.
  const check =
    cartValue && !cartError ? tierForAmount(defaultTiers, cartNumber) : null;
  const guideFetcher = useFetcher();
  const shopify = useAppBridge();

  useEffect(() => {
    if (guideFetcher.data?.ok === false) {
      shopify.toast.show(guideFetcher.data.error, { isError: true });
    }
  }, [guideFetcher.data, shopify]);

  const createHref = functionId ? `/app/discount/${functionId}/new` : null;
  const steps = [hasSavedTiers, totalCodes > 0, onboarding.tested];
  const doneCount = steps.filter(Boolean).length;
  const showGuide = !onboarding.dismissed && doneCount < steps.length;
  const isSavingGuide = guideFetcher.state !== "idle";
  const submitGuide = (intent) =>
    guideFetcher.submit({ intent }, { method: "post" });

  return (
    <s-page heading="Tiered order discount">
      {createHref && (
        <s-button slot="primary-action" variant="primary" href={createHref}>
          Create code
        </s-button>
      )}
      <s-button slot="secondary-actions" href="/app/bulk-create">
        Bulk create
      </s-button>

      {showGuide && (
        <s-section>
          <s-stack direction="block" gap="base">
            <s-stack
              direction="inline"
              justifyContent="space-between"
              alignItems="center"
            >
              <s-stack direction="block" gap="none">
                <s-heading>Get started</s-heading>
                <s-text color="subdued">{`${doneCount} of ${steps.length} steps done`}</s-text>
              </s-stack>
              <s-button
                variant="tertiary"
                {...(isSavingGuide ? { disabled: true } : {})}
                onClick={() => submitGuide("hideGuide")}
              >
                Hide guide
              </s-button>
            </s-stack>
            <s-box background="subdued" borderRadius="base" blockSize="6px">
              <s-box
                background="strong"
                borderRadius="base"
                blockSize="6px"
                inlineSize={`${Math.round((doneCount / steps.length) * 100)}%`}
              ></s-box>
            </s-box>
            <s-stack direction="block" gap="small-300">
              <GuideStep
                done={steps[0]}
                title="Save your default tiers"
                details="Codes use the built-in tiers until you save your own. Open Settings, check the tiers and press Save, even if you keep them as they are."
                action={<s-button href="/app/settings">Open Settings</s-button>}
              />
              <GuideStep
                done={steps[1]}
                title="Create your first code"
                details="Pick a customer to make it theirs only, or leave it open to anyone with the code."
                action={
                  createHref && (
                    <s-button variant="primary" href={createHref}>
                      Create code
                    </s-button>
                  )
                }
              />
              <GuideStep
                done={steps[2]}
                title="Test it at checkout"
                details="Log in to your store as that customer, add items, and enter the code."
                action={
                  <s-button
                    {...(isSavingGuide
                      ? { disabled: true, loading: true }
                      : {})}
                    onClick={() => submitGuide("markTested")}
                  >
                    Mark as done
                  </s-button>
                }
              />
            </s-stack>
          </s-stack>
        </s-section>
      )}

      <s-section heading="At a glance">
        <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
          <s-stack direction="block" gap="none">
            <s-text color="subdued">Active codes</s-text>
            <s-heading>{activeLabel}</s-heading>
          </s-stack>
          <s-stack direction="block" gap="none">
            <s-text color="subdued">Times used</s-text>
            <s-heading>{timesUsed}</s-heading>
          </s-stack>
          <s-stack direction="block" gap="none">
            <s-text color="subdued">Customer-only codes</s-text>
            <s-heading>{customerOnly}</s-heading>
          </s-stack>
        </s-grid>
      </s-section>

      <s-section heading="Your default tiers">
        <s-stack direction="block" gap="base">
          <TierSummary tiers={defaultTiers} currencyCode={currencyCode} />
          <s-divider></s-divider>
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-number-field
              label="Check a cart amount"
              min={0}
              prefix={currencyCode}
              {...(cartError ? { error: cartError } : {})}
              value={cartAmount}
              onInput={(event) => setCartAmount(event.currentTarget.value)}
            ></s-number-field>
            {check && (
              <s-text>
                {check.tier
                  ? `Gets ${check.tier.percentage}% off (saves ${formatMoney(check.saving, currencyCode)}).`
                  : "No discount yet."}
                {check.next
                  ? ` ${formatMoney(check.toNext, currencyCode)} more reaches ${check.next.percentage}%.`
                  : ""}
              </s-text>
            )}
          </s-stack>
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-text color="subdued">
              Every code uses these unless it has its own tiers.
            </s-text>
            <s-link href="/app/settings">Edit</s-link>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Recent codes">
        <s-stack direction="block" gap="base">
          {recentCodes.length === 0 ? (
            <s-text color="subdued">No codes yet.</s-text>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header>Code</s-table-header>
                <s-table-header>For</s-table-header>
                <s-table-header>Status</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {recentCodes.map((row) => {
                  const badge = statusBadge(row.status);
                  return (
                    <s-table-row key={row.id}>
                      <s-table-cell>
                        {functionId ? (
                          <s-link
                            href={`/app/discount/${functionId}/${row.id}`}
                          >
                            {row.code}
                          </s-link>
                        ) : (
                          row.code
                        )}
                      </s-table-cell>
                      <s-table-cell>{row.forWho}</s-table-cell>
                      <s-table-cell>
                        <s-badge tone={badge.tone} icon={badge.icon}>
                          {badge.label}
                        </s-badge>
                      </s-table-cell>
                    </s-table-row>
                  );
                })}
              </s-table-body>
            </s-table>
          )}
          {totalCodes > recentCodes.length && (
            <s-link href="/app/discounts">View all codes</s-link>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
