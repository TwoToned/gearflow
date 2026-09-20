"use client";

/**
 * The Accessories section of the Edit Item window (issue #794 follow-up) — a
 * `SectionTitle` matching the dialog's other sections wrapped around the SAME
 * `AccessorySelectionFields` picker the add form and the row kebab's
 * `EditAccessoryPlanDialog` render, driven by `useAccessoryPlanEditor`.
 *
 * Its own file only to keep `edit-line-item-dialog.tsx` inside the per-file
 * line budget (POLICY.md §13); the dialog still owns the save, since the plan
 * write has to be sequenced after the line patch.
 */

import { AccessorySelectionFields } from "./accessory-selection-fields";
import { SectionTitle } from "./line-item-form-fields";
import type { AccessoryPlanEditor } from "./use-accessory-plan-editor";

export function AccessoryPlanSection({
  editor,
  quantity,
}: {
  editor: AccessoryPlanEditor;
  /** The quantity currently TYPED in the dialog, not the stored one — the
   *  picker scales each accessory's per-parent count by it, so "3× XLR Cable"
   *  tracks the quantity field live as the PM edits it. */
  quantity: number;
}) {
  return (
    <section className="space-y-4 border-t border-line pt-5">
      <SectionTitle title="Accessories" hint="What ships with this item on this job." />
      <AccessorySelectionFields
        showHeading={false}
        accessories={editor.accessories}
        quantity={quantity}
        selection={editor.selection}
        onSelectionChange={editor.setSelection}
        excludeReasons={editor.excludeReasons}
        onExcludeReasonsChange={editor.setExcludeReasons}
      />
    </section>
  );
}
