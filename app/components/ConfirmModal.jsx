/* eslint-disable react/prop-types */
// Confirmation dialog built on Shopify's modal component, used instead of the
// browser's confirm(), which Shopify's guidance replaces with modals and
// which may not open inside the admin's frame.
import { useEffect, useRef } from "react";

/**
 * Shows while `open` is true. `onCancel` runs when the merchant cancels or
 * closes it (Escape, the close button); `onConfirm` when they confirm.
 */
export function ConfirmModal({
  id,
  open,
  heading,
  children,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}) {
  const ref = useRef(null);

  useEffect(() => {
    const modal = ref.current;
    if (!modal) return;
    if (open) modal.showOverlay?.();
    else modal.hideOverlay?.();
  }, [open]);

  // React 18 doesn't attach custom-event props on web components, so listen
  // for the modal's own "hide" event directly.
  useEffect(() => {
    const modal = ref.current;
    if (!modal) return undefined;
    const handleHide = () => onCancel();
    modal.addEventListener("hide", handleHide);
    return () => modal.removeEventListener("hide", handleHide);
  }, [onCancel]);

  return (
    <s-modal ref={ref} id={id} heading={heading}>
      <s-paragraph>{children}</s-paragraph>
      <s-button slot="secondary-actions" onClick={onCancel}>
        Cancel
      </s-button>
      <s-button
        slot="primary-action"
        variant="primary"
        {...(destructive ? { tone: "critical" } : {})}
        onClick={onConfirm}
      >
        {confirmLabel}
      </s-button>
    </s-modal>
  );
}
