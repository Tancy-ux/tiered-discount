/* eslint-disable react/prop-types */
// Page sections shared by the create page and a code's page, so both look
// and validate the same.
import { TierEditor, TierSummary } from "./TierEditor";
import { CombineOptions } from "./CombineOptions";

/** Error for the start/end dates ("YYYY-MM-DD"), or nulls when fine. */
export function datesProblems(startsAt, endsAt) {
  return {
    start: startsAt ? null : "Enter a start date",
    // Same-format date strings compare correctly as text.
    end:
      startsAt && endsAt && endsAt < startsAt
        ? "End date must be on or after the start date"
        : null,
  };
}

/** Error for the total usage limit (blank = unlimited), or null. */
export function usageLimitProblem(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const number = Number(raw);
  return Number.isInteger(number) && number >= 1
    ? null
    : "Enter a whole number of 1 or more, or leave empty";
}

export function TiersSection({
  useCustomTiers,
  onUseCustomTiersChange,
  tiers,
  onTiersChange,
  defaultTiers,
  currencyCode,
  customNote,
  defaultNote,
}) {
  return (
    <s-section heading="Discount tiers">
      <s-stack direction="block" gap="base">
        <s-checkbox
          label="Use custom tiers for this code"
          {...(useCustomTiers ? { checked: true } : {})}
          onChange={(event) =>
            onUseCustomTiersChange(event.currentTarget.checked)
          }
        ></s-checkbox>
        {useCustomTiers ? (
          <>
            <TierEditor
              tiers={tiers}
              onChange={onTiersChange}
              currencyCode={currencyCode}
            />
            {tiers.length === 0 && (
              <s-text color="subdued">Add at least one tier.</s-text>
            )}
            {customNote && <s-text color="subdued">{customNote}</s-text>}
          </>
        ) : (
          <>
            <s-box
              padding="small-200 base"
              background="subdued"
              borderRadius="base"
            >
              <TierSummary tiers={defaultTiers} currencyCode={currencyCode} />
            </s-box>
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text color="subdued">{defaultNote}</s-text>
              <s-link href="/app/settings">Change default tiers</s-link>
            </s-stack>
          </>
        )}
      </s-stack>
    </s-section>
  );
}

export function DatesSection({
  startsAt,
  endsAt,
  onStartsAtChange,
  onEndsAtChange,
}) {
  const problems = datesProblems(startsAt, endsAt);
  return (
    <s-section heading="Active dates">
      <s-stack direction="block" gap="base">
        {/* Shown above the fields: the date picker opens below a field and
            would cover a message placed under it. */}
        {(problems.start || problems.end) && (
          <s-banner tone="critical">
            <s-stack direction="block" gap="small-300">
              {problems.start && <s-text>{`${problems.start}.`}</s-text>}
              {problems.end && <s-text>{`${problems.end}.`}</s-text>}
            </s-stack>
          </s-banner>
        )}
        {/* Start and end side by side, each taking half the width. */}
        <s-grid gridTemplateColumns="1fr 1fr" gap="base">
          <s-date-field
            label="Start date"
            value={startsAt}
            onChange={(event) => onStartsAtChange(event.currentTarget.value)}
          ></s-date-field>
          <s-date-field
            label="End date (optional)"
            value={endsAt}
            onChange={(event) => onEndsAtChange(event.currentTarget.value)}
          ></s-date-field>
        </s-grid>
        <s-text color="subdued">
          Dates use your store&apos;s time zone. The code works until the end of
          its end date.
        </s-text>
      </s-stack>
    </s-section>
  );
}

export function CombinesSection({ combines, onCombinesChange, slot }) {
  return (
    <s-section heading="Combines with" {...(slot ? { slot } : {})}>
      <CombineOptions value={combines} onChange={onCombinesChange} />
    </s-section>
  );
}

/** Usage limits, combinations and notes, shown open in one section. */
export function MoreSettingsSection({
  usageLimit,
  onUsageLimitChange,
  appliesOncePerCustomer,
  onAppliesOncePerCustomerChange,
  combines,
  onCombinesChange,
  notes,
  onNotesChange,
  slot,
}) {
  const problem = usageLimitProblem(usageLimit);
  return (
    <s-section heading="More settings" {...(slot ? { slot } : {})}>
      <s-stack direction="block" gap="base">
        <s-number-field
          label="Total uses"
          placeholder="Unlimited"
          min={1}
          step={1}
          {...(problem ? { error: problem } : {})}
          value={String(usageLimit ?? "")}
          onInput={(event) => onUsageLimitChange(event.currentTarget.value)}
        ></s-number-field>
        <s-checkbox
          label="One use per customer"
          {...(appliesOncePerCustomer ? { checked: true } : {})}
          onChange={(event) =>
            onAppliesOncePerCustomerChange(event.currentTarget.checked)
          }
        ></s-checkbox>
        <s-divider></s-divider>
        <s-text type="strong">Combines with</s-text>
        <CombineOptions value={combines} onChange={onCombinesChange} />
        <s-divider></s-divider>
        <s-text-area
          label="Notes"
          placeholder="Only you see these"
          rows={3}
          value={notes}
          onInput={(event) => onNotesChange(event.currentTarget.value)}
        ></s-text-area>
      </s-stack>
    </s-section>
  );
}
