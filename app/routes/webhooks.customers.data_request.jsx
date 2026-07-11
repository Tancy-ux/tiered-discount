import { authenticate } from "../shopify.server";

// Mandatory GDPR webhook. This app doesn't store any customer PII locally
// (discount/customer data is read live from the Admin API, never persisted),
// so there's no data to compile — just acknowledge the request.
export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  return new Response();
};
