// Tier helpers shared by the admin pages (server and browser).

/** Built-in fallback when the shop has no default tiers saved. */
export const DEFAULT_TIERS = [
  { minSubtotal: 0, percentage: 5 },
  { minSubtotal: 50000, percentage: 7.5 },
  { minSubtotal: 300000, percentage: 10 },
];

/** Discounts above this ask the merchant to confirm before saving. */
export const LARGE_DISCOUNT_PERCENT = 30;

/**
 * Reads a saved tiers metafield value ({"tiers":[...]}).
 * @returns {{minSubtotal:number, percentage:number}[] | null} null when missing or unreadable
 */
export function readTiers(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed.tiers) && parsed.tiers.length > 0
      ? parsed.tiers
      : null;
  } catch {
    return null;
  }
}

/** Turns form values into numbers, ready to send. */
export function tiersForSubmit(tiers) {
  return tiers.map((tier) => ({
    minSubtotal: Number(tier.minSubtotal) || 0,
    percentage: Number(tier.percentage) || 0,
  }));
}

/**
 * Formats an amount in the shop's currency. A fixed locale keeps the server
 * and browser output identical (Indian digit grouping for INR).
 */
export function formatMoney(amount, currencyCode) {
  const number = Number(amount) || 0;
  try {
    return new Intl.NumberFormat(currencyCode === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency: currencyCode || "INR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(number);
  } catch {
    return `${currencyCode ?? ""} ${number}`.trim();
  }
}

/** "5% under ₹50,000 · 7.5% from ₹50,000 · 10% from ₹3,00,000" */
export function describeTiers(tiers, currencyCode) {
  const sorted = tiersForSubmit(tiers).sort(
    (a, b) => a.minSubtotal - b.minSubtotal,
  );
  return sorted
    .map((tier, index) => {
      const next = sorted[index + 1];
      if (tier.minSubtotal === 0 && next) {
        return `${tier.percentage}% under ${formatMoney(next.minSubtotal, currencyCode)}`;
      }
      if (tier.minSubtotal === 0) return `${tier.percentage}% on every order`;
      return `${tier.percentage}% from ${formatMoney(tier.minSubtotal, currencyCode)}`;
    })
    .join(" · ");
}

/** True when any tier gives more than LARGE_DISCOUNT_PERCENT off. */
export function hasLargeDiscount(tiers) {
  return tiersForSubmit(tiers).some(
    (tier) => tier.percentage > LARGE_DISCOUNT_PERCENT,
  );
}

/** Asks the merchant to confirm unusually large discounts. Browser only. */
export function confirmLargeDiscount(tiers) {
  if (!hasLargeDiscount(tiers)) return true;
  const largest = Math.max(...tiersForSubmit(tiers).map((t) => t.percentage));
  return window.confirm(
    `One tier gives ${largest}% off. That's more than ${LARGE_DISCOUNT_PERCENT}%. Save it anyway?`,
  );
}
