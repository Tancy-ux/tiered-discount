import { useEffect } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { TierSummary } from "../components/TierEditor";
import { syncCustomerLocks } from "../discount-metafields.server";
import { loadShop, saveOnboarding } from "../shop.server";

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
        discountNodes(first: 100, query: "method:code type:app") {
          pageInfo {
            hasNextPage
          }
          nodes {
            discount {
              __typename
              ... on DiscountCodeApp {
                status
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
    totalLabel: `${codes.length}${more}`,
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
    <s-box padding="small-200 base" {...(done ? {} : { background: "subdued" })} borderRadius="base">
      <s-grid gridTemplateColumns="auto 1fr auto" gap="base" alignItems="center">
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
    totalLabel,
    activeLabel,
    functionId,
  } = useLoaderData();
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
            <s-stack direction="inline" justifyContent="space-between" alignItems="center">
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
                title="Set your default tiers"
                details="Choose the cart amounts and discounts every code uses."
                action={<s-button href="/app/settings">Settings</s-button>}
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
                    {...(isSavingGuide ? { disabled: true, loading: true } : {})}
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

      <s-section heading="Your default tiers">
        <s-stack direction="block" gap="base">
          <TierSummary tiers={defaultTiers} currencyCode={currencyCode} />
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-text color="subdued">
              Every code uses these unless it has its own tiers.
            </s-text>
            <s-link href="/app/settings">Edit</s-link>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Overview">
        <s-stack direction="block" gap="base">
          <s-grid gridTemplateColumns="1fr 1fr" gap="small-200">
            <s-box padding="small-200 base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="none">
                <s-text color="subdued">Active codes</s-text>
                <s-heading>{activeLabel}</s-heading>
              </s-stack>
            </s-box>
            <s-box padding="small-200 base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="none">
                <s-text color="subdued">All codes</s-text>
                <s-heading>{totalLabel}</s-heading>
              </s-stack>
            </s-box>
          </s-grid>
          <s-link href="/app/discounts">View all codes</s-link>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
