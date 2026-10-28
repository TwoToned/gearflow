/* eslint-disable @typescript-eslint/no-unused-vars -- next/font needs each call assigned to a module-scope const; the faces are consumed by name from globals.css, never via the return value */
import localFont from "next/font/local";

/**
 * The five brand families (DESIGN.md §5 type stack), self-hosted so `next build`
 * never reaches fonts.googleapis.com. The `next/font/google` loader fetched them at
 * BUILD time, and a runner network hiccup failed the build ("Failed to fetch … from
 * Google Fonts") — in CI and in the Docker image build alike.
 *
 * The woff2 files in `../fonts/` are the exact bytes that loader downloaded (see
 * `src/fonts/README.md`), and each face below reproduces the `@font-face` it emitted:
 * real family name (`globals.css` consumes `"Hanken Grotesk"` etc. by literal name via
 * `--font-sans` / `--font-display` / `--font-mono` / `--font-hand` / `--font-wordmark`),
 * Google's per-subset `unicode-range` (so Cyrillic / Vietnamese / Latin Extended glyphs
 * are still fetched lazily, only when a page uses them) and `font-display: swap`.
 * Only the `latin` file of each family is preloaded, as before.
 *
 * Constraints that shape this file — do not "tidy" them away:
 * - One call per subset file. `next/font/local` applies `declarations` to every `src`
 *   entry in a call, so a per-file `unicode-range` needs a call of its own; the shared
 *   family name comes from the explicit `font-family` declaration.
 * - Every value is a LITERAL: the font transform evaluates call arguments statically,
 *   so a hoisted `const RANGE = …` is silently dropped.
 * - Family names are single-quoted: Turbopack (next 16.4) does not escape `"` inside a
 *   `declarations` value and fails the build with a JSON parse error.
 * - `adjustFontFallback: false`: the `"<Family> Fallback"` faces the Google loader also
 *   emitted were never referenced (the `--font-*` stacks name the real family, then
 *   `system-ui`), so nothing rendered depends on them.
 * - Weights are ranges on the variable files. Kalam is a static 400 file.
 *
 * The consts are never read — next/font only needs the module-scope assignment — and
 * the module is imported for its side effect by the root layout.
 */

// Hanken Grotesk
const hankenGroteskCyrillicExt = localFont({
  src: "../fonts/hanken-grotesk-cyrillic-ext.woff2",
  weight: "400 800",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Hanken Grotesk'" },
    { prop: "unicode-range", value: "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F" },
  ],
});

const hankenGroteskVietnamese = localFont({
  src: "../fonts/hanken-grotesk-vietnamese.woff2",
  weight: "400 800",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Hanken Grotesk'" },
    { prop: "unicode-range", value: "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB" },
  ],
});

const hankenGroteskLatinExt = localFont({
  src: "../fonts/hanken-grotesk-latin-ext.woff2",
  weight: "400 800",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Hanken Grotesk'" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
});

const hankenGroteskLatin = localFont({
  src: "../fonts/hanken-grotesk-latin.woff2",
  weight: "400 800",
  display: "swap",
  preload: true,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Hanken Grotesk'" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
});

// Archivo
const archivoVietnamese = localFont({
  src: "../fonts/archivo-vietnamese.woff2",
  weight: "400 900",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Archivo'" },
    { prop: "unicode-range", value: "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB" },
  ],
});

const archivoLatinExt = localFont({
  src: "../fonts/archivo-latin-ext.woff2",
  weight: "400 900",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Archivo'" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
});

const archivoLatin = localFont({
  src: "../fonts/archivo-latin.woff2",
  weight: "400 900",
  display: "swap",
  preload: true,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Archivo'" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
});

// Baloo 2
const baloo2Devanagari = localFont({
  src: "../fonts/baloo-2-devanagari.woff2",
  weight: "400 700",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Baloo 2'" },
    { prop: "unicode-range", value: "U+0900-097F, U+1CD0-1CF4, U+1CF7-1CF9, U+200C-200D, U+20A8, U+20B9, U+20F0, U+25CC, U+A830-A839, U+A8E0-A8FF, U+11B00-11B0A" },
  ],
});

const baloo2Vietnamese = localFont({
  src: "../fonts/baloo-2-vietnamese.woff2",
  weight: "400 700",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Baloo 2'" },
    { prop: "unicode-range", value: "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB" },
  ],
});

const baloo2LatinExt = localFont({
  src: "../fonts/baloo-2-latin-ext.woff2",
  weight: "400 700",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Baloo 2'" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
});

const baloo2Latin = localFont({
  src: "../fonts/baloo-2-latin.woff2",
  weight: "400 700",
  display: "swap",
  preload: true,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Baloo 2'" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
});

// Geist Mono
const geistMonoCyrillicExt = localFont({
  src: "../fonts/geist-mono-cyrillic-ext.woff2",
  weight: "100 900",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Geist Mono'" },
    { prop: "unicode-range", value: "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F" },
  ],
});

const geistMonoCyrillic = localFont({
  src: "../fonts/geist-mono-cyrillic.woff2",
  weight: "100 900",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Geist Mono'" },
    { prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" },
  ],
});

const geistMonoSymbols2 = localFont({
  src: "../fonts/geist-mono-symbols2.woff2",
  weight: "100 900",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Geist Mono'" },
    { prop: "unicode-range", value: "U+2000-2001, U+2004-2008, U+200A, U+23B8-23BD, U+2500-259F" },
  ],
});

const geistMonoVietnamese = localFont({
  src: "../fonts/geist-mono-vietnamese.woff2",
  weight: "100 900",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Geist Mono'" },
    { prop: "unicode-range", value: "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB" },
  ],
});

const geistMonoLatinExt = localFont({
  src: "../fonts/geist-mono-latin-ext.woff2",
  weight: "100 900",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Geist Mono'" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
});

const geistMonoLatin = localFont({
  src: "../fonts/geist-mono-latin.woff2",
  weight: "100 900",
  display: "swap",
  preload: true,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Geist Mono'" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
});

// Kalam
const kalamDevanagari = localFont({
  src: "../fonts/kalam-devanagari.woff2",
  weight: "400",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Kalam'" },
    { prop: "unicode-range", value: "U+0900-097F, U+1CD0-1CF4, U+1CF7-1CF9, U+200C-200D, U+20A8, U+20B9, U+20F0, U+25CC, U+A830-A839, U+A8E0-A8FF, U+11B00-11B0A" },
  ],
});

const kalamLatinExt = localFont({
  src: "../fonts/kalam-latin-ext.woff2",
  weight: "400",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Kalam'" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
});

const kalamLatin = localFont({
  src: "../fonts/kalam-latin.woff2",
  weight: "400",
  display: "swap",
  preload: true,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "'Kalam'" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
});
