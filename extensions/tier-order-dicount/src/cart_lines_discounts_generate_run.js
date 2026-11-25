// @ts-check

/**
 * Entry point for cart.lines.discounts.generate.run.
 *
 * Behaviour (per the brief):
 *  - One function, reused across every discount code we issue (WARE-PRIYA,
 *    WARE-RIMA, ...). The function doesn't care *which* code triggered it —
 *    any code attached to this function in the Discounts admin inherits the
 *    same tiered logic automatically.
 *  - Discount class: ORDER. Applies to the entire order subtotal, no
 *    exclusions, no product-level filtering.
 *  - Code-triggered only. That's controlled by how the discount is created
 *    in the admin (Method: "Discount code"), not by anything in this file —
 *    but since this function only ever emits Order-class discounts and never
 *    checks `automaticDiscount`-only fields, it behaves correctly either way
 *    as long as you always create it as a code discount (see README).
 *  - Tier thresholds are in the shop currency. Carts in another currency are
 *    converted back with presentmentCurrencyRate before picking a tier.
 *  - Tier thresholds/percentages are read from a shop metafield so they can
 *    be changed later without redeploying the function. If the metafield is
 *    missing or malformed, we fall back to the thresholds from the brief.
 */

/** @typedef {{ minSubtotal: number, percentage: number }} Tier */

/** @type {Tier[]} */
const DEFAULT_TIERS = [
  { minSubtotal: 0, percentage: 5 }, // Below ₹50,000
  { minSubtotal: 50000, percentage: 7.5 }, // ₹50,000 – ₹2,99,999
  { minSubtotal: 300000, percentage: 10 }, // ₹3,00,000 and above
];

/**
 * @param {import("../generated/api").CartLinesDiscountsGenerateRunInput} input
 * @returns {import("../generated/api").CartLinesDiscountsGenerateRunResult}
 */
export function cartLinesDiscountsGenerateRun(input) {
  const hasOrderDiscountClass = input.discount.discountClasses.includes(
    "ORDER",
  );

  if (!hasOrderDiscountClass) {
    return { operations: [] };
  }

  // Customer-specific codes: only the assigned customer, signed in, gets the
  // discount. Logged-out shoppers and other customers get nothing.
  const lockedTo = (input.discount.customerLock?.value ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (lockedTo.length > 0) {
    const buyerId = input.cart.buyerIdentity?.customer?.id;
    if (!buyerId || !lockedTo.includes(buyerId)) {
      return { operations: [] };
    }
  }

  // The subtotal is in the currency the buyer sees at checkout; tier amounts
  // are in the shop currency. Convert back so every currency gets the same
  // tier (presentment amount = shop amount × rate).
  const rate = Number(input.presentmentCurrencyRate);
  const subtotal =
    Number(input.cart.cost.subtotalAmount.amount) /
    (Number.isFinite(rate) && rate > 0 ? rate : 1);
  if (!Number.isFinite(subtotal)) {
    return { operations: [] };
  }

  // This code's own tiers win; otherwise the shop's default tiers.
  const tiers =
    parseTiers(input.discount.codeTiers?.value) ??
    parseTiers(input.shop?.metafield?.value) ??
    DEFAULT_TIERS;
  const tier = pickTier(tiers, subtotal);

  if (!tier || tier.percentage <= 0) {
    return { operations: [] };
  }

  return {
    operations: [
      {
        orderDiscountsAdd: {
          selectionStrategy: "FIRST",
          candidates: [
            {
              message: `${formatPercentage(tier.percentage)}% off your order`,
              targets: [
                {
                  orderSubtotal: {
                    // Applies to the entire order subtotal — no exclusions,
                    // no product carve-outs, per the brief.
                    excludedCartLineIds: [],
                  },
                },
              ],
              value: {
                percentage: {
                  value: formatPercentage(tier.percentage),
                },
              },
            },
          ],
        },
      },
    ],
  };
}

/**
 * Parses and validates the shop metafield JSON into a sorted tier list.
 * Expected shape:
 *   {
 *     "tiers": [
 *       { "minSubtotal": 0,      "percentage": 5 },
 *       { "minSubtotal": 50000,  "percentage": 7.5 },
 *       { "minSubtotal": 300000, "percentage": 10 }
 *     ]
 *   }
 * @param {string | undefined | null} raw
 * @returns {Tier[] | null}
 */
function parseTiers(raw) {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    const tiers = parsed?.tiers;
    if (!Array.isArray(tiers) || tiers.length === 0) return null;

    const cleaned = tiers
      .map((t) => ({
        minSubtotal: Number(t?.minSubtotal),
        percentage: Number(t?.percentage),
      }))
      .filter(
        (t) =>
          Number.isFinite(t.minSubtotal) &&
          Number.isFinite(t.percentage) &&
          t.minSubtotal >= 0 &&
          t.percentage >= 0 &&
          t.percentage <= 100,
      )
      .sort((a, b) => a.minSubtotal - b.minSubtotal);

    return cleaned.length > 0 ? cleaned : null;
  } catch {
    // Malformed JSON in the metafield — fall back to defaults rather than
    // failing the whole discount calculation.
    return null;
  }
}

/**
 * Picks the highest tier whose minSubtotal the cart subtotal has reached.
 * Tiers must be sorted ascending by minSubtotal.
 * @param {Tier[]} tiers
 * @param {number} subtotal
 * @returns {Tier | null}
 */
function pickTier(tiers, subtotal) {
  let selected = null;
  for (const tier of tiers) {
    if (subtotal >= tier.minSubtotal) {
      selected = tier;
    } else {
      break;
    }
  }
  return selected;
}

/**
 * Trims trailing zeros so "5" stays "5" and "7.5" stays "7.5" (rather than
 * "5.00" / "7.50"), while still handling floating point safely.
 * @param {number} value
 */
function formatPercentage(value) {
  return String(Math.round(value * 100) / 100);
}