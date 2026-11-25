/* eslint-disable react/prop-types */
// Which other discounts a tiered code can be used together with.

export const DEFAULT_COMBINES = { order: false, product: false, shipping: true };

/** Shape Shopify's DiscountCombinesWithInput expects. */
export function combinesWithInput(value) {
  return {
    orderDiscounts: value.order,
    productDiscounts: value.product,
    shippingDiscounts: value.shipping,
  };
}

/** Reads the three combine flags sent by CombineOptions forms. */
export function readCombines(formData) {
  return {
    order: formData.get("combinesWithOrder") === "true",
    product: formData.get("combinesWithProduct") === "true",
    shipping: formData.get("combinesWithShipping") === "true",
  };
}

/** Form fields for fetcher.submit. */
export function combinesFormFields(value) {
  return {
    combinesWithOrder: String(value.order),
    combinesWithProduct: String(value.product),
    combinesWithShipping: String(value.shipping),
  };
}

export function sameCombines(a, b) {
  return a.order === b.order && a.product === b.product && a.shipping === b.shipping;
}

export function CombineOptions({ value, onChange }) {
  const box = (key, label) => (
    <s-checkbox
      label={label}
      {...(value[key] ? { checked: true } : {})}
      onChange={(event) =>
        onChange({ ...value, [key]: event.currentTarget.checked })
      }
    ></s-checkbox>
  );

  return (
    <s-stack direction="block" gap="small-300">
      <s-text type="strong">Combines with</s-text>
      {box("product", "Product discounts")}
      {box("order", "Other order discounts")}
      {box("shipping", "Shipping discounts")}
      <s-text color="subdued">
        The other discount must also allow combining with order discounts.
      </s-text>
    </s-stack>
  );
}
