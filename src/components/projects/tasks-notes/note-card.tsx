"use client";

import * as React from "react";
import { toast } from "sonner";

import { formatDate } from "@/lib/formatters";
import { parseRichText } from "@/lib/pdfme/plugins/helpers";
import { showError } from "@/lib/show-error";
import { cn, focusRing } from "@/lib/utils";

/** The cap every note field has (`updateNotesNative`, the project schema). */
export const NOTE_MAX = 5000;

/** The client notes' Preview: the SAME markup the documents print (`**bold**`, `*italic*`, `- ` bullets). */
function NotesPreview({ text }: { text: string }) {
  if (!text.trim()) return <p className="text-caption text-muted">Nothing to preview.</p>;
  return (
    <div className="space-y-0.5 text-ui-text text-ink-2" aria-label="Preview of what the documents print">
      {parseRichText(text).map((line, i) => (
        <p key={i} className={line.bullet ? "flex gap-2" : undefined}>
          {line.bullet && <span aria-hidden="true">•</span>}
          <span>
            {line.spans.map((s, j) => (s.style === "bold" ? <strong key={j}>{s.text}</strong> : s.style === "italic" ? <em key={j}>{s.text}</em> : <React.Fragment key={j}>{s.text}</React.Fragment>))}
          </span>
        </p>
      ))}
    </div>
  );
}

/**
 * One note field (UX Phase 10, spec §8c): the audience is on the LABEL, not a
 * placeholder. Borderless text that gains a left rule on focus; saves on blur or ⌘↵
 * (no Save button); a `Saved · Sam · 6 Nov` / `Unsaved` line and an `n / 5,000`
 * counter; client notes get a Preview. Read-only (viewer, or a version that is not the
 * live one) shows the text as is. No Undo on a save: the version menu is the way back.
 */
export function NoteCard({
  title,
  audience,
  value,
  editable,
  saved,
  previewable,
  onSave,
}: {
  title: string;
  audience: string;
  value: string;
  editable: boolean;
  saved: { by: string; at: number } | undefined;
  previewable?: boolean;
  onSave: (text: string) => Promise<unknown>;
}) {
  const [draft, setDraft] = React.useState(value);
  const [saving, setSaving] = React.useState(false);
  const [preview, setPreview] = React.useState(false);
  const dirty = draft !== value;
  React.useEffect(() => {
    // Adopt a changed server value, but never overwrite what is being typed.
    if (!saving) setDraft(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const save = async () => {
    if (!editable || draft === value || saving) return;
    setSaving(true);
    try {
      await onSave(draft);
      toast.success(`${title} saved`);
    } catch (e) {
      showError(e, { fallbackTitle: `Couldn't save the ${title.toLowerCase()}` });
    } finally {
      setSaving(false);
    }
  };

  const statusLine = dirty ? "Unsaved" : saved ? `Saved · ${saved.by} · ${formatDate(new Date(saved.at))}` : null;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="text-ui-text font-medium text-ink">
          {title} <span className="font-normal text-muted">· {audience}</span>
        </h3>
        {previewable && (
          <button type="button" aria-pressed={preview} onClick={() => setPreview((p) => !p)} className={cn("rounded-sm text-caption text-muted hover:text-ink hover:underline", focusRing)}>
            {preview ? "Edit" : "Preview"}
          </button>
        )}
      </div>
      {preview ? (
        <NotesPreview text={draft} />
      ) : editable ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
          }}
          maxLength={NOTE_MAX}
          rows={4}
          aria-label={`${title} · ${audience}`}
          className="w-full resize-y border-0 border-l-2 border-transparent bg-transparent px-2 py-1 text-base text-ink outline-none placeholder:text-muted focus:border-l-ink md:text-ui-text"
          placeholder="Add notes…"
        />
      ) : (
        <p className="whitespace-pre-wrap px-2 text-ui-text text-ink-2">{value || "—"}</p>
      )}
      <div className="flex justify-between text-caption text-muted">
        <span>{editable ? statusLine : null}</span>
        {editable && (
          <span className="tabular-nums">
            {draft.length.toLocaleString("en-AU")} / {NOTE_MAX.toLocaleString("en-AU")}
          </span>
        )}
      </div>
    </div>
  );
}
