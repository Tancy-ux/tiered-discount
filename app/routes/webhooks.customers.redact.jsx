import { authenticate } from "../shopify.server";
import { removeCustomerFromLocks } from "../discount-metafields.server";

// Mandatory GDPR webhook. The app's own database holds no customer data. The
// only customer data the app keeps is the customer ID saved on a
// customer-specific code (discount metafield tiered_discount.customer_id), so
// erasing a customer means taking their ID off every code.
export const action = async ({ request }) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const customerId = payload?.customer?.id;
  // admin is only available while the app is installed (it has a session).
  if (admin && customerId) {
    try {
      const changed = await removeCustomerFromLocks(
        admin,
        `gid://shopify/Customer/${customerId}`,
      );
      console.log(`customers/redact: removed customer from ${changed} code(s) on ${shop}`);
    } catch (error) {
      console.error(`customers/redact: couldn't update codes on ${shop}`, error);
    }
  }

  return new Response();
};
