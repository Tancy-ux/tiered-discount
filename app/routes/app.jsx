import { useEffect } from "react";
import {
  Outlet,
  useLoaderData,
  useNavigation,
  useRouteError,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

// Shows Shopify's loading bar at the top of the admin while the app moves to
// another page, so slower pages respond straight away.
function NavigationLoading() {
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const isLoading = navigation.state !== "idle";
  useEffect(() => {
    shopify.loading(isLoading);
  }, [isLoading, shopify]);
  return null;
}

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/discounts">Discount codes</s-link>
        <s-link href="/app/bulk-create">Bulk create</s-link>
        <s-link href="/app/settings">Settings</s-link>
      </s-app-nav>
      <NavigationLoading />
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
