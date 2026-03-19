"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  CloudUpload,
  Eye,
  Loader2,
  Save,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  updateDocumentTemplate,
  publishDocumentTemplate,
} from "@/server/document-templates";
import { DOCUMENT_TYPE_LABELS } from "@/lib/validations/document-template";
import type { Template } from "@pdfme/common";

interface TemplateData {
  id: string;
  name: string;
  type: string;
  basePdf: string;
  schemas: string;
  isSystemDefault: boolean;
  isDraft: boolean;
  version: number;
}

/** Friendly labels for the plugin sidebar buttons */
const PLUGIN_LABELS: Record<string, string> = {
  text: "Text",
  gearflowTable: "Table",
  gearflowFinancialSummary: "Totals",
  gearflowPageHeader: "Header",
  gearflowPageFooter: "Footer",
  gearflowCheckbox: "Check",
  gearflowSignatureLine: "Sign",
  gearflowCrewTable: "Crew",
  gearflowDataTable: "Data",
  gearflowSummaryBox: "Stats",
  gearflowTextBlock: "Text+",
};

export function DocumentDesigner({ template }: { template: TemplateData }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const designerRef = useRef<InstanceType<
    typeof import("@pdfme/ui").Designer
  > | null>(null);
  const [name, setName] = useState(template.name);
  const [hasChanges, setHasChanges] = useState(false);
  const [isDesignerReady, setIsDesignerReady] = useState(false);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved"
  >("idle");

  const isReadOnly = template.isSystemDefault;

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!designerRef.current) return;
      setSaveState("saving");
      const currentTemplate = designerRef.current.getTemplate();
      return updateDocumentTemplate({
        id: template.id,
        name,
        basePdf: JSON.stringify(currentTemplate.basePdf),
        schemas: JSON.stringify(currentTemplate.schemas),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
      queryClient.invalidateQueries({
        queryKey: ["document-template", template.id],
      });
      setHasChanges(false);
      setSaveState("saved");
      toast.success("Template saved");
      setTimeout(() => setSaveState("idle"), 2000);
    },
    onError: () => {
      setSaveState("idle");
      toast.error("Failed to save template");
    },
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (designerRef.current) {
        const currentTemplate = designerRef.current.getTemplate();
        await updateDocumentTemplate({
          id: template.id,
          name,
          basePdf: JSON.stringify(currentTemplate.basePdf),
          schemas: JSON.stringify(currentTemplate.schemas),
        });
      }
      return publishDocumentTemplate(template.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
      queryClient.invalidateQueries({
        queryKey: ["document-template", template.id],
      });
      setHasChanges(false);
      toast.success("Template published — it's now live");
    },
    onError: () => toast.error("Failed to publish template"),
  });

  // Relabel the pdfme sidebar buttons with friendly names
  const relabelPluginButtons = useCallback(() => {
    if (!containerRef.current) return;
    const buttons = containerRef.current.querySelectorAll(
      ".pdfme-designer-left-sidebar button"
    );
    buttons.forEach((btn) => {
      const titleDiv = btn.querySelector("div[title]") as HTMLElement | null;
      if (!titleDiv) return;
      const pluginName = titleDiv.getAttribute("title") || "";
      const label = PLUGIN_LABELS[pluginName];
      if (label && titleDiv.textContent !== label) {
        // Only change text-based labels (not SVG icons like 'text')
        if (!titleDiv.querySelector("svg")) {
          titleDiv.textContent = label;
        }
      }
    });
  }, []);

  // Initialize designer
  useEffect(() => {
    if (!containerRef.current || isReadOnly) return;

    let designer: InstanceType<
      typeof import("@pdfme/ui").Designer
    > | null = null;

    async function init() {
      const { Designer } = await import("@pdfme/ui");
      const { getDefaultFont } = await import("@pdfme/common");
      const { gearflowPlugins } = await import("@/lib/pdfme/plugins");

      if (!containerRef.current) return;

      const pdfmeTemplate: Template = {
        basePdf: JSON.parse(template.basePdf),
        schemas: JSON.parse(template.schemas),
      };

      designer = new Designer({
        domContainer: containerRef.current,
        template: pdfmeTemplate,
        plugins: gearflowPlugins,
        options: {
          font: getDefaultFont(),
        },
      });

      designer.onChangeTemplate(() => {
        setHasChanges(true);
      });

      designer.onSaveTemplate(() => {
        saveMutation.mutate();
      });

      designerRef.current = designer;
      setIsDesignerReady(true);

      // Relabel after a short delay to let DOM render
      setTimeout(relabelPluginButtons, 300);
      setTimeout(relabelPluginButtons, 800);
    }

    init();

    return () => {
      if (designer) {
        designer.destroy();
      }
      designerRef.current = null;
      setIsDesignerReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id]);

  // Re-relabel on any interaction (pdfme may re-render sidebar)
  useEffect(() => {
    if (!isDesignerReady) return;
    const interval = setInterval(relabelPluginButtons, 2000);
    return () => clearInterval(interval);
  }, [isDesignerReady, relabelPluginButtons]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (!isReadOnly && hasChanges) {
          saveMutation.mutate();
        }
      }
    },
    [hasChanges, isReadOnly, saveMutation]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="flex flex-col h-screen bg-background designer-shell">
      {/* ───── Top toolbar ───── */}
      <div className="designer-toolbar flex items-center gap-2 border-b border-border/60 px-3 py-2 shrink-0 bg-bg-surface/80 backdrop-blur-sm">
        {/* Back */}
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-fg-3 hover:text-fg transition-colors"
          render={<Link href="/settings/documents" />}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Back</span>
        </Button>

        <div className="h-4 w-px bg-border/50" />

        {/* Template name */}
        {isReadOnly ? (
          <span className="text-sm font-semibold tracking-tight truncate max-w-[200px]">
            {template.name}
          </span>
        ) : (
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setHasChanges(true);
            }}
            className="h-7 w-56 rounded-md border-0 bg-transparent px-2 text-sm font-semibold tracking-tight text-fg placeholder:text-fg-3/50 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all hover:bg-bg-inset/50"
            placeholder="Template name"
          />
        )}

        {/* Type badge */}
        <Badge
          variant="outline"
          className="text-[10px] font-medium tracking-wide uppercase border-primary/20 text-primary"
        >
          {DOCUMENT_TYPE_LABELS[template.type]}
        </Badge>

        {/* Status indicator */}
        {!isReadOnly && (
          <div className="flex items-center gap-1.5">
            {template.isDraft && (
              <Badge
                variant="secondary"
                className="text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border-0"
              >
                Draft
              </Badge>
            )}
            {hasChanges && (
              <div className="flex items-center gap-1 text-[10px] text-fg-3/70">
                <div className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                Unsaved
              </div>
            )}
            {saveState === "saved" && !hasChanges && (
              <div className="flex items-center gap-1 text-[10px] text-emerald-500">
                <Check className="h-3 w-3" />
                Saved
              </div>
            )}
          </div>
        )}

        <div className="flex-1" />

        {/* Keyboard shortcut hint */}
        {!isReadOnly && hasChanges && (
          <span className="hidden lg:flex items-center gap-1 text-[10px] text-fg-3/50 mr-1">
            <kbd className="px-1 py-0.5 rounded bg-bg-inset/80 text-[9px] font-mono">
              Ctrl+S
            </kbd>
            to save
          </span>
        )}

        {/* Actions */}
        {!isReadOnly && (
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs border-border/60 hover:border-border"
              onClick={() => saveMutation.mutate()}
              disabled={!hasChanges || saveMutation.isPending}
            >
              {saveState === "saving" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Save className="h-3 w-3" />
              )}
              Save
            </Button>
            <Button
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => publishMutation.mutate()}
              disabled={publishMutation.isPending}
            >
              {publishMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <CloudUpload className="h-3 w-3" />
              )}
              Publish
            </Button>
          </div>
        )}

        {isReadOnly && (
          <div className="flex items-center gap-2 text-xs text-fg-3 bg-bg-inset/50 rounded-md px-3 py-1.5">
            <Eye className="h-3.5 w-3.5" />
            Read-only preview — go back and click Customise to edit
          </div>
        )}
      </div>

      {/* ───── Designer canvas ───── */}
      <div className="flex-1 relative overflow-hidden">
        {isReadOnly ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-bg-inset/50 border border-border/40">
              <Eye className="h-7 w-7 text-fg-3/60" />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-fg">
                System default template
              </p>
              <p className="text-sm text-fg-3 max-w-sm">
                System templates can&apos;t be edited directly. Go back to
                templates and click{" "}
                <span className="font-medium text-fg">Customise</span>{" "}
                to create your own editable copy.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              render={<Link href="/settings/documents" />}
            >
              <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
              Back to Templates
            </Button>
          </div>
        ) : (
          <>
            {!isDesignerReady && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-background z-10 gap-4">
                <div className="relative">
                  <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Loader2 className="h-5 w-5 text-primary animate-spin" />
                  </div>
                </div>
                <div className="space-y-1 text-center">
                  <p className="text-sm font-medium text-fg">
                    Loading designer
                  </p>
                  <p className="text-xs text-fg-3">
                    Setting up the template editor...
                  </p>
                </div>
              </div>
            )}
            <div ref={containerRef} className="h-full w-full" />
          </>
        )}
      </div>
    </div>
  );
}
