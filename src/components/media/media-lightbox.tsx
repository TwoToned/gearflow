"use client";

import { useState, useCallback, useEffect } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";

interface LightboxImage {
  url: string;
  alt?: string;
}

interface MediaLightboxProps {
  images: LightboxImage[];
  initialIndex?: number;
  open: boolean;
  onClose: () => void;
}

export function MediaLightbox({ images, initialIndex = 0, open, onClose }: MediaLightboxProps) {
  const [index, setIndex] = useState(initialIndex);

  useEffect(() => {
    setIndex(initialIndex); // eslint-disable-line react-hooks/set-state-in-effect
  }, [initialIndex, open]);

  const prev = useCallback(() => {
    setIndex((i) => (i > 0 ? i - 1 : images.length - 1));
  }, [images.length]);

  const next = useCallback(() => {
    setIndex((i) => (i < images.length - 1 ? i + 1 : 0));
  }, [images.length]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose, prev, next]);

  if (!open || images.length === 0) return null;

  const current = images[index];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Nav arrows */}
      {images.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); prev(); }}
            className="absolute left-4 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); next(); }}
            className="absolute right-4 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}

      {/* Image */}
      <div
        className="relative h-[90vh] w-[90vw] max-h-[90vh] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <AppImage
          src={current.url}
          alt={current.alt || ""}
          fill
          sizes="90vw"
          className="rounded-lg object-contain"
        />
      </div>

      {/* Counter */}
      {images.length > 1 && (
        <div className="absolute bottom-4 rounded-full bg-black/50 px-3 py-1 text-sm text-white">
          {index + 1} / {images.length}
        </div>
      )}
    </div>
  );
}

/** Hook that manages lightbox state */
export function useLightbox() {
  const [lightboxState, setLightboxState] = useState<{
    open: boolean;
    images: LightboxImage[];
    index: number;
  }>({ open: false, images: [], index: 0 });

  const openLightbox = useCallback((images: LightboxImage[], index = 0) => {
    setLightboxState({ open: true, images, index });
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxState((s) => ({ ...s, open: false }));
  }, []);

  return { lightboxState, openLightbox, closeLightbox };
}
