"use client";

import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { getDocumentTemplates } from "@/server/document-templates";
import { DocumentTemplateManager } from "@/components/settings/document-template-manager";

export default function DocumentsSettingsPage() {
  const { data: templates, isLoading } = useQuery({
    queryKey: ["document-templates"],
    queryFn: () => getDocumentTemplates(),
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="t-heading text-fg">
          Document Templates
        </h2>
        <p className="text-[12px] text-fg-3 leading-relaxed">
          Customise the layout and design of your PDF documents. Each document
          type has a system default that you can customise to match your brand.
        </p>
      </div>

      <DocumentTemplateManager
        templates={templates || []}
        isLoading={isLoading}
      />
    </div>
  );
}
