// Live "is this code already used in the store?" check for a single code.
import { useEffect } from "react";
import { useFetcher } from "react-router";
import { codeFormatError, normalizeCode } from "../codes";

/**
 * @param {string} code what the merchant typed
 * @param {{ ignoreId?: string, skip?: boolean }} options ignoreId: this
 *   discount's own id (renaming it shouldn't clash with itself); skip: don't
 *   check (e.g. the code is unchanged)
 * @returns {{ taken: boolean }}
 */
export function useCodeTaken(code, { ignoreId, skip = false } = {}) {
  const fetcher = useFetcher();
  const normalized = normalizeCode(code);
  const checkable =
    Boolean(normalized) && !codeFormatError(normalized) && !skip;

  useEffect(() => {
    if (!checkable) return undefined;
    // Wait until the merchant pauses typing.
    const timeout = setTimeout(() => {
      const ignore = ignoreId ? `&ignore=${encodeURIComponent(ignoreId)}` : "";
      fetcher.load(
        `/app/code-check?codes=${encodeURIComponent(normalized)}${ignore}`,
      );
    }, 400);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalized, checkable, ignoreId]);

  const result = fetcher.data;
  const taken =
    checkable &&
    Boolean(result?.checked?.includes(normalized)) &&
    result.existing.includes(normalized);
  return { taken };
}
