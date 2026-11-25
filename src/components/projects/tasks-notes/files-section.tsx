"use client";

import * as React from "react";
import { Camera, Upload } from "lucide-react";
import { toast } from "sonner";

import { BulkBar } from "@/components/ui/bulk-bar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FileRow, downloadFile, fileName, type JobFile } from "@/components/projects/tasks-notes/file-row";
import { AttachToTaskDialog } from "@/components/projects/tasks-notes/attach-to-task-dialog";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useTaskLinks } from "@/hooks/use-task-links";
import { linkTargetKey, type TaskLink } from "@/lib/task-links";
import { useProjectFileWrites } from "@/hooks/use-project-file-writes";
import { showError } from "@/lib/show-error";
import { useIsViewer } from "@/lib/use-permissions";
import { FILE_FILTERS, fileCategoryLabel, guessFileCategory, matchesFileFilter, type FileCategory, type FileFilter } from "@/lib/file-category";
import { buildFileBulkActions } from "@/lib/row-actions/file-row";
import { cn, focusRing } from "@/lib/utils";
import { api } from "../../../../convex/_generated/api";

/**
 * The Files section (UX Phase 10, spec §8c): a category per file (the `ProjectMediaType`
 * enum, guessed from the name on upload), who uploaded it and when, open / download /
 * rename / change category, an always-on checkbox per file with a bulk bar, chips
 * `All · Documents · Photos`, a drop strip that names the types and the cap, and (on a
 * phone) `Take a photo`. REMOVE is a confirmed hard delete of the stored file with NO
 * Undo (an Undo never deletes or restores stored bytes). `Also on this job` lists, read
 * only, the files that live on other tabs (the sent quote and issued invoice documents,
 * sub-hire attachments, incident photos), each with its origin and an open link.
 */
const ACCEPT = "image/*,.pdf,.doc,.docx,.xls,.xlsx,.dwg,.dxf,.txt";
const ACCEPT_WORDS = "images, PDF, Word, Excel, DWG/DXF, text";
const MAX_MB = 50; // `UPLOAD_MAX_SIZE_MB` (default 50), enforced by /api/uploads

async function uploadOne(file: File, projectId: string): Promise<{ id: string }> {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", "projects");
  form.append("entityId", projectId);
  const res = await fetch("/api/uploads", { method: "POST", body: form });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "Upload failed");
  return res.json();
}

function FilterChips({ value, onChange }: { value: FileFilter; onChange: (f: FileFilter) => void }) {
  return (
    <div role="group" aria-label="Show files" className="flex items-center gap-3">
      {FILE_FILTERS.map((f) => (
        <button
          key={f.value}
          type="button"
          aria-pressed={value === f.value}
          onClick={() => onChange(f.value)}
          className={cn("rounded-sm text-ui-text [@media(pointer:coarse)]:min-h-11", value === f.value ? "font-medium text-ink underline underline-offset-4" : "text-muted hover:text-ink", focusRing)}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

function DropStrip({ onFiles, uploading }: { onFiles: (files: File[]) => void; uploading: boolean }) {
  const input = React.useRef<HTMLInputElement>(null);
  const camera = React.useRef<HTMLInputElement>(null);
  const [over, setOver] = React.useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
      className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[var(--r)] border border-dashed border-line px-3 py-2 text-caption text-muted", over && "border-ink bg-paper-2")}
    >
      <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" aria-label="Upload files" onChange={(e) => onFiles(Array.from(e.target.files ?? []))} />
      {/* A plain `capture` input: the phone camera app, no second camera engine (the WASM scanner rule is about decoding). */}
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" aria-label="Take a photo" onChange={(e) => onFiles(Array.from(e.target.files ?? []))} />
      <Button type="button" variant="line" size="sm" loading={uploading} onClick={() => input.current?.click()}>
        <Upload className="size-3.5" /> Upload
      </Button>
      <Button type="button" variant="line" size="sm" className="md:hidden" onClick={() => camera.current?.click()}>
        <Camera className="size-3.5" /> Take a photo
      </Button>
      <span>Drop files here · {ACCEPT_WORDS} · up to {MAX_MB} MB each</span>
    </div>
  );
}

function RenameDialog({ file, onClose, onSave }: { file: JobFile; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = React.useState(fileName(file));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename file</DialogTitle>
        </DialogHeader>
        <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="File name" maxLength={200} className="text-base" />
        <DialogFooter>
          <Button type="button" variant="line" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={!name.trim()} onClick={() => onSave(name.trim())}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AlsoOnJob({ projectId, orgId }: { projectId: string; orgId: string | undefined }) {
  const other = useAuthedQuery(api.projectFiles.alsoOnJob, orgId ? { orgId, projectId } : "skip");
  if (!other || other.items.length === 0) return null;
  return (
    <div className="mt-4">
      <h3 className="mb-1 text-overline uppercase tracking-wide text-muted">Also on this job</h3>
      <ul>
        {other.items.map((i) => (
          <li key={i.key} className="flex items-center justify-between gap-3 border-b border-line py-1.5 text-caption last:border-b-0">
            <span className="min-w-0 truncate text-ink-2">{i.name}</span>
            <span className="flex shrink-0 items-center gap-3 text-muted">
              {i.origin}
              <a href={i.href} target="_blank" rel="noopener noreferrer" className={cn("rounded-sm hover:text-ink hover:underline", focusRing)}>
                Open ↗
              </a>
            </span>
          </li>
        ))}
      </ul>
      {other.truncated && <p className="t-micro text-muted">Showing the first of each source.</p>}
    </div>
  );
}

async function run(fn: () => Promise<unknown>, ok: string) {
  try {
    await fn();
    toast.success(ok);
  } catch (e) {
    showError(e);
  }
}

/** Every Files write: upload, change category, remove. Each toasts once; none has an Undo. */
function useFileActions(projectId: string, clear: () => void) {
  const writes = useProjectFileWrites(projectId);
  const [uploading, setUploading] = React.useState(false);
  const upload = async (picked: File[]) => {
    if (picked.length === 0) return;
    setUploading(true);
    for (const f of picked) {
      await run(async () => {
        const up = await uploadOne(f, projectId);
        await writes.add(up.id, guessFileCategory(f.name, f.type));
      }, `Uploaded “${f.name}”`);
    }
    setUploading(false);
  };
  const setType = (ids: string[], type: FileCategory) => run(() => writes.setType(ids, type), `Set ${ids.length} ${ids.length === 1 ? "file" : "files"} to ${fileCategoryLabel(type)}`);
  // ONE server mutation for one file or many (the same bytes-only-if-unreferenced rule); skipped rows are named.
  const remove = async (ids: string[]) => {
    try {
      const r = await writes.removeMany(ids);
      clear();
      const done = r.removed === 1 ? "File removed" : `${r.removed} files removed`;
      toast.success(r.skipped.length > 0 ? `${done} · skipped ${r.skipped.length}: not found` : done);
    } catch (e) {
      showError(e);
    }
  };
  const rename = (id: string, name: string) => run(() => writes.rename(id, name), `Renamed to “${name}”`);
  return { upload, uploading, setType, remove, rename };
}

/** `Attach to a task…` for one file, mounted only while a file is chosen. */
function AttachHost({ projectId, file, onClose }: { projectId: string; file: JobFile | null; onClose: () => void }) {
  if (!file) return null;
  return <AttachToTaskDialog projectId={projectId} target={{ kind: "file", id: file.id, label: fileName(file) }} onClose={onClose} />;
}

interface FileListProps {
  loading: boolean;
  total: number;
  shown: JobFile[];
  canEdit: boolean;
  selected: ReadonlySet<string>;
  onToggle: (id: string, checked: boolean) => void;
  onRename: (file: JobFile) => void;
  onSetType: (id: string, type: FileCategory) => void;
  onRemove: (id: string) => void;
  /** Tasks linking to a file (the `Task: …` line) and `Attach to a task…` (absent = cannot link). */
  linksFor: (mediaId: string) => TaskLink[] | undefined;
  onAttach?: (file: JobFile) => void;
}

/** The rows, or the one calm line when there is nothing to show. */
function FileList(p: FileListProps) {
  if (p.loading) return <p className="t-micro text-muted">Loading files…</p>;
  if (p.shown.length === 0) return <p className="t-micro text-muted">{p.total === 0 ? "No files yet." : "No files match."}</p>;
  return (
    <ul>
      {p.shown.map((f) => (
        <FileRow
          key={f.id}
          file={f}
          canEdit={p.canEdit}
          selected={p.selected.has(f.id)}
          onSelectedChange={(c) => p.onToggle(f.id, c)}
          onRename={() => p.onRename(f)}
          onSetType={(type) => p.onSetType(f.id, type)}
          onRemove={() => p.onRemove(f.id)}
          taskLinks={p.linksFor(f.id)}
          onAttachToTask={p.onAttach ? () => p.onAttach?.(f) : undefined}
        />
      ))}
    </ul>
  );
}

export function FilesSection({ projectId, orgId }: { projectId: string; orgId: string | undefined }) {
  const data = useAuthedQuery(api.projectFiles.listForProject, orgId ? { orgId, projectId } : "skip");
  const canEdit = !useIsViewer();
  const [filter, setFilter] = React.useState<FileFilter>("all");
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const [renaming, setRenaming] = React.useState<JobFile | null>(null);
  const [attaching, setAttaching] = React.useState<JobFile | null>(null);
  const { byTarget } = useTaskLinks(projectId);
  const clear = () => setSelected(new Set());
  const { upload, uploading, setType, remove, rename } = useFileActions(projectId, clear);

  const files = (data?.files ?? []) as JobFile[];
  const shown = files.filter((f) => matchesFileFilter(f.file.mimeType, filter));

  const picked = files.filter((f) => selected.has(f.id));
  const bulk = buildFileBulkActions(canEdit, {
    onSetType: (type) => setType([...selected], type),
    onDownload: () => picked.forEach(downloadFile),
    onRemove: () => remove([...selected]),
  });

  return (
    <div className="space-y-3">
      {canEdit && <DropStrip onFiles={upload} uploading={uploading} />}
      <FilterChips value={filter} onChange={setFilter} />
      <FileList
        loading={data === undefined}
        total={files.length}
        shown={shown}
        canEdit={canEdit}
        selected={selected}
        onToggle={(id, c) =>
          setSelected((prev) => {
            const next = new Set(prev);
            if (c) next.add(id);
            else next.delete(id);
            return next;
          })
        }
        onRename={setRenaming}
        onSetType={(id, type) => void setType([id], type)}
        onRemove={(id) => void remove([id])}
        linksFor={(id) => byTarget.get(linkTargetKey("file", id))}
        onAttach={canEdit ? setAttaching : undefined}
      />
      <AttachHost projectId={projectId} file={attaching} onClose={() => setAttaching(null)} />
      {data?.truncated && <p className="t-micro text-muted">Showing the first files only.</p>}
      {selected.size > 0 && <BulkBar selection={{ count: selected.size, clear }} actions={bulk} noun="file" />}
      <AlsoOnJob projectId={projectId} orgId={orgId} />
      {renaming && (
        <RenameDialog
          file={renaming}
          onClose={() => setRenaming(null)}
          onSave={(name) => {
            const f = renaming;
            setRenaming(null);
            void rename(f.id, name);
          }}
        />
      )}
    </div>
  );
}
