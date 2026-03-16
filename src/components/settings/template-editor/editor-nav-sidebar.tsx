"use client";

import {
  Palette,
  FileText,
  LayoutList,
  Table2,
  Calculator,
  Settings2,
} from "lucide-react";
import type { EditorSection } from "./template-editor";
import type { DocumentType } from "@/lib/pdfme/types";

const SECTIONS: {
  id: EditorSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hideFor?: DocumentType[];
}[] = [
  { id: "general", label: "General", icon: Palette },
  { id: "header-footer", label: "Header", icon: FileText },
  { id: "details", label: "Details", icon: LayoutList },
  { id: "table", label: "Table", icon: Table2, hideFor: ["call-sheet"] },
  { id: "totals", label: "Totals", icon: Calculator, hideFor: ["packing-list", "return-sheet", "delivery-docket", "call-sheet"] },
  { id: "other", label: "Other", icon: Settings2 },
];

interface EditorNavSidebarProps {
  activeSection: EditorSection;
  onSectionChange: (section: EditorSection) => void;
  templateType: DocumentType;
}

export function EditorNavSidebar({
  activeSection,
  onSectionChange,
  templateType,
}: EditorNavSidebarProps) {
  const visibleSections = SECTIONS.filter(
    (s) => !s.hideFor?.includes(templateType)
  );

  return (
    <nav className="flex w-[60px] shrink-0 flex-col items-center gap-1 border-r border-border/50 bg-card/50 py-3">
      {visibleSections.map((section) => {
        const isActive = activeSection === section.id;
        const Icon = section.icon;
        return (
          <button
            key={section.id}
            onClick={() => onSectionChange(section.id)}
            className={`group flex w-[48px] flex-col items-center gap-0.5 rounded-lg px-1 py-2 transition-all ${
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            <span className="text-[9px] font-medium leading-tight">
              {section.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
