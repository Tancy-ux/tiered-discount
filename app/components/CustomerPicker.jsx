/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

/** Customer search and chosen customer. `badge`: optional label shown beside a chosen customer. */
export function CustomerPicker({ value, onChange, badge }) {
  const searchFetcher = useFetcher();
  const [searchTerm, setSearchTerm] = useState("");
  const searchResults = searchFetcher.data?.customers ?? [];

  useEffect(() => {
    if (searchTerm.trim().length < 2) return undefined;
    const timeout = setTimeout(() => {
      searchFetcher.load(
        `/app/discounts/customer-search?q=${encodeURIComponent(searchTerm.trim())}`,
      );
    }, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm]);

  if (value) {
    return (
      <s-box padding="base" borderWidth="base" borderRadius="base">
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-stack direction="block" gap="small-300">
            <s-text type="strong">{value.displayName}</s-text>
            {value.email && <s-text color="subdued">{value.email}</s-text>}
          </s-stack>
          {badge && <s-badge icon="lock">{badge}</s-badge>}
          <s-button
            variant="tertiary"
            accessibilityLabel={`Remove ${value.displayName}`}
            onClick={() => onChange(null)}
          >
            Remove
          </s-button>
        </s-stack>
      </s-box>
    );
  }

  return (
    <s-stack direction="block" gap="small-300">
      <s-search-field
        label="Customer"
        placeholder="Search by name or email"
        value={searchTerm}
        onInput={(event) => setSearchTerm(event.currentTarget.value)}
      ></s-search-field>
      {searchTerm.trim().length >= 2 && (
        <s-box borderWidth="base" borderRadius="base">
          {searchResults.length === 0 ? (
            <s-box padding="base">
              <s-text color="subdued">
                {searchFetcher.state === "idle"
                  ? "No matching customers"
                  : "Searching…"}
              </s-text>
            </s-box>
          ) : (
            <s-stack direction="block" gap="none">
              {searchResults.map((customer) => (
                <s-clickable
                  key={customer.id}
                  padding="base"
                  onClick={() => {
                    onChange(customer);
                    setSearchTerm("");
                  }}
                >
                  <s-stack direction="block" gap="small-300">
                    <s-text>{customer.displayName}</s-text>
                    {customer.email && (
                      <s-text color="subdued">{customer.email}</s-text>
                    )}
                  </s-stack>
                </s-clickable>
              ))}
            </s-stack>
          )}
        </s-box>
      )}
    </s-stack>
  );
}
