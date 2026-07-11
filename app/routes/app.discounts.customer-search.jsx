import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const term = url.searchParams.get("q")?.trim() ?? "";

  if (term.length < 2) {
    return { customers: [] };
  }

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

  return {
    customers: data.customers.nodes.map((customer) => ({
      id: customer.id,
      displayName: customer.displayName,
      email: customer.defaultEmailAddress?.emailAddress ?? null,
    })),
  };
};
