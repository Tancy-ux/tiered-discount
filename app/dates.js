// Date helpers for start/end dates, in the shop's own time zone.
// A code's start date begins at 00:00 and its end date lasts until 23:59:59
// in the shop's time zone, matching what the merchant picked.

function safeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

/** How far the zone is ahead of UTC at a given instant, in ms. */
function zoneOffsetMs(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(timestamp));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(timestamp / 1000) * 1000;
}

/**
 * "2026-11-30" in the shop's zone → ISO instant.
 * @param {boolean} endOfDay true for 23:59:59 (end dates), false for 00:00
 */
export function shopDateToIso(dateString, timeZone, endOfDay = false) {
  const zone = safeZone(timeZone);
  const [year, month, day] = dateString.split("-").map(Number);
  const wallClock = endOfDay
    ? Date.UTC(year, month - 1, day, 23, 59, 59)
    : Date.UTC(year, month - 1, day, 0, 0, 0);
  // Two passes so dates next to a daylight-saving change land correctly.
  let instant = wallClock - zoneOffsetMs(wallClock, zone);
  instant = wallClock - zoneOffsetMs(instant, zone);
  return new Date(instant).toISOString();
}

/** ISO instant → "2026-11-30" as the date in the shop's zone. */
export function isoToShopDate(isoString, timeZone) {
  if (!isoString) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: safeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(isoString));
}
