import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const term = url.searchParams.get("q")?.trim() ?? "";

  if (term.length < 2) {
    return { customers: [] };
  }

  // A failed search (e.g. Shopify refusing customer data) must only affect
  // the search box, never take the whole page down.
  try {
    return await searchCustomers(admin, term);
  } catch (error) {
    console.error("Customer search failed", error);
    return { customers: [], error: true };
  }
};

async function searchCustomers(admin, term) {
  const response = await admin.graphql(
    `#graphql
      query SearchCustomers($query: String!) {
        customers(first: 10, query: $query) {
          nodes {
            id
            displayName
            defaultEmailAddress {
              emailAddress
            }
          }
        }
      }`,
    { variables: { query: term } },
  );
  const { data } = await response.json();
  if (!data?.customers) return { customers: [], error: true };

  return {
    customers: data.customers.nodes.map((customer) => ({
      id: customer.id,
      displayName: customer.displayName,
      email: customer.defaultEmailAddress?.emailAddress ?? null,
    })),
  };
}
