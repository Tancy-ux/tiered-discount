// Code pages used to live at /app/discount/... and now live under
// /app/discounts/... (so the app menu highlights "Discount codes"). Old links,
// such as those from Shopify's Discounts list before the extension's new paths
// are released, are sent to the new address.
import { redirect } from "react-router";

export const loader = ({ request, params }) => {
  const url = new URL(request.url);
  return redirect(`/app/discounts/${params["*"] ?? ""}${url.search}`);
};
