import { useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

function legacyId(gid) {
  return gid.split("/").pop();
}

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
      query ExistingDiscountCodes {
        discountNodes(first: 50, reverse: true, query: "method:code type:app") {
          nodes {
            id
            discount {
              __typename
              ... on DiscountCodeApp {
                title
                status
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
  );
  const { data } = await response.json();

  const tieredFunction =
    data.shopifyFunctions.nodes.find((node) => node.title === "Tiered order discount") ??
    data.shopifyFunctions.nodes[0];

  const codes = data.discountNodes.nodes
    .filter((node) => node.discount.__typename === "DiscountCodeApp")
    .map((node) => {
      const discount = node.discount;
      return {
        id: legacyId(node.id),
        code: discount.codes.nodes[0]?.code ?? discount.title,
        status: discount.status,
        customerName: discount.context?.customers?.[0]?.displayName ?? "Any customer",
      };
    });

  return { codes, functionId: tieredFunction ? legacyId(tieredFunction.id) : null };
};

export default function Discounts() {
  const { codes, functionId } = useLoaderData();
  const shopify = useAppBridge();

  const handleCopy = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      shopify.toast.show("Code copied");
    } catch {
      shopify.toast.show("Couldn't copy code", { isError: true });
    }
  };

  return (
    <s-page heading="Discount codes">
      <s-link slot="breadcrumb-actions" href="/app">
        Home
      </s-link>

      <s-section heading="Existing codes">
        <s-paragraph>
          Need a new one? <s-link href="/app">Create a discount code</s-link>
        </s-paragraph>

        {!codes || codes.length === 0 ? (
          <s-paragraph>No discount codes created yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Code</s-table-header>
              <s-table-header>Customer</s-table-header>
              <s-table-header>Status</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {codes.map((row) => (
                <s-table-row key={row.id}>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-300" alignItems="center">
                      {functionId ? (
                        <s-link href={`/app/discount/${functionId}/${row.id}`}>
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
                  <s-table-cell>{row.status}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
