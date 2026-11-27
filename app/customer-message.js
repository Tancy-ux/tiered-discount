// The ready-to-send message for a customer-specific code, shared by the
// Create code page (live preview) and the code page (saved code).
import { describeTiers } from "./tiers";

/** "2026-12-31" → "31 Dec 2026" */
function readableDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/**
 * @param {{ customer: {displayName?: string} | null, code: string,
 *   customTiers: object[] | null, defaultTiers: object[], currencyCode: string,
 *   endsAt: string, storeUrl: string }} details
 * @returns {string[] | null} paragraphs; null for codes open to anyone
 */
export function buildCustomerMessage(details) {
  if (!details.customer) return null;
  // Customers saved without a name have their email as display name.
  const firstWord = (details.customer.displayName ?? "").trim().split(/\s+/)[0];
  const firstName = firstWord.includes("@") ? "" : firstWord;
  const tiers = details.customTiers ?? details.defaultTiers;
  const where = details.storeUrl
    ? `at ${details.storeUrl.replace(/^https?:\/\//, "")}`
    : "on our store";
  return [
    `Hi${firstName ? ` ${firstName}` : ""}, here's your personal discount code: ${details.code}`,
    `Your discount: ${describeTiers(tiers, details.currencyCode)}.${
      details.endsAt ? ` Valid until ${readableDate(details.endsAt)}.` : ""
    }`,
    `Log in to your account ${where} before you check out. The code only works when you're logged in.`,
  ];
}
