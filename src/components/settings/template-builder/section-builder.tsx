"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
// Custom vertical-only modifier (no @dnd-kit/modifiers package needed)
import type { Modifier } from "@dnd-kit/core";
const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});
import type { DocumentType } from "@/lib/pdfme/types";
import type {
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
  saveTemplateSections,
  publishDocumentTemplate,
} from "@/server/document-templates";
import { EditorTopBar } from "../template-editor/editor-top-bar";
import { EditorPreviewPanel } from "../template-editor/editor-preview-panel";
import { SectionCard, SectionCardOverlay } from "./section-card";
import { SectionLibrary } from "./section-library";
import { SectionSettingsPanel } from "./section-settings-panel";

interface SectionBuilderProps {
  templateId: string;
  templateName: string;
  templateType: DocumentType;
  isDraft: boolean;
  isDefault: boolean;
  version: number;
  initialSections: TemplateSection[];
  brandTemplateId?: string | null;
}

export function SectionBuilder({
  templateId,
  templateName,
  templateType,
  isDraft,
  isDefault,
  version,
  initialSections,
  brandTemplateId,
}: SectionBuilderProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // ─── State ──────────────────────────────────────────────────────────────────
  const [sections, setSections] = useState<TemplateSection[]>(initialSections);
  const [name, setName] = useState(templateName);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSections.length > 0 ? initialSections[0].id : null
  );
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [previewPdf, setPreviewPdf] = useState<Uint8Array | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(true);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  // Undo/redo history
  const [history, setHistory] = useState<TemplateSection[][]>([initialSections]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedSection = sections.find((s) => s.id === selectedId) || null;

  // ─── History helpers ────────────────────────────────────────────────────────
  const pushHistory = useCallback(
    (newSections: TemplateSection[]) => {
      setHistory((prev) => {
        const trimmed = prev.slice(0, historyIndex + 1);
        return [...trimmed, newSections].slice(-50); // Keep last 50 states
      });
      setHistoryIndex((prev) => Math.min(prev + 1, 49));
    },
    [historyIndex]
  );

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    setSections(history[newIndex]);
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const newIndex = historyIndex + 1;
    setHistoryIndex(newIndex);
    setSections(history[newIndex]);
  }, [history, historyIndex]);

  // Keyboard shortcut for undo/redo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  // ─── Section mutations ──────────────────────────────────────────────────────
  const updateSections = useCallback(
    (newSections: TemplateSection[]) => {
      // Recompute order indices
      const ordered = newSections.map((s, i) => ({ ...s, order: i }));
      setSections(ordered);
      pushHistory(ordered);

      // Debounce preview regeneration
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        generatePreview(sectionsRef.current);
      }, 600);
    },
    [pushHistory]
  );

  const addSection = useCallback(
    (type: SectionType) => {
      const settings = getDefaultSettingsForType(type);
      const section: TemplateSection = {
        id: generateSectionId(),
        type,
        settings,
        visibility: {},
        order: sections.length,
        ...(type === "custom-text" ? { content: "" } : {}),
      };
      const newSections = [...sections, section];
      updateSections(newSections);
      setSelectedId(section.id);
    },
    [sections, updateSections]
  );

  const addSections = useCallback(
    (newSections: TemplateSection[]) => {
      const appended = [
        ...sections,
        ...newSections.map((s, i) => ({ ...s, order: sections.length + i })),
      ];
      updateSections(appended);
      if (newSections.length > 0) {
        setSelectedId(newSections[0].id);
      }
    },
    [sections, updateSections]
  );

  const duplicateSection = useCallback(
    (sectionId: string) => {
      const section = sections.find((s) => s.id === sectionId);
      if (!section) return;
      const clone: TemplateSection = {
        ...structuredClone(section),
        id: generateSectionId(),
      };
      const index = sections.findIndex((s) => s.id === sectionId);
      const newSections = [...sections];
      newSections.splice(index + 1, 0, clone);
      updateSections(newSections);
      setSelectedId(clone.id);
    },
    [sections, updateSections]
  );

  const deleteSection = useCallback(
    (sectionId: string) => {
      const newSections = sections.filter((s) => s.id !== sectionId);
      updateSections(newSections);
      if (selectedId === sectionId) {
        setSelectedId(newSections.length > 0 ? newSections[0].id : null);
      }
    },
    [sections, selectedId, updateSections]
  );

  const updateSection = useCallback(
    (sectionId: string, updates: Partial<TemplateSection>) => {
      const newSections = sections.map((s) =>
        s.id === sectionId ? { ...s, ...updates } : s
      );
      updateSections(newSections);
    },
    [sections, updateSections]
  );

  // ─── DnD ────────────────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = sections.findIndex((s) => s.id === active.id);
      const newIndex = sections.findIndex((s) => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(sections, oldIndex, newIndex);
      updateSections(reordered);
    },
    [sections, updateSections]
  );

  const activeDragSection = activeDragId
    ? sections.find((s) => s.id === activeDragId)
    : null;

  // ─── Preview ────────────────────────────────────────────────────────────────
  const generatePreview = useCallback(
    async (currentSections: TemplateSection[]) => {
      setIsPreviewLoading(true);
      try {
        const res = await fetch("/api/documents/template-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            docType: templateType,
            sections: currentSections,
          }),
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
    [templateType]
  );

  // Initial preview
  useEffect(() => {
    generatePreview(sections);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefreshPreview = useCallback(() => {
    generatePreview(sectionsRef.current);
  }, [generatePreview]);

  // ─── Save / Publish ─────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: () =>
      saveTemplateSections({
        id: templateId,
        // Cast needed: TS union SectionSettings doesn't satisfy Record<string, unknown>
        // but Zod validates the shape at runtime
        sections: sectionsRef.current as Parameters<typeof saveTemplateSections>[0]["sections"],
        brandTemplateId: brandTemplateId || null,
      }),
    onMutate: () => setSaveState("saving"),
    onSuccess: () => {
      setSaveState("saved");
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
      setTimeout(() => setSaveState("idle"), 2000);
    },
    onError: () => {
      setSaveState("idle");
      toast.error("Failed to save template");
    },
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      await saveTemplateSections({
        id: templateId,
        sections: sectionsRef.current as Parameters<typeof saveTemplateSections>[0]["sections"],
        brandTemplateId: brandTemplateId || null,
      });
      return publishDocumentTemplate(templateId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
      toast.success("Template published");
    },
    onError: () => toast.error("Failed to publish template"),
  });

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen flex-col bg-background">
      <EditorTopBar
        name={name}
        onNameChange={setName}
        templateType={templateType}
        isDraft={isDraft}
        isDefault={isDefault}
        version={version}
        saveState={saveState}
        onSave={() => saveMutation.mutate()}
        onPublish={() => publishMutation.mutate()}
        isPublishing={publishMutation.isPending}
        onBack={() => router.push("/settings/documents")}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Left panel — Section list */}
        <div className="flex w-[280px] shrink-0 flex-col border-r border-border/30 bg-bg-surface/50">
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/30 px-3">
            <span className="text-xs font-semibold text-fg-3 uppercase tracking-wider">
              Sections
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

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis]}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={sections.map((s) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                {sections.map((section) => (
                  <SectionCard
                    key={section.id}
                    section={section}
                    isSelected={selectedId === section.id}
                    onSelect={() => setSelectedId(section.id)}
                    onDuplicate={() => duplicateSection(section.id)}
                    onDelete={() => deleteSection(section.id)}
                  />
                ))}
              </SortableContext>
              <DragOverlay>
                {activeDragSection && (
                  <SectionCardOverlay section={activeDragSection} />
                )}
              </DragOverlay>
            </DndContext>

            {sections.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <p className="text-sm text-fg-3 mb-2">No sections yet</p>
                <p className="text-xs text-fg-3">
                  Add sections to build your template
                </p>
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-border/30 p-2">
            <SectionLibrary
              onAddSection={addSection}
              onAddSections={addSections}
              currentSections={sections}
            />
          </div>
        </div>

        {/* Middle panel — Section settings */}
        <div className="w-[300px] shrink-0 border-r border-border/30 bg-bg-surface/30">
          <SectionSettingsPanel
            section={selectedSection}
            onUpdate={updateSection}
          />
        </div>

        {/* Right panel — Preview */}
        <EditorPreviewPanel
          pdfData={previewPdf}
          isLoading={isPreviewLoading}
          onRefresh={handleRefreshPreview}
        />
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
