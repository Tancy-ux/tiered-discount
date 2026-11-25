/* eslint-disable react/prop-types */
// Editable list of tiers (cart subtotal threshold + discount %).
// Used for the shop's default tiers, one code's custom tiers, and bulk create.

/** True when a typed discount is outside 0-100%. Blank counts as fine (saved as 0). */
export function isBadPercentage(value) {
  if (value === "" || value == null) return false;
  const number = Number(value);
  return !Number.isFinite(number) || number < 0 || number > 100;
}

/** True when this tier's cart subtotal is already used by an earlier tier. */
export function isDuplicateSubtotal(tiers, index) {
  const amount = Number(tiers[index].minSubtotal) || 0;
  return tiers
    .slice(0, index)
    .some((tier) => (Number(tier.minSubtotal) || 0) === amount);
}

/** True when any tier is invalid, so saving is blocked. */
export function hasBadTiers(tiers) {
  return tiers.some(
    (tier, index) =>
      isBadPercentage(tier.percentage) || isDuplicateSubtotal(tiers, index),
  );
}

export function TierEditor({ tiers, onChange, disabled = false }) {
  const handleTierChange = (index, field, value) => {
    onChange(
      tiers.map((tier, i) => (i === index ? { ...tier, [field]: value } : tier)),
    );
  };

  const handleRemoveTier = (index) => {
    onChange(tiers.filter((_, i) => i !== index));
  };

  const handleAddTier = () => {
    onChange([...tiers, { minSubtotal: 0, percentage: 0 }]);
  };

  return (
    <s-stack direction="block" gap="base">
      {tiers.map((tier, index) => (
        <s-stack direction="inline" gap="base" alignItems="end" key={index}>
          <s-number-field
            label="Cart subtotal at or above"
            min={0}
            {...(disabled ? { disabled: true } : {})}
            {...(!disabled && isDuplicateSubtotal(tiers, index)
              ? { error: "Another tier already uses this amount" }
              : {})}
            value={String(tier.minSubtotal)}
            onInput={(event) =>
              handleTierChange(index, "minSubtotal", event.currentTarget.value)
            }
          ></s-number-field>
          <s-number-field
            label="Discount %"
            min={0}
            max={100}
            suffix="%"
            {...(disabled ? { disabled: true } : {})}
            {...(isBadPercentage(tier.percentage)
              ? { error: "Enter a discount between 0 and 100%" }
              : {})}
            value={String(tier.percentage)}
            onInput={(event) =>
              handleTierChange(index, "percentage", event.currentTarget.value)
            }
          ></s-number-field>
          {!disabled && (
            <s-button variant="tertiary" onClick={() => handleRemoveTier(index)}>
              Remove
            </s-button>
          )}
        </s-stack>
      ))}

      {!disabled && (
        <s-stack direction="inline" gap="base">
          <s-button variant="secondary" onClick={handleAddTier}>
            Add tier
          </s-button>
        </s-stack>
      )}
    </s-stack>
  );
}
