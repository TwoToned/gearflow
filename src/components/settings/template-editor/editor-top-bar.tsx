"use client";

import { ArrowLeft, Check, Cloud, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DOCUMENT_TYPE_LABELS } from "@/lib/validations/document-template";

interface EditorTopBarProps {
  name: string;
  onNameChange: (name: string) => void;
  templateType: string;
  isDraft: boolean;
  isDefault: boolean;
  version: number;
  saveState: "idle" | "saving" | "saved";
  onSave: () => void;
  onPublish: () => void;
  isPublishing: boolean;
  onBack: () => void;
}

export function EditorTopBar({
  name,
  onNameChange,
  templateType,
  isDraft,
  isDefault,
  version,
  saveState,
  onSave,
  onPublish,
  isPublishing,
  onBack,
}: EditorTopBarProps) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border/50 bg-bg-surface px-4">
      {/* Back */}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-fg-3 hover:text-fg"
        onClick={onBack}
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>

      {/* Divider */}
      <div className="h-5 w-px bg-border/50" />

      {/* Template name — editable */}
      <input
        type="text"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        className="bg-transparent text-sm font-medium outline-none border-none focus:ring-0 min-w-0 flex-1 max-w-[300px] truncate"
        placeholder="Template name"
      />

      {/* Badges */}
      <Badge variant="outline" className="text-[10px] font-medium uppercase tracking-wide shrink-0">
        {DOCUMENT_TYPE_LABELS[templateType] || templateType}
      </Badge>
      {isDraft && (
        <Badge className="text-[10px] font-medium uppercase tracking-wide bg-amber-500/10 text-amber-600 dark:text-amber-400 border-0 shrink-0">
          Draft
        </Badge>
      )}
      {isDefault && (
        <Badge variant="default" className="text-[10px] font-semibold uppercase tracking-wide shrink-0">
          Default
        </Badge>
      )}
      <span className="text-[10px] text-fg-3 shrink-0">v{version}</span>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Save state indicator */}
      <div className="flex items-center gap-1.5 text-xs text-fg-3 shrink-0">
        {saveState === "saving" && (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Saving…</span>
          </>
        )}
        {saveState === "saved" && (
          <>
            <Check className="h-3 w-3 text-emerald-500" />
            <span className="text-emerald-600 dark:text-emerald-400">Saved</span>
          </>
        )}
        {saveState === "idle" && (
          <>
            <Cloud className="h-3 w-3" />
          </>
        )}
      </div>

      {/* Actions */}
      <Button
        variant="outline"
        size="sm"
        onClick={onSave}
        disabled={saveState === "saving"}
        className="gap-1.5"
      >
        Save
      </Button>
      {isDraft && (
        <Button
          size="sm"
          onClick={onPublish}
          disabled={isPublishing}
          className="gap-1.5"
        >
          {isPublishing ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Publishing…
            </>
          ) : (
            <>
              <Send className="h-3 w-3" />
              Publish
            </>
          )}
        </Button>
      )}
    </div>
  );
}
