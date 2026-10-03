# react-pdf migration spike — findings (#1151)

**Status:** spike complete, verdict: **proceed**. Code originally lived at
`src/lib/react-pdf-spike/` — a standalone, self-contained `@react-pdf/renderer`
component tree for the `quote` document type. It is **not wired into**
`generate-pdf.ts` / `pdf-render.ts`; nothing in the production render path
changed. Run it yourself:

```bash
pnpm exec tsx src/lib/react-pdf/render-spike.tsx [outDir]
```

This writes 5 PDFs (long multi-page fixture, the same fixture with the
draft-preview watermark, each header mode, and a fixture sized to check the
forced-page-break edge case) to `outDir` (default: a temp dir, path printed on
exit). Automated coverage: `pnpm vitest run src/lib/react-pdf`.

**Update (#1152, 2026-08-03):** the shared component library this spike
recommended has landed. The code moved to its permanent home,
`src/lib/react-pdf/` (still standalone, still not wired into the production
pipeline), and every remaining plugin — the kit/group/accessory child
renderer, badges, checkboxes, condition columns, per-unit rows, the
signature line, and the invoice-only totals rows — is now built. See
[FEATUREDOCS/13-pdfs.md](../../FEATUREDOCS/13-pdfs.md)'s "Shared component
library built (#1152)" section for the full component map; this document is
kept as-is below as the point-in-time record of what the #1151 spike proved.

## TL;DR

`@react-pdf/renderer` reproduces everything the current `quote` render does,
and the migration isn't just "possible" — it **structurally removes the bug
class #1150 exists to fix**. The two-pass estimate/draw architecture
(`document-composer.ts`'s `calculateItemHeight`/`estimateBlockHeight` vs.
`gearflow-table.ts`'s real draw loop, hand-kept in sync by convention) has no
equivalent in react-pdf: Yoga measures the actual component tree once and
paginates it, so there is no second height estimate to drift out of sync.
Several other hand-rolled mechanisms in the current pipeline turned out to be
things react-pdf does automatically, for free — see below.

## What was built

Covers every feature #1151 asked for, for the client-facing (`clientFacingTable`,
`showKitChildren: false`) quote config:

- Header — all 3 modes (logo/icon/none), org details, doc title + meta
  (project number, date), quote expiry line
- Client/project two-column details row (bold lead line)
- Table: grouped rows (`groupName`), a Project Group's synthetic collapsed row,
  an accessory-parent row — **not** kit/group child expansion (correctly
  suppressed — see scope note below), sub-hire "via Supplier" line
  (`showSubhireOnDocs`), price-breakdown sub-line, markdown-lite notes
- Totals block (subtotal, item discounts, discount, tax, total)
- Client notes, terms & conditions (forced onto its own page)
- Footer with "Page X of Y"
- Draft-preview watermark, repeating on every page (`draftPreview` prop)
- A 60-plain-item + kit + Project Group + accessory-parent fixture, long
  enough to force 4-page pagination with a page break landing mid-group
  (`Category 4` splits across pages 1→2 in the observed render — see below)

**Explicitly out of scope** (per the issue and confirmed correct behavior,
not an oversight): kit/Project-Group/accessory **child** rendering (indented
rows, per-unit checkboxes, badges) — `clientFacingTable.showKitChildren` is
`false` for quote/invoice, so those rows never appear on this doc type. See
"What's NOT proven yet" below — this is real remaining work for issue #4, not
validated by this spike.

## Empirically verified, not just read from docs

Every claim below was checked by actually rendering PDFs and inspecting them
(`render-spike.tsx` + a Python/PyMuPDF page-image dump used during this spike,
not checked in) or by isolated throwaway scripts, not inferred from
react-pdf's documentation alone:

- The 60-item fixture renders to **4 pages** (5 with the watermark on).
  `Category 4`'s items split across pages 1 and 2 — the group header does
  **not** repeat on page 2's continuation, and page 2's own new group headers
  (`Category 5` etc.) render normally. No dropped rows: every item in the
  fixture is visually present across the 4 pages.
- Terms & conditions correctly lands on its own page (page 4 of the main
  fixture) via the `break` prop.
- **The `break` prop does NOT insert a spurious blank page when the block
  already happens to land first on a fresh page** — checked with an isolated
  two-node document (a filler `View` sized to exactly fill page 1, then a
  `break`-marked `View`) and got 2 pages, not 3, in both the exact-fit case
  and an intentionally-undersized filler case. Reading
  `@react-pdf/layout`'s `splitNodes` explains why: a node whose computed
  `top` already falls at/beyond the page boundary is routed to the next page
  via the `isOutside` fast path *before* `shouldBreak()` (which checks the
  `break` prop) is ever consulted — so `break` only ever adds a page break
  when one wouldn't have happened anyway. `document-composer.ts`'s
  `needsForcedPageBreak()` hand-rolls an "isFreshPage" check purely to avoid
  this exact spurious-blank-page failure mode; react-pdf doesn't need the
  workaround **because the bug it works around doesn't exist here**.
- The draft-preview watermark reserves its own space and repeats on every
  page (5 pages instead of 4 for the same 60-item fixture) without dropping
  any table rows — checked via the `quote-document.test.ts` page-count
  comparison, not just visually.
- **The em-dash workaround `gearflow-draft-watermark.ts` needs
  (`toHelvetica()`, converting "—"/curly quotes to ASCII because pdf-lib's
  standard Helvetica throws on encode) is very likely unnecessary in
  react-pdf.** An isolated test rendering `"DRAFT PREVIEW — NOT SENT"` with a
  real em dash through react-pdf's built-in `Helvetica-Bold` font did not
  throw, and the extracted PDF text (via PyMuPDF) round-tripped the exact em
  dash character. `DraftWatermark.tsx` keeps the same normalization anyway,
  as cheap insurance — issue #2 should re-verify across the actual deploy
  target (Docker/Linux, not just this spike's environment) before dropping it.
- Header logo/icon/none modes all render without layout breakage (checked
  visually, with a 1×1 placeholder PNG standing in for a real logo).

## What maps cleanly (and removes hand-rolled logic entirely)

| Current pdfme mechanism | react-pdf equivalent | Effect |
|---|---|---|
| `calculateItemHeight`/`estimateBlockHeight` (composer) + independent draw-time row heights (`gearflow-table.ts`), hand-kept in sync | Yoga measures the real component tree once | The `#1149` bug class is structurally impossible — there is no second estimate to disagree with the draw |
| `isPageFurniture`/`measurePageFurniture`/`placePageFurniture` (composer) for header + draft watermark | `<View fixed>` | One prop; no manual per-page height bookkeeping |
| `isContinuationOfEarlierPage` check (`gearflow-table.ts`, added 2026-07-28 specifically to stop group headers re-drawing on continuation pages) | Nothing — it's the *default* behavior for a non-`fixed` node | Confirmed empirically (Category 4 split above): an ordinary sibling renders once, wherever it lands; only `fixed` nodes repeat |
| Orphan-check bounds test (`currentY - (ghHeight + minBodyRowHeight) < bottomBoundary`) | `minPresenceAhead` prop on the group-header row | One number (reserve ~1 row's height) instead of hand-computed arithmetic |
| `needsForcedPageBreak()`'s `isFreshPage` special case | `break` prop, no special case needed | Verified above — react-pdf's own splitting already avoids the spurious-blank-page failure mode |
| Composer computes `pages.length` up front, then `Page ${i+1} of ${pages.length}` per page | `<Text render={({pageNumber, totalPages}) => ...}>` | Nothing upstream needs to know the total page count at all |
| `PT_PER_MM = mm2pt(1)` + every constant in pt, derived from pdfme's own `mm2pt` (a real historical bug source, #1149) | react-pdf styles accept `"14mm"` etc. directly | No pt↔mm conversion exists to drift — the whole bug class is gone, not just mitigated |
| `resolveFlexWidths()` (hand-rolled flex-width distribution for pt-only pdfme schemas) | `width: "46%"` etc., native flexbox | Deleted, not ported |
| `wrapRichText`/`measureRichTextHeight`/`richTextLineHeight` (exist ONLY because pdf-lib can't wrap or measure wrapped text itself) | `<Text>` wraps to its container automatically | The entire "pre-measure how markdown-lite text will wrap, so the composer's estimate matches the draw" mechanism has no reason to exist |
| `truncateText` + the title auto-shrink-font-size loop (`gearflow-page-header.ts`) | `<Text>` wraps instead of overflowing | See "compromise" note below — not identical behavior, but adequate |

`parseRichText` (the **parsing**, not the pt-based drawing/wrapping) is
reused verbatim from `src/lib/pdfme/plugins/helpers.ts` — same reasoning as
`discountCellText`/`breakdownLabel`, exported from `gearflow-table.ts` this
PR and imported directly rather than re-implemented: the markdown-lite
grammar is content-shape logic, not draw logic, and duplicating it would be
exactly the kind of second hand-maintained copy CLAUDE.md's DRY rule (R-3.1)
flags. `formatCurrency`, `isSubhireIndicatorVisible`, and `lineGrossAmount`/
`discountPercentOf`/`parsePriceBreakdown`/`formatPriceBreakdown` are reused
the same way.

## What needs compromise or a different approach

- **No auto-shrink-to-fit text.** pdfme's header title has a loop that
  decrements font size until the title fits `maxTitleWidth`; react-pdf's
  `<Text>` only wraps or doesn't — there's no built-in "shrink until it
  fits" primitive. For quote/invoice/packing-list/etc.'s fixed-vocabulary
  titles ("QUOTE", "TAX INVOICE", "PULL SLIP"...) this never matters in
  practice (always fits at 22pt). It *would* matter for `truncateText`'s
  other use — `project_number` (which can carry a long quote-version label,
  `v2 · Budget option`) — where pdfme truncates with an ellipsis and
  react-pdf would instead wrap to a second line. Wrapping right-aligned text
  reads fine visually but is a different failure mode than truncation; issue
  #2 should decide (wrap is probably *better* — no information loss — but
  it's a deliberate call, not a transparent port).
- **Kit/group/accessory child rendering is unbuilt**, not merely
  "de-scoped" — it's genuinely absent from this spike because quote/invoice
  never show it. `gearflow-table.ts`'s indented-children logic (children,
  per-unit checkboxes, badges, grandchildren, three font sizes, three indent
  levels) is roughly 600 of its 1363 lines. Issue #4
  (packing-list/return-sheet/delivery-docket, which all set
  `showKitChildren: true`) needs this component and it does not exist yet.
  The mechanisms above (no estimate/draw split, `fixed`, `minPresenceAhead`)
  should transfer directly to it, but that's a claim for issue #4 to verify,
  not one this spike proves.
- **Badges are entirely unexercised.** `showBadges` is `false` for
  `clientFacingTable` (quote/invoice), so this spike never rendered one.
  Trivial to add (a styled `<Text>` or small `<View>`), but genuinely
  untested by this spike.
- **Warehouse-doc-only surfaces are unexercised**: checkboxes, condition
  columns, asset-tag/category columns, row numbers, per-unit checkbox
  sub-rows, the signature block. All out of #1151's scope (quote only), all
  real work for issues #3–#4.
- **Visual measurements are approximate, not pixel-matched.** This spike's
  spacing/padding/line-height values were chosen to look reasonable and
  mirror the *structure* of the current design (same colors, same font
  sizes, same column layout), not measured against a real rendered pdfme
  quote side-by-side. Issue #2's "visual parity signed off against real
  project fixtures" success criterion (from #1150) is NOT met by this
  spike — that comparison hasn't been done yet.
- **`gearflow-financial-summary.ts`'s exact divider-spacing tuning** (a
  `#1149`-adjacent history of "the divider line touched the Total text on
  real renders" fixes) wasn't specifically re-tuned here; `TotalsBlock.tsx`
  uses reasonable but not measured-equal spacing.

## LOC / complexity comparison

| | LOC |
|---|---|
| **Spike — production-shaped code** (`styles.ts` + all of `components/` + `quote-document.tsx`) | **785** |
| Spike — fixture (test scaffolding, adapted from `document-composer.test.ts`) | 287 |
| Spike — automated test | 88 |
| Spike — manual render script (dev tool, not shipped) | 104 |
| Current pipeline — `document-composer.ts` (pagination engine, all 5 doc types) | 1283 |
| Current pipeline — `gearflow-table.ts` (table renderer, all 6 doc types incl. call sheet) | 1363 |
| Current pipeline — `document-layouts.ts` (all 5 doc types) | 308 |
| Current pipeline — `pdf-render.ts` | 26 |
| Current pipeline — `gearflow-page-header.ts` | 276 |
| Current pipeline — `gearflow-page-footer.ts` | 86 |
| Current pipeline — `gearflow-financial-summary.ts` | 130 |
| Current pipeline — `gearflow-draft-watermark.ts` | 101 |
| Current pipeline — `gearflow-rich-text.ts` | 87 |
| Current pipeline — `gearflow-signature-line.ts` | 100 |

**Read this carefully — it is not an apples-to-apples "5x smaller" claim.**
The 785-line spike covers ONE doc type's client-facing config (no child
rendering, no badges, no warehouse columns), against pipeline totals that
cover all 5 doc types plus every one of those extra surfaces. The honest
takeaway is narrower but still real:

- The *pagination engine itself* (`document-composer.ts`'s 1283 lines, most
  of which is height-estimate math with no react-pdf equivalent needed) is
  where the biggest win is — this spike has **zero** lines doing manual
  height estimation, page-fitting arithmetic, or estimate/draw
  synchronization, because none of that exists in the Yoga-based model.
- `gearflow-table.ts`'s ~600 lines of child/grandchild rendering are real
  work issue #4 still has to do — the spike's smaller size partly reflects
  not having built that yet, not react-pdf making it free.
- `document-layouts.ts` (fixed per-doc-type block lists) has a near-direct
  equivalent need in the new world too (something has to say "quote has a
  header, details row, table, totals, notes, T&Cs, in that order") — this
  spike inlines that directly into `quote-document.tsx` rather than
  extracting a declarative layout table; issue #2 should decide whether to
  keep a `DOCUMENT_LAYOUTS`-shaped config or let each doc type's top-level
  component just compose the pieces directly (this spike's approach).

**Net effort read for issues 2–4:** building the shared component library
(issue #2) is smaller than a naive line-for-line port would suggest, because
the pagination-engine chunk of the current code (the single largest file,
`document-composer.ts`) mostly doesn't need a replacement. Building the
child-rendering component (for issue #4's warehouse docs) is genuinely new
work this spike doesn't reduce.

## Pagination/orphan tuning needed beyond react-pdf's defaults

Two custom knobs were needed, both straightforward and already validated:

1. `minPresenceAhead` on group-header rows (orphan protection) — set to
   `17` (points), matching one item row's height. Untested at values much
   smaller/larger; issue #2 should confirm this scales sensibly for
   warehouse docs' shorter child rows too.
2. `wrap={false}` on every atomic row (item rows, group headers, totals
   rows) — without it, Yoga will happily split a row's content across a
   page boundary (e.g. draw "Wireless Handheld Microph-" on page 1 and
   "-one" on page 2), which is never correct. This needs to be applied
   consistently to every atomic unit issue #2's shared library adds — a rule
   worth stating explicitly in that PR ("every table row and total-block row
   is `wrap={false}`"), or it becomes a class of bug all its own.

No other pagination/orphan behavior needed tuning beyond react-pdf's
defaults — table-header repetition, group-header non-repetition, and forced
page breaks all worked correctly out of the box (see "Empirically verified"
above).

## Recommendation

**Proceed with the migration as planned.** The core hypothesis — that
react-pdf's Yoga-based automatic layout structurally eliminates the
estimate/draw divergence bug class — is confirmed, not just plausible.
Suggested adjustments to the issue 2–7 breakdown based on what this spike
found:

- Issue #2 (shared component library) should explicitly include the
  kit/group/accessory **child** renderer as its own component — it's
  unbuilt, not merely deferred, and is the largest remaining chunk of
  `gearflow-table.ts`'s logic to port.
- Issue #2 should do the real visual-parity pass (side-by-side against a
  live pdfme render) this spike didn't attempt — spacing/line-height/divider
  tuning, not just structural correctness.
- Issue #2 should re-verify the em-dash/Unicode question on the actual
  deploy target before dropping `gearflow-draft-watermark.ts`'s
  `toHelvetica()`-style normalization from the ported component.
- Adopt `wrap={false}` on every atomic row and `minPresenceAhead` on every
  header-like row as a house rule from the start, not something
  reverse-engineered later per doc type.
