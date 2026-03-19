"use client";

/**
 * Block editor — the main three-pane editor for block-based templates.
 *
 * Layout: Block Tree (260px) | HTML Preview (flex-1) | Settings Panel (320px)
 *
 * State: blocks[], selectedId, history (undo/redo, 50 states)
 * Converts blocks → flat sections for preview/save via flattenBlocks().
 */
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { DocumentType } from "@/lib/pdfme/types";
import type {
  TemplateBlock,
  TemplateSection,
  SectionType,
  SectionSettings,
} from "@/lib/pdfme/section-types";
import {
  generateSectionId,
  getDefaultHeaderSettings,
  getDefaultClientDetailsSettings,
  getDefaultProjectDetailsSettings,
  getDefaultTableSettings,
  getDefaultTotalsSettings,
  getDefaultNotesSettings,
  getDefaultSignatureSettings,
  getDefaultCustomTextSettings,
  getDefaultCrewTableSettings,
} from "@/lib/pdfme/section-types";
import {
  flattenBlocks,
  sectionsToBlocks,
  wrapInRow,
  createContentBlock,
  generateBlockId,
} from "@/lib/pdfme/block-utils";
import {
  saveTemplateBlocks,
  publishDocumentTemplate,
} from "@/server/document-templates";
import { EditorTopBar } from "../template-editor/editor-top-bar";
import { EditorPreviewPanel } from "../template-editor/editor-preview-panel";
import { BlockTree } from "./block-tree";
import { HtmlPreview } from "./html-preview";
import { SectionSettingsPanel } from "./section-settings-panel";
import { SectionLibrary } from "./section-library";

// ─── Props ───────────────────────────────────────────────────────────────────

interface BlockEditorProps {
  templateId: string;
  templateName: string;
  templateType: DocumentType;
  isDraft: boolean;
  isDefault: boolean;
  version: number;
  initialSections: TemplateSection[];
  brandTemplateId?: string | null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function BlockEditor({
  templateId,
  templateName,
  templateType,
  isDraft,
  isDefault,
  version,
  initialSections,
  brandTemplateId,
}: BlockEditorProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Convert flat sections → block tree on mount
  const initialBlocks = useMemo(
    () => sectionsToBlocks(initialSections),
    [initialSections],
  );

  // ─── State ──────────────────────────────────────────────────────────────────
  const [blocks, setBlocks] = useState<TemplateBlock[]>(initialBlocks);
  const [name, setName] = useState(templateName);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialBlocks.length > 0 ? initialBlocks[0].id : null,
  );
  const [previewPdf, setPreviewPdf] = useState<Uint8Array | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(true);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [currentVersion, setCurrentVersion] = useState(version);
  const [previewMode, setPreviewMode] = useState<"html" | "pdf">("html");
  const [insertDialogIndex, setInsertDialogIndex] = useState<number | null>(null);

  // Undo/redo history
  const [history, setHistory] = useState<TemplateBlock[][]>([initialBlocks]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Find selected block (may be nested in a row)
  const selectedBlock = useMemo(() => {
    return findBlockById(blocks, selectedId);
  }, [blocks, selectedId]);

  // Convert selected block to a flat section for the settings panel
  const selectedSection = useMemo((): TemplateSection | null => {
    if (!selectedBlock) return null;
    if (selectedBlock.type === "row" || selectedBlock.type === "column") return null;
    return {
      id: selectedBlock.id,
      type: selectedBlock.type as TemplateSection["type"],
      settings: selectedBlock.settings || {},
      visibility: selectedBlock.visibility || {},
      content: selectedBlock.content,
      order: 0,
    };
  }, [selectedBlock]);

  // ─── History helpers ────────────────────────────────────────────────────────
  const pushHistory = useCallback(
    (newBlocks: TemplateBlock[]) => {
      setHistory((prev) => {
        const trimmed = prev.slice(0, historyIndex + 1);
        return [...trimmed, newBlocks].slice(-50);
      });
      setHistoryIndex((prev) => Math.min(prev + 1, 49));
    },
    [historyIndex],
  );

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    setBlocks(history[newIndex]);
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const newIndex = historyIndex + 1;
    setHistoryIndex(newIndex);
    setBlocks(history[newIndex]);
  }, [history, historyIndex]);

  // ─── Block mutations ────────────────────────────────────────────────────────
  const updateBlocks = useCallback(
    (newBlocks: TemplateBlock[]) => {
      setBlocks(newBlocks);
      pushHistory(newBlocks);

      // Debounce PDF preview regeneration
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        generatePreview(blocksRef.current);
      }, 800);
    },
    [pushHistory],
  );

  const addSection = useCallback(
    (type: SectionType, insertIndex?: number) => {
      const settings = getDefaultSettingsForType(type);
      const contentBlock: TemplateBlock = {
        id: generateBlockId("sec"),
        type,
        settings,
        visibility: {},
        ...(type === "custom-text" ? { content: "" } : {}),
      };
      const rowBlock = wrapInRow(contentBlock);
      const newBlocks = [...blocks];
      const idx = insertIndex !== undefined ? insertIndex : newBlocks.length;
      newBlocks.splice(idx, 0, rowBlock);
      updateBlocks(newBlocks);
      setSelectedId(contentBlock.id);
      setInsertDialogIndex(null);
    },
    [blocks, updateBlocks],
  );

  const addSections = useCallback(
    (sections: TemplateSection[]) => {
      // Convert flat sections to block tree and append
      const newBlocks = sectionsToBlocks(sections);
      updateBlocks([...blocks, ...newBlocks]);
      if (newBlocks.length > 0) {
        setSelectedId(newBlocks[0].id);
      }
    },
    [blocks, updateBlocks],
  );

  const duplicateBlock = useCallback(
    (blockId: string) => {
      const index = blocks.findIndex((b) => b.id === blockId);
      if (index === -1) return;
      const clone = structuredClone(blocks[index]);
      reassignIds(clone);
      const newBlocks = [...blocks];
      newBlocks.splice(index + 1, 0, clone);
      updateBlocks(newBlocks);
      setSelectedId(clone.id);
    },
    [blocks, updateBlocks],
  );

  const deleteBlock = useCallback(
    (blockId: string) => {
      const newBlocks = blocks.filter((b) => b.id !== blockId);
      updateBlocks(newBlocks);
      if (selectedId === blockId) {
        setSelectedId(newBlocks.length > 0 ? newBlocks[0].id : null);
      }
    },
    [blocks, selectedId, updateBlocks],
  );

  const reorderBlocks = useCallback(
    (newBlocks: TemplateBlock[]) => {
      updateBlocks(newBlocks);
    },
    [updateBlocks],
  );

  const updateSection = useCallback(
    (sectionId: string, updates: Partial<TemplateSection>) => {
      const newBlocks = updateBlockInTree(blocks, sectionId, updates);
      updateBlocks(newBlocks);
    },
    [blocks, updateBlocks],
  );

  const updateBlockStyling = useCallback(
    (blockId: string, styling: import("@/lib/pdfme/section-types").BlockStyling | undefined) => {
      const newBlocks = updateBlockStylingInTree(blocks, blockId, styling);
      updateBlocks(newBlocks);
    },
    [blocks, updateBlocks],
  );

  // ─── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }

      if (meta && e.key === "s") {
        e.preventDefault();
        saveMutation.mutate();
        return;
      }

      if (meta && e.key === "d" && selectedId) {
        e.preventDefault();
        duplicateBlock(selectedId);
        return;
      }

      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        // Only delete if not in an input/textarea
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        e.preventDefault();
        deleteBlock(selectedId);
        return;
      }

      if (e.key === "Escape") {
        setSelectedId(null);
        return;
      }

      // Arrow keys to navigate blocks
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        if (!selectedId) return;
        e.preventDefault();
        const allIds = getAllBlockIds(blocks);
        const currentIdx = allIds.indexOf(selectedId);
        if (currentIdx === -1) return;
        const newIdx = e.key === "ArrowUp"
          ? Math.max(0, currentIdx - 1)
          : Math.min(allIds.length - 1, currentIdx + 1);
        setSelectedId(allIds[newIdx]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo, selectedId, blocks, duplicateBlock, deleteBlock]);

  // ─── Preview ────────────────────────────────────────────────────────────────
  const generatePreview = useCallback(
    async (currentBlocks: TemplateBlock[]) => {
      setIsPreviewLoading(true);
      try {
        const sections = flattenBlocks(currentBlocks);
        const res = await fetch("/api/documents/template-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docType: templateType, sections }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arrayBuffer = await res.arrayBuffer();
        setPreviewPdf(new Uint8Array(arrayBuffer));
      } catch (err) {
        console.error("Preview generation failed:", err);
      } finally {
        setIsPreviewLoading(false);
      }
    },
    [templateType],
  );

  useEffect(() => {
    generatePreview(blocks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefreshPreview = useCallback(() => {
    generatePreview(blocksRef.current);
  }, [generatePreview]);

  // ─── Save / Publish ─────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: () =>
      saveTemplateBlocks({
        id: templateId,
        blocks: blocksRef.current as Parameters<typeof saveTemplateBlocks>[0]["blocks"],
        brandTemplateId: brandTemplateId || null,
        version: currentVersion,
      }),
    onMutate: () => setSaveState("saving"),
    onSuccess: (result) => {
      setSaveState("saved");
      if (result && "version" in result) {
        setCurrentVersion(result.version as number);
      }
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
      setTimeout(() => setSaveState("idle"), 2000);
    },
    onError: (err) => {
      setSaveState("idle");
      const msg = err instanceof Error ? err.message : "Failed to save";
      if (msg.includes("version")) {
        toast.error("Template was modified elsewhere. Please refresh.");
      } else {
        toast.error(msg);
      }
    },
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      await saveTemplateBlocks({
        id: templateId,
        blocks: blocksRef.current as Parameters<typeof saveTemplateBlocks>[0]["blocks"],
        brandTemplateId: brandTemplateId || null,
        version: currentVersion,
      });
      return publishDocumentTemplate(templateId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
      toast.success("Template published");
    },
    onError: () => toast.error("Failed to publish template"),
  });

  // Flatten current blocks to sections for the SectionLibrary
  const currentSections = useMemo(() => flattenBlocks(blocks), [blocks]);

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen flex-col bg-background">
      <EditorTopBar
        name={name}
        onNameChange={setName}
        templateType={templateType}
        isDraft={isDraft}
        isDefault={isDefault}
        version={currentVersion}
        saveState={saveState}
        onSave={() => saveMutation.mutate()}
        onPublish={() => publishMutation.mutate()}
        isPublishing={publishMutation.isPending}
        onBack={() => router.push("/settings/documents")}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Left panel — Block tree (260px) */}
        <div className="flex w-[260px] shrink-0 flex-col border-r border-border/30 bg-bg-surface/50">
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/30 px-3">
            <span className="text-xs font-semibold text-fg-3 uppercase tracking-wider">
              Blocks
            </span>
            <div className="flex items-center gap-1 text-[10px] text-fg-3">
              <button
                onClick={undo}
                disabled={historyIndex <= 0}
                className="px-1.5 py-0.5 rounded hover:bg-bg-inset disabled:opacity-30"
                title="Undo (Cmd+Z)"
              >
                Undo
              </button>
              <button
                onClick={redo}
                disabled={historyIndex >= history.length - 1}
                className="px-1.5 py-0.5 rounded hover:bg-bg-inset disabled:opacity-30"
                title="Redo (Cmd+Shift+Z)"
              >
                Redo
              </button>
            </div>
          </div>

          <BlockTree
            blocks={blocks}
            selectedBlockId={selectedId}
            onSelectBlock={setSelectedId}
            onReorderBlocks={reorderBlocks}
            onDuplicateBlock={duplicateBlock}
            onDeleteBlock={deleteBlock}
            onInsertAt={(index) => setInsertDialogIndex(index)}
          />

          <div className="shrink-0 border-t border-border/30 p-2">
            <SectionLibrary
              onAddSection={(type) => addSection(type, insertDialogIndex ?? undefined)}
              onAddSections={addSections}
              currentSections={currentSections}
            />
          </div>
        </div>

        {/* Middle panel — Preview */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Preview mode toggle */}
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/30 px-4">
            <button
              className={`text-xs px-2 py-1 rounded transition-colors ${
                previewMode === "html"
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-fg-3 hover:text-fg"
              }`}
              onClick={() => setPreviewMode("html")}
            >
              Layout Preview
            </button>
            <button
              className={`text-xs px-2 py-1 rounded transition-colors ${
                previewMode === "pdf"
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-fg-3 hover:text-fg"
              }`}
              onClick={() => {
                setPreviewMode("pdf");
                handleRefreshPreview();
              }}
            >
              PDF Preview
            </button>
          </div>

          {previewMode === "html" ? (
            <div className="flex-1 overflow-auto bg-inset">
              <HtmlPreview
                blocks={blocks}
                selectedBlockId={selectedId}
                onSelectBlock={setSelectedId}
              />
            </div>
          ) : (
            <EditorPreviewPanel
              pdfData={previewPdf}
              isLoading={isPreviewLoading}
              onRefresh={handleRefreshPreview}
            />
          )}
        </div>

        {/* Right panel — Settings (320px) */}
        <div className="w-[320px] shrink-0 border-l border-border/30 bg-bg-surface/30">
          <SectionSettingsPanel
            section={selectedSection}
            onUpdate={updateSection}
            blockStyling={selectedBlock?.styling}
            onUpdateBlockStyling={updateBlockStyling}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Find a block by ID anywhere in the tree */
function findBlockById(
  blocks: TemplateBlock[],
  id: string | null,
): TemplateBlock | null {
  if (!id) return null;
  for (const block of blocks) {
    if (block.id === id) return block;
    if (block.children) {
      const found = findBlockById(block.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** Get all block IDs in tree order (for keyboard navigation) */
function getAllBlockIds(blocks: TemplateBlock[]): string[] {
  const ids: string[] = [];
  for (const block of blocks) {
    ids.push(block.id);
    if (block.children) {
      ids.push(...getAllBlockIds(block.children));
    }
  }
  return ids;
}

/** Reassign IDs to a block and all its children (for duplication) */
function reassignIds(block: TemplateBlock): void {
  block.id = generateBlockId(block.type === "row" ? "row" : block.type === "column" ? "col" : "sec");
  if (block.children) {
    for (const child of block.children) {
      reassignIds(child);
    }
  }
}

/** Update a block's properties anywhere in the tree */
function updateBlockInTree(
  blocks: TemplateBlock[],
  id: string,
  updates: Partial<TemplateSection>,
): TemplateBlock[] {
  return blocks.map((block) => {
    if (block.id === id) {
      return {
        ...block,
        settings: updates.settings ?? block.settings,
        visibility: updates.visibility ?? block.visibility,
        content: updates.content !== undefined ? updates.content : block.content,
      };
    }
    if (block.children) {
      return {
        ...block,
        children: updateBlockInTree(block.children, id, updates),
      };
    }
    return block;
  });
}

/** Update a block's styling anywhere in the tree */
function updateBlockStylingInTree(
  blocks: TemplateBlock[],
  id: string,
  styling: import("@/lib/pdfme/section-types").BlockStyling | undefined,
): TemplateBlock[] {
  return blocks.map((block) => {
    if (block.id === id) {
      return { ...block, styling };
    }
    if (block.children) {
      return {
        ...block,
        children: updateBlockStylingInTree(block.children, id, styling),
      };
    }
    return block;
  });
}

function getDefaultSettingsForType(type: SectionType): SectionSettings {
  switch (type) {
    case "header":
      return getDefaultHeaderSettings();
    case "client-details":
      return getDefaultClientDetailsSettings();
    case "project-details":
      return getDefaultProjectDetailsSettings();
    case "table":
      return getDefaultTableSettings();
    case "totals":
      return getDefaultTotalsSettings();
    case "notes":
      return getDefaultNotesSettings();
    case "signature":
      return getDefaultSignatureSettings();
    case "custom-text":
      return getDefaultCustomTextSettings();
    case "crew-table":
      return getDefaultCrewTableSettings();
    case "spacer":
      return { height: 10 };
    case "page-break":
      return {} as Record<string, never>;
    default:
      return {} as Record<string, never>;
  }
}
