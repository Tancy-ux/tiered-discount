import { useEffect, useState } from "react";
import { useLoaderData, useNavigation, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { statusBadge } from "../tiers";
import { copyText } from "../clipboard";

// Smaller pages load faster; Previous/Next pages through the rest.
const PAGE_SIZE = 25;
const STATUSES = ["active", "scheduled", "expired"];

function legacyId(gid) {
  return gid.split("/").pop();
}

/** Builds the discountNodes search, e.g. `method:code type:app status:active summer`. */
function buildQuery(search, status) {
  const parts = ["method:code", "type:app"];
  if (STATUSES.includes(status)) parts.push(`status:${status}`);
  // Drop characters that have a meaning in Shopify's search syntax.
  const term = search.replace(/["'\\:()]/g, " ").trim();
  if (term) parts.push(term);
  return parts.join(" ");
}

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const search = url.searchParams.get("q")?.trim() ?? "";
  const status = url.searchParams.get("status") ?? "all";
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");

  // Newest first. "before" pages backwards, everything else forwards.
  const paging = before
    ? { last: PAGE_SIZE, before }
    : { first: PAGE_SIZE, after: after || null };

  const response = await admin.graphql(
    `#graphql
      query ExistingDiscountCodes(
        $first: Int
        $after: String
        $last: Int
        $before: String
        $query: String!
      ) {
        currentAppInstallation {
          app {
            id
          }
        }
        discountNodes(
          first: $first
          after: $after
          last: $last
          before: $before
          reverse: true
          query: $query
        ) {
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
            endCursor
          }
          nodes {
            id
            codeTiers: metafield(namespace: "tiered_discount", key: "tiers") {
              id
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
                asyncUsageCount
                usageLimit
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
                    }
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
    { variables: { ...paging, query: buildQuery(search, status) } },
  );
  const { data } = await response.json();

  const tieredFunction =
    data.shopifyFunctions.nodes.find(
      (node) => node.title === "Tiered order discount",
    ) ?? data.shopifyFunctions.nodes[0];

  // "type:app" also returns other apps' discounts; keep only this app's codes.
  const appId = data.currentAppInstallation.app.id;
  const codes = data.discountNodes.nodes
    .filter(
      (node) =>
        node.discount.__typename === "DiscountCodeApp" &&
        node.discount.appDiscountType?.app?.id === appId,
    )
    .map((node) => {
      const discount = node.discount;
      return {
        id: legacyId(node.id),
        code: discount.codes.nodes[0]?.code ?? discount.title,
        status: discount.status,
        customerName:
          discount.context?.customers?.[0]?.displayName ?? "Any customer",
        customTiers: Boolean(node.codeTiers),
        used: discount.asyncUsageCount,
        usageLimit: discount.usageLimit,
      };
    });

  return {
    codes,
    functionId: tieredFunction ? legacyId(tieredFunction.id) : null,
    search,
    status,
    pageInfo: data.discountNodes.pageInfo,
  };
};

export default function Discounts() {
  const { codes, functionId, search, status, pageInfo } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const [searchText, setSearchText] = useState(search);
  const isLoading = navigation.state === "loading";

  useEffect(() => {
    setSearchText(search);
  }, [search]);

  // Changing the search or filter starts again from the first page.
  const applyFilters = (next) => {
    const params = new URLSearchParams(searchParams);
    params.delete("after");
    params.delete("before");
    for (const [key, value] of Object.entries(next)) {
      if (value && value !== "all") params.set(key, value);
      else params.delete(key);
    }
    setSearchParams(params);
  };

  const goToPage = (direction) => {
    const params = new URLSearchParams(searchParams);
    params.delete("after");
    params.delete("before");
    if (direction === "next") params.set("after", pageInfo.endCursor);
    else params.set("before", pageInfo.startCursor);
    setSearchParams(params);
  };

  const handleCopy = async (code) => {
    if (await copyText(code)) shopify.toast.show("Code copied");
    else shopify.toast.show("Couldn't copy code", { isError: true });
  };

  const isFiltered = Boolean(search) || status !== "all";

  return (
    <s-page heading="Discount codes">
      <s-link slot="breadcrumb-actions" href="/app">
        Home
      </s-link>
      {functionId && (
        <s-button
          slot="primary-action"
          variant="primary"
          href={`/app/discounts/${functionId}/new`}
        >
          Create code
        </s-button>
      )}
      <s-button slot="secondary-actions" href="/app/bulk-create">
        Bulk create
      </s-button>

      <s-section heading="Codes">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base" alignItems="end">
            <s-search-field
              label="Search codes"
              placeholder="Search by code"
              value={searchText}
              onInput={(event) => setSearchText(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter")
                  applyFilters({ q: searchText.trim() });
              }}
            ></s-search-field>
            <s-button onClick={() => applyFilters({ q: searchText.trim() })}>
              Search
            </s-button>
            <s-select
              label="Status"
              value={status}
              onChange={(event) =>
                applyFilters({ status: event.currentTarget.value })
              }
            >
              <s-option value="all">All</s-option>
              <s-option value="active">Active</s-option>
              <s-option value="scheduled">Scheduled</s-option>
              <s-option value="expired">Paused or ended</s-option>
            </s-select>
          </s-stack>

          {codes.length === 0 ? (
            <s-paragraph>
              {isFiltered
                ? "No codes match. Try a different search or status."
                : "No discount codes created yet."}
            </s-paragraph>
          ) : (
            <s-table {...(isLoading ? { loading: true } : {})}>
              <s-table-header-row>
                <s-table-header>Code</s-table-header>
                <s-table-header>Customer</s-table-header>
                <s-table-header>Tiers</s-table-header>
                <s-table-header>Used</s-table-header>
                <s-table-header>Status</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {codes.map((row) => {
                  const badge = statusBadge(row.status);
                  return (
                    <s-table-row key={row.id}>
                      <s-table-cell>
                        <s-stack
                          direction="inline"
                          gap="small-300"
                          alignItems="center"
                        >
                          {functionId ? (
                            <s-link
                              href={`/app/discounts/${functionId}/${row.id}`}
                            >
                              {row.code}
                            </s-link>
                          ) : (
                            row.code
                          )}
                          <s-button
                            variant="tertiary"
                            onClick={() => handleCopy(row.code)}
                            accessibilityLabel={`Copy ${row.code}`}
                          >
                            📋
                          </s-button>
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>{row.customerName}</s-table-cell>
                      <s-table-cell>
                        {row.customTiers ? (
                          <s-badge tone="accent" icon="wand">
                            Custom
                          </s-badge>
                        ) : (
                          "Default"
                        )}
                      </s-table-cell>
                      <s-table-cell>
                        {row.usageLimit
                          ? `${row.used} of ${row.usageLimit}`
                          : row.used}
                      </s-table-cell>
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

          {(pageInfo.hasPreviousPage || pageInfo.hasNextPage) && (
            <s-stack direction="inline" gap="base">
              <s-button
                {...(pageInfo.hasPreviousPage && !isLoading
                  ? {}
                  : { disabled: true })}
                onClick={() => goToPage("previous")}
              >
                Previous
              </s-button>
              <s-button
                {...(pageInfo.hasNextPage && !isLoading
                  ? {}
                  : { disabled: true })}
                onClick={() => goToPage("next")}
              >
                Next
              </s-button>
            </s-stack>
          )}

          <s-text color="subdued">
            Usage can take a few minutes to update after an order.
          </s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
