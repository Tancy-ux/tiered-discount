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
  // Whole amounts without decimals (₹5,000); anything else with two (₹99.90),
  // never one.
  const rounded = Math.round(number * 100) / 100;
  const digits = Number.isInteger(rounded) ? 0 : 2;
  try {
    return new Intl.NumberFormat(currencyCode === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency: currencyCode || "INR",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(rounded);
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

/** Text for the large-discount confirmation modal. */
export function largeDiscountText(tiers) {
  const largest = Math.max(
    0,
    ...tiersForSubmit(tiers).map((t) => t.percentage),
  );
  return `One tier gives ${largest}% off, which is more than ${LARGE_DISCOUNT_PERCENT}%. Check it isn't a typo (like 50 instead of 5) before saving.`;
}

/** Shopify discount status → label, badge tone and icon for the admin pages. */
export function statusBadge(status) {
  switch (status) {
    case "ACTIVE":
      return { label: "Active", tone: "success", icon: "status-active" };
    case "SCHEDULED":
      return { label: "Scheduled", tone: "caution", icon: "clock" };
    case "EXPIRED":
      return {
        label: "Paused or ended",
        tone: "neutral",
        icon: "pause-circle",
      };
    default:
      return { label: status ?? "Unknown", tone: "neutral", icon: "status" };
  }
}

/**
 * The tier a cart amount reaches, what it saves, and how far the next tier is.
 * @returns {{ tier: {minSubtotal:number, percentage:number} | null, saving: number,
 *   next: {minSubtotal:number, percentage:number} | null, toNext: number }}
 */
export function tierForAmount(tiers, amount) {
  const sorted = tiersForSubmit(tiers).sort(
    (a, b) => a.minSubtotal - b.minSubtotal,
  );
  const value = Number(amount) || 0;
  let tier = null;
  for (const candidate of sorted) {
    if (value >= candidate.minSubtotal) tier = candidate;
  }
  const next =
    sorted.find((candidate) => candidate.minSubtotal > value) ?? null;
  return {
    tier,
    saving: tier ? Math.round(value * tier.percentage) / 100 : 0,
    next,
    toNext: next ? next.minSubtotal - value : 0,
  };
}
