// Tier helpers shared by the admin pages (server and browser).

/** Built-in fallback when the shop has no default tiers saved. */
export const DEFAULT_TIERS = [
  { minSubtotal: 0, percentage: 5 },
  { minSubtotal: 50000, percentage: 7.5 },
  { minSubtotal: 300000, percentage: 10 },
];

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
