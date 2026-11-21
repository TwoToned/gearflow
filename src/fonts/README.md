# Self-hosted brand fonts

The five RVLT brand families (DESIGN.md §5 type stack), served from this repo instead
of being downloaded from `fonts.googleapis.com` while `next build` runs. They are loaded
by [`src/app/fonts.ts`](../app/fonts.ts) with `next/font/local`; that file explains how
each face is declared and why. Importing `next/font/google` is a lint error
(`no-restricted-imports`, `eslint.config.mjs`).

| Family | Role (`globals.css`) | Files | Axis served |
|---|---|---|---|
| Hanken Grotesk | `--font-sans` | `hanken-grotesk-*.woff2` (4) | `wght` 400–800 |
| Archivo | `--font-display` | `archivo-*.woff2` (3) | `wght` 400–900 |
| Baloo 2 | `--font-wordmark` | `baloo-2-*.woff2` (4) | `wght` 400–700 |
| Geist Mono | `--font-mono` | `geist-mono-*.woff2` (6) | `wght` 100–900 |
| Kalam | `--font-hand` | `kalam-*.woff2` (3) | static 400 |

There is one file per Google Fonts **subset** (`latin`, `latin-ext`, `vietnamese`,
`cyrillic`, …), exactly as Google splits them. Each is declared with that subset's
`unicode-range`, so a page only downloads `latin-ext` / `vietnamese` / `cyrillic` when it
actually renders such a glyph (Vietnamese and Polish names, for instance); only the
`latin` file is preloaded.

## Provenance

The woff2 files are the bytes `next/font/google` (Next 16.4.0) downloaded on
2026-10-28 for the previous `layout.tsx` declarations — `Hanken_Grotesk` 400–800,
`Archivo` 400–900, `Baloo_2` 400/500/700, `Kalam` 400, `Geist_Mono` (variable) — and
were checked to be byte-identical to what a fresh build emitted. The `unicode-range`
strings in `fonts.ts` are Google's, copied verbatim from its CSS2 response.

## Licence

All five are licensed under the SIL Open Font License 1.1, which requires the notice
and licence to travel with the font files — see [`licenses/`](./licenses). Upstream
copies: <https://github.com/google/fonts/tree/main/ofl>.

## Changing a font

1. Fetch the CSS Google serves for the new declaration with a modern-browser
   `User-Agent` (otherwise it answers with `ttf`), e.g.
   `https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap`.
2. Save each `url(…woff2)` as `<family-slug>-<subset>.woff2` here and add the matching
   `localFont` call (one per file, literal values only) to `src/app/fonts.ts`, copying
   the `unicode-range` from the same CSS block.
3. Update the licence in `licenses/` if the family is new, and the table above.
4. Verify with network access blocked: `HTTPS_PROXY=http://127.0.0.1:1 pnpm build`.
