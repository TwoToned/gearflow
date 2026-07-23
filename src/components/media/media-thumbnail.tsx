"use client";

import { ImageIcon } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";

interface MediaThumbnailProps {
  url?: string | null;
  thumbnailUrl?: string | null;
  alt?: string;
  size?: number;
  className?: string;
  onClick?: () => void;
}

export function MediaThumbnail({
  url,
  thumbnailUrl,
  alt = "",
  size = 40,
  className = "",
  onClick,
}: MediaThumbnailProps) {
  const src = thumbnailUrl || url;

  if (!src) {
    return (
      <div
        className={`flex items-center justify-center rounded-md bg-bg-inset ${className}`}
        style={{ width: size, height: size }}
      >
        <ImageIcon className="h-4 w-4 text-fg-3" />
      </div>
    );
  }

  return (
    <div
      className={`overflow-hidden rounded-md bg-bg-inset ${className} ${onClick ? "cursor-pointer" : ""}`}
      style={{ width: size, height: size }}
      onClick={onClick}
    >
      <AppImage
        src={src}
        alt={alt}
        width={size}
        height={size}
        className="h-full w-full object-cover"
      />
    </div>
  );
}
