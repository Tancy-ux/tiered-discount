/* eslint-disable react/prop-types */
// Tier editing (cart subtotal threshold + discount %) and a compact read-only
// tier list. Used for the shop's default tiers, one code's custom tiers, and
// bulk create.
import { formatMoney, tiersForSubmit } from "../tiers";

const isBlank = (value) => value === "" || value == null;

/** Error for a typed discount, or null when it's fine. */
export function percentageError(value) {
  if (isBlank(value)) return "Enter a discount";
  const number = Number(value);
  return !Number.isFinite(number) || number < 0 || number > 100
    ? "Enter 0 to 100%"
    : null;
}

/** Error for a typed cart subtotal, or null when it's fine. */
export function amountError(tiers, index) {
  const value = tiers[index].minSubtotal;
  if (isBlank(value)) return "Enter an amount";
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return "Enter 0 or more";
  const usedEarlier = tiers
    .slice(0, index)
    .some((tier) => !isBlank(tier.minSubtotal) && Number(tier.minSubtotal) === amount);
  return usedEarlier ? "Another tier uses this amount" : null;
}

/** True when any tier is invalid, so saving is blocked. */
export function hasBadTiers(tiers) {
  return tiers.some(
    (tier, index) => percentageError(tier.percentage) || amountError(tiers, index),
  );
}

export function TierEditor({ tiers, onChange, currencyCode }) {
  const handleTierChange = (index, field, value) => {
    onChange(
      tiers.map((tier, i) => (i === index ? { ...tier, [field]: value } : tier)),
    );
  };

  return (
    <s-stack direction="block" gap="small-200">
      {tiers.map((tier, index) => {
        // Column labels only on the first row keeps the list short; later
        // rows keep them for screen readers.
        const labelVisibility = index === 0 ? "visible" : "exclusive";
        const amountProblem = amountError(tiers, index);
        const percentageProblem = percentageError(tier.percentage);
        return (
          <s-grid
            key={index}
            gridTemplateColumns="1fr 1fr auto"
            gap="small-200"
            alignItems="end"
          >
            <s-number-field
              label="Cart subtotal from"
              labelAccessibilityVisibility={labelVisibility}
              min={0}
              {...(currencyCode ? { prefix: currencyCode } : {})}
              {...(amountProblem ? { error: amountProblem } : {})}
              value={String(tier.minSubtotal)}
              onInput={(event) =>
                handleTierChange(index, "minSubtotal", event.currentTarget.value)
              }
            ></s-number-field>
            <s-number-field
              label="Discount"
              labelAccessibilityVisibility={labelVisibility}
              min={0}
              max={100}
              suffix="%"
              {...(percentageProblem ? { error: percentageProblem } : {})}
              value={String(tier.percentage)}
              onInput={(event) =>
                handleTierChange(index, "percentage", event.currentTarget.value)
              }
            ></s-number-field>
            <s-button
              variant="tertiary"
              icon="delete"
              accessibilityLabel={`Remove tier ${index + 1}`}
              onClick={() => onChange(tiers.filter((_, i) => i !== index))}
            ></s-button>
          </s-grid>
        );
      })}

      <s-stack direction="inline">
        <s-button
          variant="tertiary"
          icon="plus"
          onClick={() =>
            onChange([...tiers, { minSubtotal: "", percentage: "" }])
          }
        >
          Add tier
        </s-button>
      </s-stack>
    </s-stack>
  );
}

/** Read-only tiers: "₹50,000 and up → 7.5% off", one line each. */
export function TierSummary({ tiers, currencyCode }) {
  const sorted = tiersForSubmit(tiers).sort((a, b) => a.minSubtotal - b.minSubtotal);
  return (
    <s-stack direction="block" gap="small-300">
      {sorted.map((tier, index) => (
        <s-stack
          key={index}
          direction="inline"
          gap="small-200"
          justifyContent="space-between"
          alignItems="center"
        >
          <s-text color="subdued">
            {tier.minSubtotal === 0
              ? "Any order"
              : `${formatMoney(tier.minSubtotal, currencyCode)} and up`}
          </s-text>
          <s-badge>{`${tier.percentage}% off`}</s-badge>
        </s-stack>
      ))}
    </s-stack>
  );
}
