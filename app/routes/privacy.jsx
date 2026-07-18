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
      <h1>Privacy Policy - Tiered Order Discount</h1>
      <p>Last updated: {new Date().toISOString().slice(0, 10)}</p>

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
        deleted. Because customer data is never persisted by this app outside of
        Shopify, there is no separate customer data to erase on request beyond
        what Shopify itself already manages.
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
