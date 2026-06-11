"use client";

import { useState } from "react";
import { Plus, BookmarkPlus, Trash2, Loader2 } from "lucide-react";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  SECTION_TYPES,
  SECTION_TYPE_LABELS,
  SECTION_TYPE_DESCRIPTIONS,
  generateSectionId,
  type SectionType,
  type TemplateSection,
} from "@/lib/pdfme/section-types";
import {
  getSectionPresets,
  createSectionPreset,
  deleteSectionPreset,
} from "@/server/section-presets";

interface SectionLibraryProps {
  onAddSection: (type: SectionType) => void;
  onAddSections: (sections: TemplateSection[]) => void;
  currentSections: TemplateSection[];
}

export function SectionLibrary({
  onAddSection,
  onAddSections,
  currentSections,
}: SectionLibraryProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("built-in");
  const [saveMode, setSaveMode] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [presetDescription, setPresetDescription] = useState("");

  const presetsQuery = useServerQuery({
    queryKey: ["section-presets"],
    queryFn: () => getSectionPresets(),
    enabled: open,
  });

  const createMutation = useServerMutation({
    mutationFn: createSectionPreset,
    onSuccess: () => {
      presetsQuery.refetch();
      toast.success("Section preset saved");
      setSaveMode(false);
      setPresetName("");
      setPresetDescription("");
    },
    onError: () => toast.error("Failed to save preset"),
  });

  const deleteMutation = useServerMutation({
    mutationFn: deleteSectionPreset,
    onSuccess: () => {
      presetsQuery.refetch();
      toast.success("Preset deleted");
    },
    onError: () => toast.error("Failed to delete preset"),
  });

  const handleSavePreset = () => {
    if (!presetName.trim()) return;
    if (currentSections.length === 0) {
      toast.error("No sections to save");
      return;
    }
    createMutation.mutate({
      name: presetName.trim(),
      description: presetDescription.trim() || undefined,
      sections: currentSections,
    });
  };

  const handleLoadPreset = (sectionsJson: string) => {
    try {
      const sections = JSON.parse(sectionsJson) as TemplateSection[];
      // Re-generate IDs so they don't conflict with existing sections
      const newSections = sections.map((s) => ({
        ...s,
        id: generateSectionId(),
      }));
      onAddSections(newSections);
      setOpen(false);
    } catch {
      toast.error("Failed to load preset");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setSaveMode(false);
          setPresetName("");
          setPresetDescription("");
        }
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-1.5 text-xs"
          />
        }
      >
        <Plus className="h-3.5 w-3.5" />
        Add Section
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Section</DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full">
            <TabsTrigger value="built-in" className="flex-1">
              Built-in
            </TabsTrigger>
            <TabsTrigger value="presets" className="flex-1">
              Saved Presets
            </TabsTrigger>
          </TabsList>

          <TabsContent value="built-in" className="mt-3">
            <div className="grid gap-1.5">
              {SECTION_TYPES.map((type) => (
                <button
                  key={type}
                  className="flex items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-primary/5 border border-transparent hover:border-border/50"
                  onClick={() => {
                    onAddSection(type);
                    setOpen(false);
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-fg">
                      {SECTION_TYPE_LABELS[type]}
                    </div>
                    <div className="text-xs text-fg-3 mt-0.5">
                      {SECTION_TYPE_DESCRIPTIONS[type]}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="presets" className="mt-3">
            {/* Save current sections as preset */}
            {saveMode ? (
              <div className="mb-4 rounded-lg border border-border/50 p-3 space-y-2">
                <p className="text-xs font-medium text-fg-2">
                  Save current template sections as a reusable preset
                </p>
                <Input
                  placeholder="Preset name (e.g. Bank Details + Signature)"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  className="text-sm"
                />
                <Input
                  placeholder="Description (optional)"
                  value={presetDescription}
                  onChange={(e) => setPresetDescription(e.target.value)}
                  className="text-sm"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1 text-xs"
                    onClick={handleSavePreset}
                    disabled={
                      !presetName.trim() || createMutation.isPending
                    }
                  >
                    {createMutation.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      "Save Preset"
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs"
                    onClick={() => setSaveMode(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1.5 text-xs mb-4"
                onClick={() => setSaveMode(true)}
                disabled={currentSections.length === 0}
              >
                <BookmarkPlus className="h-3.5 w-3.5" />
                Save Current Sections as Preset
              </Button>
            )}

            {/* List presets */}
            {presetsQuery.isLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-fg-3" />
              </div>
            ) : presetsQuery.data && presetsQuery.data.length > 0 ? (
              <div className="grid gap-1.5">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {presetsQuery.data.map((preset: any) => {
                    let sectionCount = 0;
                    try {
                      sectionCount = JSON.parse(preset.sections).length;
                    } catch {
                      /* ignore */
                    }
                    return (
                      <div
                        key={preset.id}
                        className="flex items-center gap-2 rounded-lg px-3 py-2.5 transition-colors hover:bg-primary/5 border border-transparent hover:border-border/50 group"
                      >
                        <button
                          className="flex-1 text-left min-w-0"
                          onClick={() => handleLoadPreset(preset.sections)}
                        >
                          <div className="text-sm font-medium text-fg truncate">
                            {preset.name}
                          </div>
                          <div className="text-xs text-fg-3 mt-0.5">
                            {preset.description || `${sectionCount} section${sectionCount !== 1 ? "s" : ""}`}
                          </div>
                        </button>
                        <button
                          className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10 hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteMutation.mutate(preset.id);
                          }}
                          title="Delete preset"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  }
                )}
              </div>
            ) : (
              <div className="text-center py-6">
                <p className="text-sm text-fg-3">No saved presets yet</p>
                <p className="text-xs text-fg-3 mt-1">
                  Save your current sections to reuse them across templates
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
