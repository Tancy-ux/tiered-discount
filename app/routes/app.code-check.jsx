// Live check used by the create, bulk create and code pages: which of the
// given codes already exist in the store. GET ?codes=A,B&ignore=<id>
import { authenticate } from "../shopify.server";
import { findExistingCodes } from "../code-lookup.server";
import { MAX_BULK_CODES, codeFormatError, normalizeCode } from "../codes";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const codes = [
    ...new Set(
      (url.searchParams.get("codes") ?? "")
        .split(",")
        .map(normalizeCode)
        .filter((code) => code && !codeFormatError(code)),
    ),
  ].slice(0, MAX_BULK_CODES);
  const ignore = url.searchParams.get("ignore");
  const ignoreId = ignore && /^\d+$/.test(ignore) ? ignore : null;

  if (codes.length === 0) return { checked: [], existing: [] };
  const existing = await findExistingCodes(admin, codes, ignoreId);
  return { checked: codes, existing };
};
