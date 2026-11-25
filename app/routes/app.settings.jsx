import { useCallback, useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { TierEditor, hasBadTiers } from "../components/TierEditor";
import {
  describeTiers,
  hasLargeDiscount,
  largeDiscountText,
  tiersForSubmit,
} from "../tiers";
import { ConfirmModal } from "../components/ConfirmModal";
import { cleanTiers } from "../discount-metafields.server";
import { loadShop, saveDefaultTiers } from "../shop.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  return loadShop(admin);
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const { tiers, error } = cleanTiers(formData.get("tiers")?.toString());
  if (error) return { ok: false, error };

  const { shopId } = await loadShop(admin);
  const errors = await saveDefaultTiers(admin, shopId, tiers);
  return errors.length > 0
    ? { ok: false, error: errors.join(" ") }
    : { ok: true };
};

export default function Settings() {
  const { defaultTiers, hasSavedTiers, currencyCode } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const [tiers, setTiers] = useState(defaultTiers);

  // After a save the server returns the tiers sorted by subtotal; show that.
  const savedKey = JSON.stringify(defaultTiers);
  useEffect(() => {
    setTiers(JSON.parse(savedKey));
  }, [savedKey]);

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show("Default tiers saved");
  }, [fetcher.data, shopify]);

  const isSaving = fetcher.state !== "idle";
  // Real edits only (drives the save bar). Stores still on the built-in
  // tiers can also press Save as-is to keep them.
  const hasEdits =
    JSON.stringify(tiersForSubmit(tiers)) !==
    JSON.stringify(tiersForSubmit(defaultTiers));
  const isDirty = !hasSavedTiers || hasEdits;
  const canSave =
    isDirty && !isSaving && tiers.length > 0 && !hasBadTiers(tiers);

  const [confirmingLarge, setConfirmingLarge] = useState(false);
  const closeLargeConfirm = useCallback(() => setConfirmingLarge(false), []);

  // confirmed: true once the merchant has accepted a large discount.
  const handleSave = (confirmed = false) => {
    if (!canSave) return;
    if (!confirmed && hasLargeDiscount(tiers)) {
      setConfirmingLarge(true);
      return;
    }
    fetcher.submit(
      { tiers: JSON.stringify(tiersForSubmit(tiers)) },
      { method: "post" },
    );
  };

  return (
    <s-page heading="Settings">
      {/* Shopify's save bar: shows while there are unsaved changes, and the
          admin asks before leaving the page while it's open. */}
      <SaveBar id="settings-save-bar" open={hasEdits}>
        <button
          variant="primary"
          {...(isSaving ? { loading: "" } : {})}
          {...(canSave ? {} : { disabled: true })}
          onClick={() => handleSave()}
        >
          Save
        </button>
        <button onClick={() => setTiers(JSON.parse(savedKey))}>Discard</button>
      </SaveBar>

      <s-button
        slot="primary-action"
        variant="primary"
        {...(canSave ? {} : { disabled: true })}
        {...(isSaving ? { loading: true } : {})}
        onClick={() => handleSave()}
      >
        Save
      </s-button>

      <ConfirmModal
        id="large-discount"
        open={confirmingLarge}
        heading="Save a large discount?"
        confirmLabel="Save anyway"
        onConfirm={() => {
          setConfirmingLarge(false);
          handleSave(true);
        }}
        onCancel={closeLargeConfirm}
      >
        {largeDiscountText(tiers)}
      </ConfirmModal>

      {fetcher.data?.ok === false && (
        <s-banner tone="critical" heading="Couldn't save tiers">
          <s-paragraph>{fetcher.data.error}</s-paragraph>
        </s-banner>
      )}

      <s-section heading="Default tiers">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            {`Every code uses these tiers unless it has its own custom tiers. Changes apply at checkout straight away, to every code that uses the default tiers. Amounts are in your store currency (${currencyCode}). Carts in other currencies are converted at checkout, so every buyer reaches the same tier.`}
          </s-paragraph>

          {!hasSavedTiers && (
            <s-box
              padding="small-200 base"
              background="subdued"
              borderRadius="base"
            >
              <s-text color="subdued">
                {`You haven't saved your own tiers yet, so codes use the built-in ones: ${describeTiers(defaultTiers, currencyCode)}. Save to keep these or change them.`}
              </s-text>
            </s-box>
          )}

          <TierEditor
            tiers={tiers}
            onChange={setTiers}
            currencyCode={currencyCode}
          />
          {tiers.length === 0 && (
            <s-text color="subdued">Add at least one tier.</s-text>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
