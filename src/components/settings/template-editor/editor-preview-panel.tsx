"use client";

import { RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PdfViewer } from "./pdf-viewer";

interface EditorPreviewPanelProps {
  pdfData: Uint8Array | null;
  isLoading: boolean;
  onRefresh: () => void;
}

export function EditorPreviewPanel({
  pdfData,
  isLoading,
  onRefresh,
}: EditorPreviewPanelProps) {
  return (
    <div className="flex flex-1 flex-col bg-muted/30">
      {/* Preview toolbar */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/30 px-4">
        <span className="text-xs font-medium text-muted-foreground">
          Preview
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={onRefresh}
          disabled={isLoading}
        >
          <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* PDF viewer */}
      <div className="relative flex-1 overflow-auto p-6">
        {isLoading && !pdfData && (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-primary/50" />
              <span className="text-sm text-muted-foreground">
                Generating preview…
              </span>
            </div>
          </div>
        )}

        {pdfData && (
          <div className="mx-auto max-w-[700px]">
            {/* Loading overlay during regeneration */}
            {isLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/40 backdrop-blur-[1px]">
                <div className="flex items-center gap-2 rounded-lg bg-card px-4 py-2 shadow-lg border border-border/50">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">Updating…</span>
                </div>
              </div>
            )}

            {/* PDF rendered via pdf.js as canvas */}
            <div className="rounded-lg border border-border/50 bg-white shadow-xl overflow-hidden p-0">
              <PdfViewer pdfData={pdfData} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
