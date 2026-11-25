/* eslint-disable react/prop-types */
// Tier editing (cart subtotal threshold + discount %) and a compact read-only
// tier list. Used for the shop's default tiers, one code's custom tiers, and
// bulk create.
import { useState } from "react";
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

/**
 * Errors for every row's cart subtotal (null when fine). When two rows use
 * the same amount, the error goes on the row the merchant just edited, or
 * on the later row(s) when neither was edited.
 * @param {number | null} lastEdited index of the row edited last
 */
export function amountErrors(tiers, lastEdited = null) {
  const errors = tiers.map((tier) => {
    if (isBlank(tier.minSubtotal)) return "Enter an amount";
    const amount = Number(tier.minSubtotal);
    return !Number.isFinite(amount) || amount < 0 ? "Enter 0 or more" : null;
  });
  const rowsByAmount = new Map();
  tiers.forEach((tier, index) => {
    if (errors[index]) return;
    const key = Number(tier.minSubtotal);
    rowsByAmount.set(key, [...(rowsByAmount.get(key) ?? []), index]);
  });
  for (const rows of rowsByAmount.values()) {
    if (rows.length < 2) continue;
    const blamed = rows.includes(lastEdited) ? [lastEdited] : rows.slice(1);
    for (const index of blamed) errors[index] = "Another tier uses this amount";
  }
  return errors;
}

/** True when any tier is invalid, so saving is blocked. */
export function hasBadTiers(tiers) {
  return (
    tiers.some((tier) => percentageError(tier.percentage)) ||
    amountErrors(tiers).some(Boolean)
  );
}

/**
 * Warnings (not blocking) for tiers that give less than a smaller cart gets,
 * e.g. "₹50,000 and up gives 2%, less than the 5% smaller carts get."
 */
export function tierOrderWarnings(tiers, currencyCode) {
  const problems = amountErrors(tiers);
  const valid = tiers.filter(
    (tier, index) => !percentageError(tier.percentage) && !problems[index],
  );
  const sorted = tiersForSubmit(valid).sort(
    (a, b) => a.minSubtotal - b.minSubtotal,
  );
  const warnings = [];
  let best = null;
  for (const tier of sorted) {
    if (best && tier.percentage < best.percentage) {
      const where =
        tier.minSubtotal === 0
          ? "Any order"
          : `${formatMoney(tier.minSubtotal, currencyCode)} and up`;
      warnings.push(
        `${where} gives ${tier.percentage}%, less than the ${best.percentage}% smaller carts get. Customers who spend more would save less.`,
      );
    }
    if (!best || tier.percentage > best.percentage) best = tier;
  }
  return warnings;
}

export function TierEditor({ tiers, onChange, currencyCode }) {
  const [lastEdited, setLastEdited] = useState(null);
  const amountProblems = amountErrors(tiers, lastEdited);
  const warnings = tierOrderWarnings(tiers, currencyCode);

  const handleTierChange = (index, field, value) => {
    setLastEdited(index);
    onChange(
      tiers.map((tier, i) =>
        i === index ? { ...tier, [field]: value } : tier,
      ),
    );
  };

  const handleRemove = (index) => {
    setLastEdited(null);
    onChange(tiers.filter((_, i) => i !== index));
  };

  // Column headings sit in their own row, so every row of fields lines up
  // the same way even when one field shows an error underneath.
  const columns = "1fr 1fr 2.5rem";

  return (
    <s-stack direction="block" gap="small-200">
      {tiers.length > 0 && (
        <s-grid gridTemplateColumns={columns} gap="small-200">
          <s-text type="strong">Cart subtotal from</s-text>
          <s-text type="strong">Discount</s-text>
          <s-box></s-box>
        </s-grid>
      )}

      {tiers.map((tier, index) => {
        const percentageProblem = percentageError(tier.percentage);
        return (
          <s-grid
            key={index}
            gridTemplateColumns={columns}
            gap="small-200"
            alignItems="start"
          >
            <s-number-field
              label={`Cart subtotal from, tier ${index + 1}`}
              labelAccessibilityVisibility="exclusive"
              min={0}
              {...(currencyCode ? { prefix: currencyCode } : {})}
              {...(amountProblems[index]
                ? { error: amountProblems[index] }
                : {})}
              value={String(tier.minSubtotal)}
              onInput={(event) =>
                handleTierChange(
                  index,
                  "minSubtotal",
                  event.currentTarget.value,
                )
              }
            ></s-number-field>
            <s-number-field
              label={`Discount, tier ${index + 1}`}
              labelAccessibilityVisibility="exclusive"
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
              onClick={() => handleRemove(index)}
            ></s-button>
          </s-grid>
        );
      })}

      {warnings.map((warning) => (
        <s-text key={warning} tone="caution">
          {warning}
        </s-text>
      ))}

      <s-stack direction="inline">
        <s-button
          variant="tertiary"
          icon="plus"
          onClick={() => {
            setLastEdited(tiers.length);
            onChange([...tiers, { minSubtotal: "", percentage: "" }]);
          }}
        >
          Add tier
        </s-button>
      </s-stack>
    </s-stack>
  );
}

/** Read-only tiers: "₹50,000 and up → 7.5% off", one line each. */
export function TierSummary({ tiers, currencyCode }) {
  const sorted = tiersForSubmit(tiers).sort(
    (a, b) => a.minSubtotal - b.minSubtotal,
  );
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
