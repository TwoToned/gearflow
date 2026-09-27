import { stickerRegistry, type StickerIllustrationId, type StickerWordmarkId } from "@/lib/brand/sticker-registry";

type Variant = "sticker" | "line" | "patch" | "wordmark";
type Selection =
  | { id: StickerIllustrationId; variant?: "sticker" | "line" }
  | { id: StickerWordmarkId; variant?: "patch" | "wordmark" };
type Meaning = { decorative?: true; label?: never } | { decorative: false; label: string };

export type StickerProps = Selection &
  Meaning & {
    width?: number | string;
    tilt?: boolean;
    className?: string;
    loading?: "eager" | "lazy";
  };

/**
 * RVLT Flow gear illustration / wordmark (docs/brand/rvlt-flow-stickers-pack) —
 * decorative marketing/auth artwork, distinct from the monochrome
 * spot-illustrations used in functional app empty states (DESIGN.md "Empty
 * State Illustrations"). Plain <img>, no client state or SVG loader needed.
 */
export function Sticker(props: StickerProps) {
  const entry = stickerRegistry[props.id];
  const variant: Variant = props.variant ?? entry.defaultVariant;
  const file = (entry.variants as Partial<Record<Variant, { file: string; width: number; height: number; displayWidth: number }>>)[variant];
  if (!file) throw new Error(`Unsupported RVLT sticker variant: ${props.id}/${variant}`);
  const decorative = props.decorative !== false;

  return (
    <img
      src={`/rvlt-art/svg/${file.file}`}
      alt={decorative ? "" : props.label}
      aria-hidden={decorative ? true : undefined}
      width={Math.round(file.width)}
      height={Math.round(file.height)}
      loading={props.loading ?? "lazy"}
      decoding="async"
      draggable={false}
      className={props.className}
      style={{
        display: "inline-block",
        width: props.width ?? file.displayWidth,
        maxWidth: "100%",
        height: "auto",
        verticalAlign: "middle",
        transform: props.tilt ? `rotate(${entry.tilt}deg)` : undefined,
        pointerEvents: decorative ? "none" : undefined,
      }}
    />
  );
}
