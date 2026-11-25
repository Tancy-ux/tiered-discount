import { authenticate } from "../shopify.server";

// Mandatory GDPR webhook. The app's own database holds no customer data. The
// only customer data the app keeps is the customer ID on a customer-specific
// code, stored in the merchant's own store (discount metafield
// tiered_discount.customer_id) where the merchant can already see it, so
// there's nothing extra to compile — just acknowledge the request.
export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  return new Response();
};
