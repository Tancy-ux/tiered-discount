export default function Privacy() {
  return (
    <div
      style={{
        maxWidth: "720px",
        margin: "0 auto",
        padding: "48px 24px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        lineHeight: 1.6,
        color: "#1a1a1a",
      }}
    >
      <h1>Privacy Policy - Ware - Tiered Discounts</h1>
      {/* Change this date whenever the policy text changes. */}
      <p>Last updated: 25 November 2026</p>

      <p>
        This app lets merchants create discount codes that apply a tiered
        percentage discount to an order, based on the cart subtotal at checkout.
        This policy explains what data the app accesses and how it&apos;s used.
      </p>

      <h2>What data this app accesses</h2>
      <ul>
        <li>
          <strong>Customer name and email</strong> - used only so a merchant can
          search for and optionally restrict a discount code to a specific
          customer. Search results are fetched live from Shopify and are not
          stored by this app.
        </li>
        <li>
          <strong>Customer ID on customer-specific codes</strong> - when a
          merchant restricts a code to a customer, that customer&apos;s Shopify
          customer ID is saved on the discount, inside the merchant&apos;s own
          Shopify store. At checkout, the discount is checked against the
          signed-in customer&apos;s ID so only that customer gets it. No name,
          email or other details are saved, and nothing leaves Shopify.
        </li>
        <li>
          <strong>Discount data</strong> - the discount codes, tiers, and
          settings the merchant creates through the app, stored in Shopify via
          Shopify&apos;s discount APIs.
        </li>
        <li>
          <strong>Shop and session data</strong> - an access token and basic
          shop information, stored so the app can stay connected to the store
          between visits. This is deleted when the app is uninstalled.
        </li>
      </ul>

      <h2>What this app does not do</h2>
      <ul>
        <li>It does not store customer personal data outside of Shopify.</li>
        <li>It does not share data with third parties.</li>
        <li>It does not use data for advertising or marketing purposes.</li>
      </ul>

      <h2>Data retention and deletion</h2>
      <p>
        When the app is uninstalled, its access token and session data are
        deleted. The app never keeps customer data outside of Shopify. When
        Shopify asks for a customer&apos;s data to be erased, the app removes
        that customer&apos;s ID from every discount code. A code that was made
        only for that customer is ended, so it can&apos;t be used by anyone.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy or how data is handled can be sent to{" "}
        <a href="mailto:tanushree@wareinnovations.com">
          tanushree@wareinnovations.com
        </a>
        .
      </p>
    </div>
  );
}
