// Any /app/... address that doesn't match a page: a proper page inside the
// admin with a way back, instead of a bare "404 Not Found".
import { data } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return data(null, { status: 404 });
};

export default function NotFound() {
  return (
    <s-page heading="Page not found">
      <s-section>
        <s-stack direction="block" gap="base">
          <s-paragraph>
            This page doesn&apos;t exist. The link may be old or mistyped.
          </s-paragraph>
          <s-stack direction="inline" gap="base">
            <s-button variant="primary" href="/app">
              Go to Home
            </s-button>
            <s-button href="/app/discounts">See discount codes</s-button>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
