import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { CustomerPicker } from "../components/CustomerPicker";

const FUNCTION_HANDLE = "tiered-order-discount";

function suggestCode(displayName) {
  const firstName = (displayName ?? "").trim().split(/\s+/)[0] ?? "";
  const cleaned = firstName.replace(/[^a-zA-Z]/g, "").toUpperCase();
  return cleaned ? `WARE-${cleaned}` : "";
}

function legacyId(gid) {
  return gid.split("/").pop();
}

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
      query DiscountStats {
        discountNodes(first: 50, query: "method:code type:app") {
          nodes {
            discount {
              __typename
              ... on DiscountCodeApp {
                status
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

  const codes = data.discountNodes.nodes.filter(
    (node) => node.discount.__typename === "DiscountCodeApp",
  );

  const tieredFunction =
    data.shopifyFunctions.nodes.find((node) => node.title === "Tiered order discount") ??
    data.shopifyFunctions.nodes[0];

  return {
    totalCodes: codes.length,
    activeCodes: codes.filter((node) => node.discount.status === "ACTIVE")
      .length,
    functionId: tieredFunction ? legacyId(tieredFunction.id) : null,
  };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const formData = await request.formData();
  const code = formData.get("code")?.toString().trim() ?? "";
  const customerId = formData.get("customerId")?.toString().trim() ?? "";

  if (!code || !customerId) {
    return { ok: false, error: "Pick a customer and enter a code." };
  }

  const response = await admin.graphql(
    `#graphql
      mutation CreateCustomerCode($discount: DiscountCodeAppInput!) {
        discountCodeAppCreate(codeAppDiscount: $discount) {
          codeAppDiscount {
            discountId
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
          context: { customers: { add: [customerId] } },
        },
      },
    },
  );
  const { data } = await response.json();
  const userErrors = data?.discountCodeAppCreate?.userErrors ?? [];

  if (userErrors.length > 0) {
    return { ok: false, error: userErrors.map((e) => e.message).join(" ") };
  }

  return {
    ok: true,
    id: legacyId(data.discountCodeAppCreate.codeAppDiscount.discountId),
    title: data.discountCodeAppCreate.codeAppDiscount.title,
  };
};

export default function Home() {
  const { totalCodes, activeCodes, functionId } = useLoaderData();
  const createFetcher = useFetcher();
  const shopify = useAppBridge();
  const navigate = useNavigate();

  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [code, setCode] = useState("");

  const isSaving = createFetcher.state !== "idle";

  useEffect(() => {
    if (createFetcher.data?.ok) {
      shopify.toast.show("Discount code created");
      if (functionId && createFetcher.data.id) {
        navigate(`/app/discount/${functionId}/${createFetcher.data.id}`);
      } else {
        setCode("");
        setSelectedCustomer(null);
      }
    }
  }, [createFetcher.data, shopify, functionId, navigate]);

  const handleSelectCustomer = (customer) => {
    setSelectedCustomer(customer);
    if (customer && !code.trim()) {
      setCode(suggestCode(customer.displayName));
    }
  };

  const handleSave = () => {
    if (!selectedCustomer || !code.trim() || isSaving) return;
    createFetcher.submit(
      { code: code.trim(), customerId: selectedCustomer.id },
      { method: "post" },
    );
  };

  return (
    <s-page heading="Tiered order discount">
      <s-banner tone="info" heading="Tiered Order Discounts">
        <s-paragraph>
          Every code you create here gets the same automatic tiered discount: 5%
          under ₹50,000, 7.5% from ₹50,000 – ₹2,99,999, and 10% from ₹3,00,000
          up — applied at checkout, no extra setup. Just pick a customer and
          save.
        </s-paragraph>
      </s-banner>

      <s-section heading="Create a discount code">
        {createFetcher.data?.ok === false && (
          <s-banner tone="critical" heading="Couldn't create the code">
            <s-paragraph>{createFetcher.data.error}</s-paragraph>
          </s-banner>
        )}

        <s-stack direction="block" gap="base">
          <CustomerPicker
            value={selectedCustomer}
            onChange={handleSelectCustomer}
          />

          <s-text-field
            label="Discount code"
            value={code}
            onInput={(event) =>
              setCode(event.currentTarget.value.toUpperCase())
            }
          ></s-text-field>

          <s-button
            variant="primary"
            {...(!selectedCustomer || !code.trim() || isSaving
              ? { disabled: true }
              : {})}
            {...(isSaving ? { loading: true } : {})}
            onClick={handleSave}
          >
            Save
          </s-button>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Overview">
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small-300">
              <s-text tone="subdued">Active codes</s-text>
              <s-heading>{activeCodes}</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small-300">
              <s-text tone="subdued">Total codes created</s-text>
              <s-heading>{totalCodes}</s-heading>
            </s-stack>
          </s-box>
          <s-link href="/app/discounts">View all codes →</s-link>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
