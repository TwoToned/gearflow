# Implementing the RVLT Flow artwork

## 1 Choose a design and a variant

Use the design ID in `manifest.json`. An illustration supports `sticker` and `line`. A wordmark supports `patch` and `wordmark`. The `exports` entries supply exact filenames and public paths; do not derive paths from a display label.

| Variant | Contents | Typical use |
| --- | --- | --- |
| `sticker` | Illustration, coloured shape, cream edge and hard shadow | Standalone decorative accent |
| `line` | Transparent cream drawing | Quieter decoration on espresso or another dark surface |
| `patch` | Shaped label, lettering, border and shadow | Crew language or expressive brand moment |
| `wordmark` | Transparent outlined lettering | A word-based accent on a compatible background |

Most transparent wordmarks are cream; RVLT Flow retains red and cream. The SVGs contain paths, not live font text. No font installation, webfont request, SVG loader or animation library is required.

## 2 Copy the assets into the app

For a Next.js app, copy `assets/svg/` to `public/rvlt-art/svg/` and `assets/licenses/` to `public/rvlt-art/licenses/`. Files in `public` are served from the site root. This follows the [Next.js public-folder convention](https://nextjs.org/docs/app/api-reference/file-conventions/public-folder).

For another framework, use its public/static asset directory and update the base URL. If the app is hosted under a subpath, include that subpath in the asset base. Keep `manifest.json` and the documentation in the project's design resources; they do not need to be loaded at runtime. Do not hotlink to the private gallery.

## 3 Render as an image

```html
<!-- Decoration next to text that already explains the section. -->
<img
  src="/rvlt-art/svg/coffee-mug-sticker.svg"
  alt=""
  width="128"
  height="128"
  style="display:block;width:144px;max-width:100%;height:auto"
>
```

The optional `examples/react/RvltArt.tsx` component wraps the same image behaviour. Copy it together with `asset-registry.ts`; it has no client state, hooks or external image URLs. Its discriminated props accept only the variants appropriate to each design family. `examples/react/usage.tsx` shows both decorative and informative uses. Import it using the target project's normal path conventions.

```tsx
<RvltArt id="coffee-mug" width={144} />
<RvltArt id="show-time" variant="patch" width={250} tilt />
<RvltArt id="rvlt-flow" variant="wordmark"
  decorative={false} label="RVLT Flow" width={190} />
```

`tilt` is opt-in. It applies the gallery's outer rotation once; any internal letter rotation already lives inside the SVG. `basePath` defaults to `/rvlt-art`; set it to the actual public base for your app. `loading` defaults to `lazy`; use `eager` for prominent above-the-fold artwork. The component intentionally uses an ordinary image element. If the app requires a framework image wrapper, keep the same file, aspect ratio, alternative text and local path; no remote SVG configuration is needed for the supplied example.

## 4 Preserve proportions and balance

- Set width and let height follow the SVG. The word patches have different cropped viewBoxes; they must not be forced into identical width/height boxes.
- The manifest's `view_box` is the exact exported string. Its `intrinsic_*_units` describe the vector canvas, not mandatory CSS pixels. `display_width_px` is a suggested starting width.
- A circle, a long tag and a tall Show time patch have different visual weight. Compare their painted bounds side by side rather than using one shared width for every patch.
- Start with 96–240 px for stickers, 160–320 px for patches, and roughly 10% of the shorter visible dimension as space from text. These are recommendations; inspect the actual layout.
- Below 64 px, details may merge. For a small control, use the app's functional UI icon rather than shrinking decorative art indefinitely.
- Preserve the transparent space around the artwork. Avoid `object-fit: cover`, stretching transforms and containers that clip the shadow or letters.
- Responsive containers can cap width with `max-width: 100%`. Remove excess decoration on phones instead of allowing it to overlap text.

## 5 Colour and background

Use `palette.json` for the artwork colours. Artwork cream is `#FFFDF8`; the app's text reference `#F5EFE2` is a separate value. The bright palette is decorative and must not create a second set of status or module tokens.

The full stickers and patches include their colour fill and shadow. Transparent variants show their actual strokes and letters only. Cream artwork will disappear on a very light background; use the full sticker, a dark surrounding surface or a separately reviewed colour variant. Applying CSS `color`, `fill` or a filter to the parent of an external SVG image is not a correct recolouring workflow.

Normal integration does not require SVG optimisation or inlining. If the build inlines SVGs, preserve every clip reference and make internal IDs unique per instance. The curtains contain `curtain-interior`. When several copies are inserted directly into one document, update both the ID and its `url(#...)` references together. External image elements avoid this collision.

## 6 Accessibility and meaning

Use `alt=""` for purely decorative art, including art next to text that already states the same information. Give an informative image an equivalent text alternative. This follows the [W3C decorative-image guidance](https://www.w3.org/WAI/tutorials/images/decorative/). Do not use the SVG filename as alt text.

A word patch is still an image of words. If it conveys a necessary message, provide that message as text or an appropriate accessible name. Keep real buttons, loading indicators, access permissions and live-state displays in the app's normal components. The decorative On air dot and AAA pass are not operational signals.

Use a static composition by default. If motion is later requested, make it optional and respect the app's reduced-motion behaviour. Decorative art must not intercept input or obscure a keyboard focus indicator.

## 7 Integration review

- Confirm each chosen file loads from the deployed app's own path, including a configured subpath.
- Inspect the page at a phone width and a desktop width, with real copy and actual page backgrounds.
- Check clear space, cropping, patch sizing, letter counters and the narrow walkie-talkie silhouette.
- Confirm the mug has no bolt and the pelican still reads correctly at the chosen size.
- Confirm no additional shadow, font request, tinting filter or duplicate SVG ID has been introduced.
- Keep licences with the distributed assets. The manifest hashes refer to the original files in this pack.

## Manifest field reference

| Field | Meaning |
| --- | --- |
| `designs[].id` | Stable design selector, such as `coffee-mug` |
| `family` and `default_variant` | Illustration or wordmark; the default finished presentation |
| `gallery_tilt_degrees` | Optional outer presentation tilt, not baked into the exported file |
| `exports[variant].path` | File path relative to the pack root |
| `public_path` | Suggested URL after copying `assets/` into `public/rvlt-art/` |
| `view_box` and `view_box_values` | Exact SVG canvas origin and dimensions |
| `display_width_px` and `display_height_px` | Proportional starting size, not a hard minimum |
| `has_backing` and `has_embedded_shadow` | Whether the finished sticker/patch treatment is included |
| `internal_svg_ids` | IDs to preserve or namespace if an inline workflow is required |
| `sha256` | Integrity value for the supplied file bytes |
| `licence_files` and `source_url` | Attribution mapping for adapted artwork or outlined fonts |

The React example is an optional adapter, not an installed package or a replacement for the app's design-system components.
