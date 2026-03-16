"use client";

import { Switch } from "@/components/ui/switch";

export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-semibold tracking-tight">{children}</h3>
  );
}

export function SectionDescription({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">
      {children}
    </p>
  );
}

export function SettingRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-muted/30 transition-colors cursor-pointer group">
      <div className="min-w-0">
        <span className="text-xs font-medium">{label}</span>
        {description && (
          <span className="block text-[10px] text-muted-foreground leading-tight mt-0.5">
            {description}
          </span>
        )}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="shrink-0"
      />
    </label>
  );
}
