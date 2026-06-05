"use client";

import { useQuery } from "@tanstack/react-query";
import { useActiveOrganization } from "@/lib/auth-client";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { peekNextProjectNumber } from "@/server/projects";
import {
  PROJECT_NUMBER_TOKENS,
  validateProjectNumberFormat,
  type IncrementReset,
} from "@/lib/project-number";

const RESET_LABELS: Record<IncrementReset, string> = {
  NONE: "Never (one running counter)",
  YEARLY: "Every year",
  MONTHLY: "Every month",
  DAILY: "Every day",
};

interface Props {
  format: string;
  reset: IncrementReset;
  padding: number;
  disabled?: boolean;
  onChange: (patch: { format?: string; reset?: IncrementReset; padding?: number }) => void;
}

export function ProjectNumberingSettings({ format, reset, padding, disabled, onChange }: Props) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const enabled = format.trim().length > 0;
  const formatError = enabled ? validateProjectNumberFormat(format) : null;

  // Live preview from the server (knows the current counter for this period).
  const { data: preview } = useQuery({
    queryKey: ["project-number-preview", orgId, format, reset, padding],
    queryFn: () => peekNextProjectNumber({ format, reset, padding }),
    enabled: enabled && !formatError,
    staleTime: 10_000,
  });

  return (
    <div className="sm:col-span-2 space-y-3 rounded-lg border border-border/60 bg-bg-2/40 p-4">
      <div>
        <h4 className="t-body font-medium text-fg">Auto project numbers</h4>
        <p className="t-micro text-fg-3">
          Leave the format blank to enter project codes manually. Set a template to
          auto-generate the code when a project is created (the field can be left empty on the form).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2 sm:col-span-1">
          <Label htmlFor="projectNumberFormat">Format</Label>
          <Input
            id="projectNumberFormat"
            value={format}
            onChange={(e) => onChange({ format: e.target.value })}
            placeholder="%YY%MM%INC"
            disabled={disabled}
            spellCheck={false}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="projectNumberReset">Counter resets</Label>
          <Select
            value={reset}
            onValueChange={(v) => onChange({ reset: v as IncrementReset })}
            disabled={disabled || !enabled}
          >
            <SelectTrigger id="projectNumberReset">
              <SelectValue>{RESET_LABELS[reset]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(RESET_LABELS) as IncrementReset[]).map((r) => (
                <SelectItem key={r} value={r}>
                  {RESET_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="projectNumberPadding">Increment digits</Label>
          <Input
            id="projectNumberPadding"
            type="number"
            min={1}
            max={8}
            value={padding}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) onChange({ padding: Math.max(1, Math.min(8, Math.round(n))) });
            }}
            disabled={disabled || !enabled}
          />
        </div>
      </div>

      {/* Token help */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {PROJECT_NUMBER_TOKENS.map((t) => (
          <span key={t.token} className="t-micro text-fg-3">
            <code className="rounded bg-bg-3 px-1 text-fg-2">{t.token}</code> {t.description}
          </span>
        ))}
      </div>

      {/* Preview / validation */}
      {enabled && formatError ? (
        <p className="t-micro text-destructive">{formatError}</p>
      ) : enabled && preview ? (
        <p className="t-micro text-fg-2">
          Next project number: <span className="font-mono font-medium text-fg">{preview}</span>
        </p>
      ) : null}
    </div>
  );
}
