// Which discount codes already exist in the store (any discount, made by
// this app, another app or Shopify admin). Shopify's lookup ignores case.

const CHUNK = 25;

/**
 * @param {string[]} codes normalized codes
 * @param {string | null} ignoreId numeric id of a discount to leave out
 *   (the code being renamed, so it doesn't clash with itself)
 * @returns {Promise<string[]>} the codes that are already taken
 */
export async function findExistingCodes(admin, codes, ignoreId = null) {
  const taken = [];
  for (let start = 0; start < codes.length; start += CHUNK) {
    const chunk = codes.slice(start, start + CHUNK);
    const variables = {};
    const params = [];
    const fields = [];
    chunk.forEach((code, index) => {
      variables[`c${index}`] = code;
      params.push(`$c${index}: String!`);
      fields.push(`c${index}: codeDiscountNodeByCode(code: $c${index}) { id }`);
    });
    const response = await admin.graphql(
      `query CodeLookup(${params.join(", ")}) { ${fields.join(" ")} }`,
      { variables },
    );
    const { data } = await response.json();
    chunk.forEach((code, index) => {
      const node = data?.[`c${index}`];
      if (!node) return;
      if (ignoreId && node.id.split("/").pop() === String(ignoreId)) return;
      taken.push(code);
    });
  }
  return taken;
}
