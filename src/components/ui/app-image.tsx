import Image, { type ImageProps } from "next/image";

/**
 * App image primitive (POLICY.md R-8.1.4) — adopts next/image for its dimension
 * enforcement + default lazy-loading (CLS + below-the-fold wins) across the app's
 * dynamic images.
 *
 * It defaults to `unoptimized` ON PURPOSE. Every user-facing image here comes from
 * one of three sources the Next image optimizer cannot process:
 *  - the auth-gated `/api/files/{storageId}` proxy (`requireOrganization`) — the
 *    optimizer fetches server-side without the user's session cookie, so it would
 *    401 and render broken images;
 *  - `blob:` object URLs (client-side upload previews) — not fetchable server-side;
 *  - `data:` URLs (e.g. generated 2FA QR codes) — nothing to optimize.
 * See docs/adr/0002-next-image-unoptimized.md for the full rationale.
 *
 * For a genuinely static/public asset that SHOULD be optimized, use next/image
 * directly instead of this wrapper.
 */
export function AppImage(props: ImageProps) {
  return <Image unoptimized {...props} />;
}
