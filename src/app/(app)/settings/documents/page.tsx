"use client";

import { useServerQuery } from "@/hooks/use-server-query";
import { FileText } from "lucide-react";
import { getDocumentTemplates } from "@/server/document-templates";
import { DocumentTemplateManager } from "@/components/settings/document-template-manager";
import { FadeIn } from "@/components/ui/motion";

export default function DocumentsSettingsPage() {
  const { data: templates, isLoading, refetch } = useServerQuery({
    queryKey: ["document-templates"],
    queryFn: () => getDocumentTemplates(),
  });

  return (
    <FadeIn>
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
        onChanged={refetch}
      />
    </div>
    </FadeIn>
  );
}
