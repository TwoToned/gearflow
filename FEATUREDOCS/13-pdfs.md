# PDF Document Generation

## Architecture
- `@react-pdf/renderer` renders React components to PDF
- API route: `GET /api/documents/[projectId]?type=quote` streams PDF
- Templates in `src/lib/pdf/`: `quote-pdf.tsx`, `invoice-pdf.tsx`, `packing-list-pdf.tsx`, `return-sheet-pdf.tsx`, `delivery-docket-pdf.tsx`
- Shared styles in `src/lib/pdf/styles.ts`
- Documents accessible from both the **project detail page** and the **warehouse page** via dropdown menus

## Constraints
- **Helvetica only** — no Unicode symbols (use ASCII: `-` not `—`, `|` not `•`)
- Checkboxes rendered as `View` boxes with borders; checked state draws a tick using two rotated `View` lines
- Line item notes shown as subtitles
- Badges: red "OVERBOOKED", purple "REDUCED STOCK"
- Pull slip: per-unit checkboxes for qty > 1 items, ticked for already-deployed units

## Child Rendering (Kits, Prep-Kits, Accessories)
All 5 PDFs use a unified `allChildren` array that includes kit children and accessories.

### Regular Kit Children
- Kit parent shows as group header row
- Children rendered as indented sub-rows

### Nested Kit Children (Kits Inside Prep-Kits)
- When a kit is a child of a prep-kit, it renders as `[Kit] Name` in bold
- The nested kit's own children render at deeper indent (`paddingLeft: 24`)
- Return sheet includes condition checkboxes for nested items
- Quote/invoice include pricing columns for nested items
- Requires 2-level `childLineItems` include with `kit: true` in the API query

### Accessories
- Grandchildren (accessories of kit children) rendered at deeper indent
- For KIT_PRICE kits on quote/invoice, kit children without individual prices are hidden but accessories are shown

### Asset Tag Display on PDFs
- Regular kits/assets: show their asset tag
- Prep-kits with `PREP-*` auto-generated tags: display `"-"` instead
- Prep-kits with case asset tags: show the real tag

## Deployment-Aware Filtering
- **Delivery Docket**: Top-level items filtered to `CHECKED_OUT` only. Kit/prep-kit children filtered to `CHECKED_OUT`. Nested grandchildren also filtered. Total count reflects individual deployed children, not kit-as-1.
- **Return Sheet**: Top-level filtered to `CHECKED_OUT` or `RETURNED`. Children and grandchildren filtered the same way.
- **Pull Slip**: Shows all non-cancelled items. Already-deployed items display with a ticked checkbox (two rotated `View` lines). Bulk per-unit rows tick the first N units matching `checkedOutQuantity`. Total count reflects individual children/grandchildren, not kit-as-1.
- **Quote / Invoice**: All items shown regardless of deployment status.

## T&T Reports
10 PDF templates in `src/lib/pdf/test-tag-*.tsx`. API route: `GET /api/test-tag-reports/[reportType]?format=pdf|csv`. Date objects must be JSON-serialized before passing to PDF components.

| Report | PDF | CSV |
|--------|-----|-----|
| Full Register | Y | Y |
| Overdue/Non-Compliant | Y | Y |
| Test Session | Y | Y |
| Item History | Y | Y |
| Due Schedule | Y | Y |
| Class Summary | Y | Y |
| Tester Activity | Y | Y |
| Failed Items | Y | Y |
| Bulk Asset Summary | Y | N |
| Compliance Certificate | Y | N |
