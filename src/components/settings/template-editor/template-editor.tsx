"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { TemplateSettings } from "@/lib/pdfme/template-settings";
import type { DocumentType } from "@/lib/pdfme/types";
import {
  saveTemplateSettings,
  publishDocumentTemplate,
} from "@/server/document-templates";
import { EditorTopBar } from "./editor-top-bar";
import { EditorNavSidebar } from "./editor-nav-sidebar";
import { EditorSettingsPanel } from "./editor-settings-panel";
import { EditorPreviewPanel } from "./editor-preview-panel";

export type EditorSection =
  | "general"
  | "header-footer"
  | "details"
  | "table"
  | "totals"
  | "other";

interface TemplateEditorProps {
  templateId: string;
  templateName: string;
  templateType: DocumentType;
  isDraft: boolean;
  isDefault: boolean;
  version: number;
  initialSettings: TemplateSettings;
}

export function TemplateEditor({
  templateId,
  templateName,
  templateType,
  isDraft,
  isDefault,
  version,
  initialSettings,
}: TemplateEditorProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [settings, setSettings] = useState<TemplateSettings>(initialSettings);
  const [name, setName] = useState(templateName);
  const [activeSection, setActiveSection] = useState<EditorSection>("general");
  const [previewPdf, setPreviewPdf] = useState<Uint8Array | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(true);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Generate preview via API route (returns binary PDF)
  const generatePreview = useCallback(async (s: TemplateSettings) => {
    setIsPreviewLoading(true);
    try {
      const res = await fetch("/api/documents/template-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docType: templateType, settings: s }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const arrayBuffer = await res.arrayBuffer();
      setPreviewPdf(new Uint8Array(arrayBuffer));
    } catch (err) {
      console.error("Preview generation failed:", err);
      toast.error("Failed to generate preview");
    } finally {
      setIsPreviewLoading(false);
    }
  }, [templateType]);

  // Initial preview
  useEffect(() => {
    generatePreview(settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced settings change → preview regeneration
  const handleSettingsChange = useCallback(
    (updates: Partial<TemplateSettings>) => {
      setSettings((prev) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const next: any = { ...prev };
        for (const [key, value] of Object.entries(updates)) {
          if (typeof value === "object" && value !== null && !Array.isArray(value)) {
            next[key] = { ...next[key], ...value };
          } else {
            next[key] = value;
          }
        }
        return next as TemplateSettings;
      });

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        generatePreview(settingsRef.current);
      }, 600);
    },
    [generatePreview]
  );

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: () => saveTemplateSettings(templateId, settingsRef.current, name),
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

  // Publish mutation
  const publishMutation = useMutation({
    mutationFn: async () => {
      await saveTemplateSettings(templateId, settingsRef.current, name);
      return publishDocumentTemplate(templateId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
      toast.success("Template published");
    },
    onError: () => toast.error("Failed to publish template"),
  });

  const handleRefreshPreview = useCallback(() => {
    generatePreview(settingsRef.current);
  }, [generatePreview]);

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
        <EditorNavSidebar
          activeSection={activeSection}
          onSectionChange={setActiveSection}
          templateType={templateType}
        />
        <EditorSettingsPanel
          section={activeSection}
          settings={settings}
          templateType={templateType}
          onSettingsChange={handleSettingsChange}
        />
        <EditorPreviewPanel
          pdfData={previewPdf}
          isLoading={isPreviewLoading}
          onRefresh={handleRefreshPreview}
        />
      </div>
    </div>
  );
}
