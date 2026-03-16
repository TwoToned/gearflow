"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { getTemplateForEditor } from "@/server/document-templates";
import { TemplateEditor } from "@/components/settings/template-editor/template-editor";
import type { DocumentType } from "@/lib/pdfme/types";

export default function DesignerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const {
    data: template,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["template-editor", id],
    queryFn: () => getTemplateForEditor(id),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary/50" />
          <p className="text-sm text-muted-foreground">Loading template…</p>
        </div>
      </div>
    );
  }

  if (error || !template) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <p className="text-destructive">
          Failed to load template. It may have been deleted.
        </p>
      </div>
    );
  }

  return (
    <TemplateEditor
      templateId={template.id}
      templateName={template.name}
      templateType={template.type as DocumentType}
      isDraft={template.isDraft}
      isDefault={template.isDefault}
      version={template.version}
      initialSettings={template.settings}
    />
  );
}
