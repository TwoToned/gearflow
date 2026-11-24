"use client";

import { ChevronDown } from "lucide-react";

import type { ActionMenuSpec } from "@/lib/primitives/types";
import { ActionMenu } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";

/**
 * The Scan page's primary (spec §9i.2): `Save and scan next` with a caret for the
 * other ways to save. While it can't save it says why in plain words under it
 * (`Yoke needs a reason and a photo`), and the caret is absent.
 */
export function SavePrimary({
  label = "Save and scan next",
  blocker,
  saving,
  onSave,
  caret,
}: {
  label?: string;
  blocker: string | null;
  saving: boolean;
  onSave: () => void;
  caret: ActionMenuSpec;
}) {
  const disabled = !!blocker || saving;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center">
        <Button
          onClick={onSave}
          disabled={disabled}
          loading={saving}
          aria-describedby={blocker ? "scan-save-blocker" : undefined}
          className={caret.items.length > 0 && !disabled ? "rounded-r-none" : undefined}
        >
          {label}
        </Button>
        {!disabled && caret.items.length > 0 ? (
          <ActionMenu
            spec={caret}
            label="More ways to save"
            trigger={
              <Button aria-label="More ways to save" className="rounded-l-none border-l border-l-white/20 px-2">
                <ChevronDown aria-hidden="true" className="size-4" />
              </Button>
            }
          />
        ) : null}
      </div>
      {blocker ? (
        <p id="scan-save-blocker" className="text-caption text-muted">
          {blocker}
        </p>
      ) : null}
    </div>
  );
}
