"use client";

import { useServerQuery } from "@/hooks/use-server-query";
import { FileText } from "lucide-react";
import { getDocumentTemplates } from "@/server/document-templates";
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
} from "@/lib/validations/document-template";
import { FadeIn } from "@/components/ui/motion";
import { Card } from "@/components/ui/card";

type TemplateListItem = {
  id: string;
  name: string;
  type: string;
  isSystemDefault?: boolean;
};

export default function DocumentsSettingsPage() {
  const { data: templates, isLoading } = useServerQuery({
    queryKey: ["document-templates"],
    queryFn: () => getDocumentTemplates(),
  });

  const list = (templates ?? []) as TemplateListItem[];

  // For each document type, surface the built-in (system default) template name.
  const defaultByType = new Map<string, string>();
  for (const t of list) {
    if (t.isSystemDefault) defaultByType.set(t.type, t.name);
  }

  return (
    <FadeIn>
      <div className="space-y-6">
        <div className="space-y-1">
          <h2 className="t-heading text-fg">Document Templates</h2>
          <p className="text-[12px] text-fg-3 leading-relaxed">
            Each document type uses a built-in template tuned to match your brand.
            These defaults are used automatically when generating PDFs.
          </p>
        </div>

        {isLoading ? (
          <p className="text-[12px] text-fg-3">Loading…</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {DOCUMENT_TYPES.map((type) => {
              const defaultName =
                defaultByType.get(type) ??
                `${DOCUMENT_TYPE_LABELS[type]} — System Default`;
              return (
                <Card
                  key={type}
                  className="flex items-start gap-3 p-4"
                >
                  <FileText className="mt-0.5 size-4 shrink-0 text-fg-3" />
                  <div className="space-y-0.5">
                    <p className="t-body font-medium text-fg">
                      {DOCUMENT_TYPE_LABELS[type]}
                    </p>
                    <p className="text-[12px] text-fg-3">{defaultName}</p>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </FadeIn>
  );
}
