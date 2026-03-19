"use client";

import { useEffect, useRef, useState } from "react";

interface PdfViewerProps {
  pdfData: Uint8Array | null;
  className?: string;
}

/**
 * Renders a PDF using the browser's native PDF viewer via iframe + blob URL.
 * Supports scrolling, zoom, and page navigation natively.
 */
export function PdfViewer({ pdfData, className }: PdfViewerProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const prevUrlRef = useRef<string | null>(null);

  useEffect(() => {
    // Revoke previous blob URL to prevent memory leaks
    if (prevUrlRef.current) {
      URL.revokeObjectURL(prevUrlRef.current);
      prevUrlRef.current = null;
    }

    if (!pdfData) {
      setBlobUrl(null);
      return;
    }

    const blob = new Blob([pdfData as BlobPart], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    prevUrlRef.current = url;
    setBlobUrl(url);

    return () => {
      URL.revokeObjectURL(url);
      prevUrlRef.current = null;
    };
  }, [pdfData]);

  if (!blobUrl) {
    return null;
  }

  return (
    <iframe
      src={blobUrl}
      className={className}
      title="PDF Preview"
      style={{ width: "100%", height: "100%", border: "none" }}
    />
  );
}
