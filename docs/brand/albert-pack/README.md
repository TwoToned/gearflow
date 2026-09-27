# Albert — static asset handoff for RVLT Flow

**Use these files as finished static artwork.** Start with the three `locked_approved` PNGs when checking Albert’s identity. Later poses and workday illustrations are companion art. Coloured SVGs are simpler vector derivatives, not frame-perfect copies of the approved PNGs. This handoff contains no animation rigs or experiments.

## Find the right asset

1. Chat button, tiny avatar or inline UI: `svg/albert-icon.svg` at 24–48 px on a light surface; `svg/albert-icon-cream.svg` on a dark surface. Use `svg/albert-avatar.svg` when there is room for the fuller coloured head (64 px or more).
2. Assistant state: choose a coloured `svg/albert-expression-*.svg` (and its `png/` counterpart) at 64 px or more. Ready → avatar; listening → listening; processing → thinking; clarification → puzzled; success → content/happy; recovery → reassuring. Keep labels and status text in real UI text. Catch/blep/wink are occasional playful choices.
3. Landing, header or larger empty state: choose a complete transparent PNG from `illustrations/`. Three approved originals are sitting, roadcase and resting. The six later pose studies and 22 workday pieces have their own identifiers in `asset-manifest.json`.
4. Decoration or branded sticker: `svg/albert-sticker-amber.svg` or `svg/albert-sticker-red.svg` (coloured Albert head, preferably 96 px or larger).
5. Standalone Head drawing: `svg/albert-head-line-espresso.svg` on a **light** background. This is the only included monochrome design; all other everyday treatments use a filled, coloured Albert.
6. Need scalable full-body art: `svg/albert-sitting.svg`, `svg/albert-seated-on-case.svg`, or `svg/albert-master.svg`. These are simplified flat-colour derivatives. For creative review, prefer their locked PNG counterparts.

## Workday surface mapping

| Surface | Illustration |
| --- | --- |
| Equipment, inventory & load-in | `illustrations/albert-on-the-case-v4.png` (Roadcase) |
| Tasks, checklists & job sheets | `illustrations/albert-core-clipboard-v10.png` (Clipboard) |
| Events, show notes & audio | `illustrations/albert-core-microphone-v10.png` (Microphone) |
| Scheduling, bookings & availability | `illustrations/albert-core-calendar-v10.png` (Calendar) |
| Site work & project setup | `illustrations/albert-core-hardhat-v10.png` (Hardhat) |
| Crew, dispatch & operations | `illustrations/albert-core-highvis-v10.png` (High-vis) |
| Safety, inductions & site readiness | `illustrations/albert-core-hardhat-highvis-v10.png` (Hardhat + high-vis) |
| Clients, quotes & the business side | `illustrations/albert-core-suit-v10.png` (Suit) |
| Morning dashboard & taking a break | `illustrations/albert-core-coffee-v10.png` (Coffee) |
| Late shifts & show days | `illustrations/albert-core-energy-v10.png` (Energy drink) |
| Support, comms & crew coordination | `illustrations/albert-work-headset-v11.png` (Headset) |
| Dispatch & team updates | `illustrations/albert-work-walkie-v11.png` (Walkie-talkie) |
| Profiles, permissions & crew passes | `illustrations/albert-work-lanyard-v11.png` (Lanyard) |
| Technical planning & cable inventory | `illustrations/albert-work-cable-v11.png` (Cable) |
| Consumables & quick fixes | `illustrations/albert-work-gaff-v11.png` (Gaff tape) |
| Admin, reports & integrations | `illustrations/albert-work-laptop-v11.png` (Laptop) |
| Billing & payments | `illustrations/albert-work-invoice-v11.png` (Invoice) |
| Budgets, estimates & totals | `illustrations/albert-work-calculator-v11.png` (Calculator) |
| Receiving, orders & logistics | `illustrations/albert-work-delivery-v11.png` (Delivery) |
| Maintenance & repairs | `illustrations/albert-work-toolbox-v11.png` (Toolbox) |
| Show schedules & production cues | `illustrations/albert-work-run-sheet-v11.png` (Run-sheet) |
| Completed jobs & end-of-day states | `illustrations/albert-work-wrap-time-v11.png` (Wrap-time) |

## Character rules

Albert is a compact, solid bearded dragon with a broad low head, cream beard and belly, short splayed limbs, substantial tail, coral cheek markings, rounded eyes and a restrained uneven smile. The seated and resting approved designs define his proportions. His body should remain lizard-like, including when wearing a suit, high-vis or hardhat. Keep the head and beard visible; keep clothes and props fitted to each pose.

Never use uncoloured full-body line art, thin or humanoid redrawing, translucent sticker silhouettes, shiny/overdetailed surface marks, an insect/cricket, or a novelty cursor. Keep Albert filled in. Treat each workday PNG as a complete illustration; **do not detach props, stack finished PNGs, or assume these files form a working puppet**.

Use the character palette from `palette.json`: amber `#EBA53A`, cream `#FFFDF8`, espresso `#141210`, coral `#EF7E55`, and RVLT red `#E0363D`. The illustrated PNGs have subtle colour variation; do not recolour them by replacing all pixels with a flat swatch.

## Placement and accessibility

Preserve aspect ratio and transparency. Leave room around his beard, paws, props and tail; cropping is only appropriate for an intentionally peeking composition. Scale within the original transparent canvas or crop its *transparent margins* consistently. Avoid putting detailed whole-body artwork inside a 24–48 px button. Use meaningful alt text when Albert communicates context (for example, “Albert checks the run-sheet”); use empty alt when he is purely decorative. Convey loading, success and errors in live text, not facial expression alone.

The original three PNGs are SHA-256 locked by `Design-lock.json`. `asset-manifest.json` lists every included file, status, intended use, dimensions and digest for agent lookup and integrity checks. `index.html` is a local, self-contained visual browser; open it after extracting the pack. The original site gallery is also available at https://rvlt-gear-drafts.jayden73358.chatgpt.site/albert.html .

## Scope

31 illustration PNGs = 3 locked references + 6 pose/expression studies + 22 workday companions. 23 coloured/static SVGs with matching transparent PNG exports. One monochrome Head drawing is intentionally retained. Earlier rejected revisions, the dark monochrome drawing, animations, sprites, puppet experiments, source cutouts, code and reference photographs are excluded. This pack contains the currently live approved character identity and companion artwork, **not arbitrary outfit or pose combinations**.
