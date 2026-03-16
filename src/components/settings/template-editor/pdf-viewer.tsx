"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface PdfViewerProps {
  pdfData: Uint8Array | null;
  className?: string;
}

/**
 * Renders PDF pages as canvas elements using pdf.js.
 * Much more reliable than iframe-based PDF viewing.
 */
export function PdfViewer({ pdfData, className }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const renderIdRef = useRef(0);

  const renderPdf = useCallback(async (data: Uint8Array) => {
    const currentRenderId = ++renderIdRef.current;

    try {
      // Dynamic import to avoid SSR issues
      const pdfjsLib = await import("pdfjs-dist");

      // Set up worker
      if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();
      }

      const loadingTask = pdfjsLib.getDocument({ data });
      const pdf = await loadingTask.promise;

      // Bail if a newer render was triggered
      if (currentRenderId !== renderIdRef.current) return;

      setPageCount(pdf.numPages);
      setError(null);

      const container = containerRef.current;
      if (!container) return;

      // Clear previous canvas elements safely (no innerHTML)
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }

      // Render each page
      const scale = 2; // 2x for sharp rendering
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);

        // Bail if superseded
        if (currentRenderId !== renderIdRef.current) return;

        const viewport = page.getViewport({ scale });

        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = "100%";
        canvas.style.height = "auto";
        canvas.style.display = "block";

        if (i > 1) {
          canvas.style.marginTop = "12px";
        }

        container.appendChild(canvas);

        const ctx = canvas.getContext("2d");
        if (ctx) {
          await page.render({ canvasContext: ctx, viewport }).promise;
        }
      }
    } catch (err) {
      if (currentRenderId !== renderIdRef.current) return;
      console.error("PDF render error:", err);
      setError("Failed to render PDF preview");
    }
  }, []);

  useEffect(() => {
    if (!pdfData) {
      setPageCount(0);
      const container = containerRef.current;
      if (container) {
        while (container.firstChild) {
          container.removeChild(container.firstChild);
        }
      }
      return;
    }
    renderPdf(pdfData);
  }, [pdfData, renderPdf]);

  if (error) {
    return (
      <div className={`flex items-center justify-center p-8 text-sm text-destructive ${className || ""}`}>
        {error}
      </div>
    );
  }

  return (
    <div className={className}>
      <div ref={containerRef} />
      {pageCount > 1 && (
        <div className="mt-2 text-center text-xs text-muted-foreground">
          {pageCount} pages
        </div>
      )}
    </div>
  );
}
