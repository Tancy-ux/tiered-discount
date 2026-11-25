// Copy text from inside the Shopify admin. The admin loads apps in a frame
// that often isn't allowed to use navigator.clipboard, so copy with a hidden
// text area first (works inside frames, straight after the merchant's click),
// and only then try the clipboard API.

function copyWithTextArea(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  // Off screen, so the page doesn't jump or flash.
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  document.body.removeChild(textarea);
  return copied;
}

/** Call straight from a click handler. @returns {Promise<boolean>} true when copied */
export async function copyText(text) {
  if (copyWithTextArea(text)) return true;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
