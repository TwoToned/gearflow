# Finance workflow — UI/UX design

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-28 (review quarterly — POLICY.md R-5.5)_

**Created:** 2026-07-28
**Companion to:** [`finance-first-class-version-control.md`](./finance-first-class-version-control.md)
(architecture + data model). That doc says *what* the system does; this one says what it looks
like and how it behaves. **Tracking:** #985, phases D (#989), E (#990), F (#992).
**Binding constraint:** [`DESIGN.md`](../../DESIGN.md) — RVLT design language.
**Review status:** reviewed 2026-07-28 via `/plan-design-review` (7 passes + an independent
design agent). Decisions D1–D6 recorded inline. Initial 6/10 → 9/10.

---

## 1. Research — patterns studied, taken, rejected

Surveyed on Mobbin (web): finance document records, version history, locked-state UI.

### 1.1 Finance document records

| Source | Pattern | Verdict |
|---|---|---|
| [Copilot](https://mobbin.com/screens/c42703a2-226d-4957-93ad-e41a1fbef3dc) | Status pill beside the title; key facts as a definition list; history timeline in a right rail | **Take** the definition list; **reject** the timeline (we already have one — §11 F2) |
| [Midday](https://mobbin.com/screens/db7ce37b-95a1-4c40-b909-d3f83c79a2b0) | Big amount, one action row, facts, collapsible activity; stat tiles above the list | **Take** for Phase F |
| [Remote](https://mobbin.com/screens/963a1de6-005a-4133-9523-786ba8503d58) | **PDF preview pane beside the record** | **Take** — the send dialog previews the document beside the fields (§4) |
| [Harvest](https://mobbin.com/screens/65d0fed3-d247-4d1a-91c6-32be8f8f9ab3) | A literal "SENT" stamp across the document | **Take** — validates the DRAFT watermark |
| [Mercury](https://mobbin.com/screens/beaecf88-fff5-4787-b565-2555c2ed9e6a) | Timeline names the *negative*: "created but not sent" | **Take** the copy instinct |

### 1.2 Version history

[Notion](https://mobbin.com/screens/3647446f-f959-4e58-baba-ef7e4f9ab6b0),
[Linear](https://mobbin.com/screens/6c14e085-9ff5-4e61-9a21-b04f1b0a3433),
[Fibery](https://mobbin.com/screens/714aa790-1b39-4ef7-ab48-9402ebeb7aea),
[Substack](https://mobbin.com/screens/d1d0d099-5452-4842-bbb7-681486136291),
[Dropbox Paper](https://mobbin.com/screens/bcfd5f3a-f097-400a-8349-4d64134ac578) all converge:
**large overlay, content left, version rail right, selected row highlighted, restore pinned in
a footer.** Adopt the anatomy. Take Linear's **`‹ 1 of 3 ›` change stepper**; take Dropbox
Paper's quantified header voice ("5 changes since 6 days ago").

**Deliberate divergence — no "Restore".** Every reference offers it; we must not. A sent quote
is an immutable record of what a client was given. Our equivalent is forward-only:
**"Start v(N+1) from this version"**.

### 1.3 Locked states

[IKEA](https://mobbin.com/screens/1b45d6bf-22b8-4965-b04a-a2b26c7a215a) gets the copy shape
right in one line: _"Locked for safekeeping — this design can't be saved. Create a copy to
modify it."_ **State → consequence → the exit.** That is our lock-copy formula (§7.1).
[Adobe Express](https://mobbin.com/screens/afe97676-f21f-4b7b-bd69-f64d7b4eae13) shows the
field-level version. **Rejected:**
[Whop](https://mobbin.com/screens/0c058329-261f-4b41-b8a9-90048a268f69)'s full-page permission
wall — DESIGN.md §8 bans full-page replacement for recoverable states.

---

## 2. Banner soup — the problem to solve before adding anything

Five notices already compete for the top of a project page: reservation conflicts, stale
pricing, an open unlock session, and now lock state and quote drift. They co-occur: a locked
project with a drifted quote and stale pricing is an ordinary Tuesday. Five stacked notices is
not a design.

### 2.1 One rail, action-ordered

`<ProjectAlertRail>` — a single bordered container under the project hero. Rows use DESIGN.md
Notices: **left-edge 3px accent bar + surface background**, never a full-background tint.
Container carries `--sh-card`.

**Sort is two-key: CTA-bearing first, then severity.** Severity alone buries the only row you
can act on. On the ordinary-Tuesday case, severity-only ordering pushes "quote drift" — the
single row with a forward action — to position 5.

| Rank | Condition | Intent | CTA |
|---|---|---|---|
| 1 | Pricing locked (status or quote-sent) | warning | **Create quote v(N+1)** / Unlock financials |
| 2 | Job changed since quote vN | warning | **Create quote v(N+1)** |
| 3 | Reservation conflicts | error | Resolve |
| 4 | Unlock session open | primary | Save & relock · Discard |
| 5 | Hard locked (COMPLETED/INVOICED) | **neutral** | Open full unlock (permitted roles) |

**Hard lock is `neutral`, not `error`.** A completed, invoiced job is the product's happy
ending. DESIGN.md reserves `--t-out`/error for PROBLEM / OVERDUE / FAILED. Painting every
finished job overdue-red trains staff to ignore red, which corrodes the conflict and overdue
signals that actually need it.

**Drift and stale pricing merge into one row.** From the user's seat they are the same
complaint — "this job no longer matches its numbers" — with two remedies. One row, two
actions: `Create quote v3` and `Recalculate pricing`. This also deletes the `2 more notices`
collapse, its `sessionStorage` key, that key's invalidation bug (a rail collapsed yesterday
would hide a hard lock that arrived today), and the announced-but-hidden a11y problem. **Four
notices, all visible, no collapse mechanism.**

**Row anatomy** (specified so it isn't invented five times): 3px left accent · 16px lucide
icon in the intent colour · `t-body` copy in the §7.1 `[state] — [consequence].` form · CTA as
a `line`-variant button, inline right, one per row (a second action becomes a `⋯`). One line at
≥768px, wraps to two below.

**Not sticky**, and — corrected from an earlier draft — **the project hero is not sticky
either**. Only the global top bar (`top-bar.tsx:88`) and `DetailSidebar`
(`page-layouts.tsx:129`, `lg:sticky lg:top-4`) are. So the always-visible lock anchor is the
**sidebar** (§3.2), not a hero chip.

**Subscription ownership.** The rail mounts at project level but three of its notices need
finance data. It must read lock + drift through the **existing** `useProjectLockStatus`
subscription plus one derived drift field on it — never a second quote/invoice subscription for
every user on every tab. Users without `invoice:read` get lock rows only; finance rows are
omitted, not empty.

---

## 3. The Finance tab

### 3.1 Position

Top-level project tab: `Equipment · Labour & logistics · Finance · Tasks · Notes · Files`. The
old `Financials` tab is retired, its content absorbed. Hidden on templates.

**Auth-gated:** without `invoice:read` the tab is **present but shows a permission notice** —
not hidden. Hiding it reflows the tab bar between roles and breaks `?tab=finance` deep links
(DESIGN.md §8 requires an auth-gated state; a broken link is not one).

### 3.2 Layout and the sticky rail

The tab keeps the standard **63/37 detail split** (D2). Two consequences, both deliberate:
rows stay lean enough for 63%, and anything wide gets its own overlay (§8).

**The sticky sidebar becomes the finance rail on this tab** — swapping Schedule/Location/Team
for what the job actually is while you are doing money. This is the only always-visible surface
in the layout, so lock state lives here:

```
Lock                        ← always mounted, always positive (§7.2)
  Pricing locked · v2 with client
  [ Create quote v3 ]

Value                       ← SectionHeader
  Current project value
  $18,400   +$280 vs quote v2      ← t-data, 38px hero figure on the first line
  Invoiced      $4,530
  Outstanding  $13,590
```

**Two adjacent unlabelled totals is the tab's worst failure mode** — the draft's value
(`$18,400`) and the sent quote's value (`$18,120`) are different numbers with different
meanings. Every currency figure here is labelled by provenance, and the delta against the
client-held revision is explicit. `Discount −0` and any other zero row does not render.

**The Money block is cut entirely.** `ProjectSummaryStrip` (`page.tsx:477`) already renders
totals across the top of every project page and `ProjectCostsPanel` (`:636`) sits below — a
third summary in the same viewport was noise the original banner-soup audit missed.

### 3.3 Section order follows the lifecycle (D4)

| Phase | Order |
|---|---|
| Pre-acceptance (ENQUIRY → QUOTED) | **Quote** → Invoices → Costs |
| Post-acceptance (CONFIRMED +) | **Invoices** → Quote *(collapsed to one line: `v2 · Accepted 26 Jul · $18,120 · PDF · History`)* → Costs |

Same components, one switch on lifecycle. A project spends most of its life post-acceptance; a
fixed order leaves an archive permanently above live work.

```
┌─ Quote ────────────────────────── [ Create quote v3 ] ─┐   ← header button, see §3.4
│  v3  Draft        $18,400   Preview            ⋯       │
│      Not sent yet · 3 changes since v2                 │
│  v2  Sent 26 Jul  $18,120   Mark accepted      ⋯       │
│      To Sarah Chen · Valid until 25 Aug (28 days)      │
│  v1  Superseded   $16,900   PDF                ⋯       │
│      Sent 19 Jul by Jayden                             │
│  Show 4 earlier revisions                              │
├─ Invoices ─────────────────────── [ New invoice ▾ ] ───┤
│  INV-2026-0043  Deposit  Issued 25 Jul  $4,530  ⋯      │
│  —              Balance  Draft          $13,590 Issue…  │
└─ Costs / P&L  (ProjectCostsPanel) ─────────────────────┘
```

Sections separated by 32px and a `SectionHeader`; **no card chrome on rows**.
`ProjectCostsPanel` carries its own card — it renders last, where the idiom change reads as a
boundary rather than an inconsistency.

`New invoice ▾` replaces three equally-weighted `Deposit`/`Balance`/`Full` buttons for a
decision made once per project.

**Revision list is bounded and sorted.** Descending by version, always. Show the draft (if
any) + the current SENT/ACCEPTED + `Show N earlier revisions`. A haggled job reaches v7; six
dead rows would push invoices below the fold.

### 3.4 The `Create quote v(N+1)` button — one owner

**The Quote block header button is the sole owner** of this action, whenever the current
revision is SENT or ACCEPTED. When the current revision is a DRAFT the same slot reads
`Send quote v3`. The alert rail may *echo* it; it may not own it. In the reviewed draft this
action existed only in a rail row that collapsed by default — the primary forward action in the
entire workflow had no designed home.

### 3.5 Revision row

Two lines, no card chrome. Table-like list per DESIGN.md Tables (1px `border-top`, left-edge
2px red bar on hover, no full-row tint).

- **Line 1:** `v3` in `t-mono` **at 13.5px** (`t-mono` defaults to 12px; the row's primary
  identifier must not be its smallest element) · state pill · total right-aligned
  `tabular-nums` · **one** primary action · `⋯`
- **Line 2:** `t-micro text-muted` — recipient, validity, sender, or drift count

**State → intent** — new `quoteStatusIntent()` in `src/lib/status-colors.ts`, alongside
`assetStatusIntent`; rendered with `Badge`, never `StatusIndicator` (both exist and differ):

| State | Intent | Note |
|---|---|---|
| Draft | neutral | |
| **Sent** | **info** (`bg-blue-soft text-blue`) | |
| **Accepted** | **primary** (`bg-red text-white`) | |
| Declined | error | |
| Expired | warning | |
| Recalled | warning | |
| Superseded | **no pill** — plain `text-muted` text | a dead revision doesn't earn a filled shape |

> **Corrected during review.** An earlier draft assigned solid red to *Sent* and green to
> *Accepted*. DESIGN.md:154 and :255 both define solid `--red` as LIVE / ACTIVE / IN-USE and
> name its members: "CHECKED_OUT, ON_SITE, **ACCEPTED**". The draft inverted the design
> system's own worked example, and put a solid-red pill on the busiest row of the busiest tab
> beside red hover bars and the red primary button.

**Validity urgency**, colour **and** words: `Valid until 25 Aug (28 days)` `text-muted` →
**≤7 days** `text-warn` + `(3 days left)` → past `text-t-out` + `Expired 2 days ago`.
(The companion doc's "within 3 days" was a second copy of this constant; **7 days is
authoritative**, R-3.1.)

**Formatting rules, stated once:** currency always `formatCurrency` with symbol and 2dp
(`$18,120.00`); zero rows suppressed entirely; every figure `tabular-nums`. All day-boundary
maths (validity, expiry, "sent 26 Jul") resolves through `datePartsInTimezone` in the **org's**
timezone, never the browser's — a quote must not expire a day early for a PM in another state.

### 3.6 The action matrix

The single largest specificity gap in the reviewed draft was the word "actions". Written out so
`QuoteRevisionRow` and the revision viewer cannot disagree:

| State | Primary (inline) | In `⋯` | Gated |
|---|---|---|---|
| Draft | `Preview` | Delete draft | Delete: `invoice:publish` |
| Sent | `Mark accepted` | PDF · Compare · Mark declined · **Recall** | Recall: admin/owner **or** project PM |
| Sent + expired | `Re-send` | PDF · Compare · Mark declined | `Mark accepted` is present but gated, tooltip: *"Quote v2 expired on 25 Aug. Re-send it, or make v3."* |
| Sent + no artifact yet | `Generating…` (spinner) | Compare | after 30s → `Generation failed · Retry` |
| Accepted | `PDF` | Compare · Start v(N+1) | |
| Declined / Superseded / Expired / Recalled | `PDF` | Compare · Start v(N+1) | |

**Permission rule:** a user without `invoice:publish` sees every row and every artifact, and
every mutating action rendered per §7.4 (visible, explained, unavailable) — never hidden.
**Lock rule:** HARD_LOCKED gates `Create v(N+1)`, `Recall` and `Mark accepted` behind the
full-unlock session, with the §7.1 copy.

**Recall confirmation** (a `Dialog`, since recall is the one destructive-feeling verb):
> **Recall quote v2?** — Sarah Chen may already have this PDF; recalling doesn't unsend their
> copy. v2 returns to draft and its document stays in the history, marked Recalled.
> Reason (required) · `[ Cancel ] [ Recall v2 ]`

**Decline capture:** `Mark declined` opens a small `Dialog` — reason (optional, 500 max) and
an offer, not a forcing: *"Cancel this project too?"* as an unchecked checkbox.

**Acceptance capture:** `Mark accepted` opens a `Dialog`, not a bare click — it captures the
acceptance date and an optional reference (PO number, email subject) that an accountant will
later need. A one-click accept would silently drop that field.

### 3.7 Empty states

- **No client:** 56px `documents` spot illustration (`text-primary/60`) in its container,
  `t-heading` "No client on this project", `t-micro` "Quotes and invoices need a client to
  bill.", primary `Assign client`. No Kalam — it neighbours money.
- **No invoices yet:** this is the state of *every* project until deposit time and the
  reviewed draft claimed it couldn't happen. `t-micro text-muted` inline: "No invoices yet." +
  the `New invoice ▾` button already in the header. No illustration — an expected state doesn't
  earn a hero empty state.
- **No quotes at all:** should be impossible post-Phase A, but the migration halts on a count
  mismatch, which produces exactly this. Renders `Create quote v1` rather than a blank block.

---

## 4. Send quote dialog

Radix `Dialog`, `--r-lg` (20px), `--sh-card`, max-width 880px.

```
┌─ Send quote v3 ──────────────────────────────────── ✕ ─┐
│ ┌────────────────────────┐ ┌─────────────────────────┐ │
│ │ Quote date [28 Jul 26] │ │   ┌─────────────────┐   │ │
│ │ Valid for  [30] days   │ │   │ DRAFT PREVIEW   │   │ │
│ │            → 27 Aug 26 │ │   │  — NOT SENT —   │   │ │
│ │ Send to    [Sarah Chen]│ │   └─────────────────┘   │ │
│ │ Notes      [         ] │ │  Download draft PDF     │ │
│ │ ── Summary ──          │ └─────────────────────────┘ │
│ │ 42 lines · 3 services  │                             │
│ │ Total       18,120.00  │                             │
│ └────────────────────────┘                             │
│  Sending freezes pricing at v3. To change prices, v4.  │
│  Flow doesn't email clients — this makes the PDF.      │
│                          [ Cancel ]   [ Send v3 ]      │
└────────────────────────────────────────────────────────┘
```

**Why a preview pane.** "What am I about to send" is the actual question and a form can't
answer it. Renders lazily behind a `<Skeleton>` (solid `--elev`, no gradient), never blocks the
dialog opening, and degrades to `Preview unavailable — you can still send`. **Never a gate.**
Page 1 only, with `Download draft PDF` — no in-dialog pagination; we are not building a
document viewer.

**Fields.** Quote date (defaults today, max +1 day — *"A quote can't be dated more than a day
ahead."*). Valid for (days + resolved date, from `quoteValidityDays`). Send to — client-contact
combobox, **must** be the Radix `combobox-picker.tsx`, since a Base UI popup inside a Radix
modal inherits the body `pointer-events: none` lock and swallows every click (CLAUDE.md; this
has broken pickers here before). Empty contact list → `No contacts on this client` +
`Add contact`, and sending stays possible (the PDF is still valid). Notes, 2000 max, counter
past 1800, over → *"Notes are limited to 2,000 characters."* **No monetary input** (R-9.3).

### 4.1 Submit — and the terminal state that hands over the PDF (D3)

Submit → spinner, label `Sending…`, fields disabled → then `Generating document…`. The dialog
**waits for the artifact, up to 8 seconds**; past that it closes anyway and the row shows
`Generating…`. The quote is sent either way.

**The dialog does not close on success. It becomes the handover:**

> **Quote v3 sent** — pricing is now locked at v3.
> `[ Download PDF ]`  `[ Copy summary for email ]`  `[ Done ]`
> *This job is at Quoting. Move it to Quoted?* `[ Move ]`

The user's next act is to open their mail client and attach the PDF. The reviewed draft closed
the dialog, fired a toast, and then asked *the system's* question ("Advance to Quoted?") —
giving them a modal instead of a file and three clicks back to the thing they came for. The
status prompt becomes a passive offer **inside** this state, never a second modal.

**On error:** inline notice above the footer, **fields stay filled and editable**, focus moves
to the notice. Re-typing four fields after a network hiccup depletes goodwill fast.
**Dirty-close:** `Esc` with changes → inline confirm bar within the same dialog
(*"Discard this send? [Keep editing] [Discard]"*) — **not** a nested Dialog, which is a known
footgun here and would need the banned `AlertDialog` shape.

---

## 5. Invoice issue dialog

Same skeleton, 640px, no preview pane (the content is the quote's, already seen). Invoice date;
**due date** defaulting to invoice date + `paymentTermsDays` and labelled `Net 14`; notes;
read-only server-computed amounts. Same loading / error / dirty-close behaviour as §4.

Footer: *"Issuing assigns INV-2026-0044 and locks this invoice. Corrections need a credit
note."* Success is a terminal state with `Download PDF`, matching §4.1.

**Xero states on the row** (the reviewed draft showed only `Xero ✓`): not connected → nothing
renders · pending → `Pushing…` · pushed → `Xero ✓` `text-ok` · failed → `Xero failed` `text-warn`
+ `Retry` in `⋯`. Never a bare tick with three invisible siblings.

**Already-issued deposit:** the `New invoice ▾` menu keeps the Deposit item visible and gated
per §7.4 — *"A deposit invoice was already issued (INV-2026-0043)."*

---

## 6. Interaction state matrix

DESIGN.md §8 requires every applicable state. What the **user sees**, not backend behaviour.

| Surface | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| **Finance tab** | Skeletons matching revision-row shape; solid `--elev`, min 200ms | §3.7 | Left-edge red notice + `Retry`; shell stays, never a blank page | — | Quotes loaded, invoices still loading → independent skeletons |
| Finance tab (authz) | — | — | — | — | No `invoice:read` → permission notice in place of content; tab stays mounted |
| **Revision row** | — | — | Sent, no artifact → `Generating…`; after 30s `Generation failed · Retry` (retry only callable while the artifact is absent) | New row fades in, 150ms | — |
| **Send dialog** | `Sending…` → `Generating document…`, 8s ceiling | — | Inline notice, fields preserved, focus moved | Terminal handover state (§4.1) | Mutation OK + render failed → **still the success state**, `Download PDF` replaced by `Document generating — we'll have it shortly` |
| **Preview pane** | Skeleton page + `Rendering preview…` | — | `Preview unavailable` + `Try again`; never blocks Send | Page 1 + `Download draft PDF` | — |
| **Issue dialog** | As send | — | As send; number collisions retry server-side, user sees only the spinner | Terminal state + `Download PDF` | — |
| **Revision viewer** | Content skeleton left, rail skeleton right | Single revision → compare control disabled, tooltip *"v1 is the first version — nothing to compare yet"* | Snapshot unreadable → *"This version's detail couldn't be loaded"* **and the PDF stays downloadable** | — | No differences → stepper reads `No changes`; diff too large → first 50 + `50 of 214 changes shown` |
| Revision viewer | — | Pre-versioning quote (no snapshot, by design) → *"Sent before version history — the PDF is the record"* + download | — | — | — |
| **Alert rail** | Nothing — never skeleton a notice | Renders nothing | Lock status unreadable → **fail closed**: *"Lock state unknown — refresh before editing"*, actions gated | — | Some conditions resolved → render those, omit rest silently |
| **LockedField** | Lock status `undefined` on first paint → renders **locked**, then relaxes | — | — | — | — |
| **Org Finance (§9)** | Section skeletons, tiles last | Groups omitted; whole-page zero state | Notice + `Retry`; tiles keep last values greyed | — | One section failed → inline retry there, others render |

**Four rules this encodes:**

1. **Fail closed on lock state.** Unknown lock → gate and say so. Assuming unlocked lets
   someone edit a hard-locked job because a query blipped. The same applies to
   `<LockedField>`'s first paint: render locked and relax, never editable-then-snap — which
   would be both a layout shift and a correctness flicker.
2. **Never lose typed input on error.**
3. **The artifact outranks the record.** If the snapshot won't load but the PDF exists, offer
   the PDF. The client is holding that document.
4. **A successful send is a success even if the render failed.** The quote *is* sent; the UI
   must not imply otherwise.

---

## 7. Lock UX

### 7.1 The copy formula

**`[state] — [consequence]. [the exit].`** One `lock-copy.ts` module so six surfaces can't
drift (R-3.1).

| Situation | Copy |
|---|---|
| Quote sent | **Pricing locked** — quote v2 is with the client. Make v3 to change prices. |
| Confirmed+ | **Pricing locked** — this job is confirmed. Unlock financials to edit money. |
| On site | **Changes need a reason** — this job is on site. You'll be asked why. |
| Hard locked | **Locked** — this job is completed. Admins and its PM can open a full unlock. |
| Session open | **Unlocked by Jayden · 12m** — "client added two movers". Save & relock, or discard. |
| Drift + stale | **This job no longer matches its numbers** — 2 lines added, rental window +2 days. |
| Can't confirm | **Quote v2 hasn't been accepted** — mark it accepted, or confirm anyway with a reason. |

No personality, no Kalam, no mascot (DESIGN.md bans them in lock/compliance contexts).
Sentence case throughout.

### 7.2 Lock indicator — sticky sidebar, always positive

Lives in the **sticky sidebar** (§3.2), the only always-visible surface. Always mounted, always
stating something:

- `Editing v3 (draft)` — neutral
- `Pricing locked · v2 with client` — `bg-warn-soft text-warn`
- `Locked` — `bg-rep-soft text-rep` (neutral; a completed job is not a problem)
- `Unlocked by Jayden · 12m` — `bg-red text-white`, live

**Absence is not a state.** After creating v3 the reviewed draft communicated "you are now
editing a draft" by *removing* a badge — the whole mental model this program sells,
communicated by a disappearance.

Timer: `12m` → `1h 4m` → `3h+` above three hours; a session open overnight reads
`since yesterday 18:40`. `aria-live="off"` — announcing every minute would be hostile.

Icons are lucide `Lock` / `LockOpen` at 12px in the intent colour — **never `🔒`/`🔓` emoji**,
which DESIGN.md bans and which render as colour glyphs against a single-red-accent system.

### 7.3 Field level — `<LockedField>`

A wrapper, so there is one implementation. Renders the value as static text **in the input's
exact metrics** — same border width, padding, line-height, and 44px mobile min-height — so
there is no reflow between states. `bg-paper-2`, `border-line`, `text-ink-2`, 12px lock glyph
inset right. Tooltip carries the §7.1 copy plus the exit as a link. `aria-readonly` +
`aria-describedby` → the reason, so screen readers get the explanation that glyph-plus-colour
alone would not deliver.

Applies to: `price-edit-dialog`, `edit-line-item-dialog`, `line-item-form-fields`,
`edit-group-dialog`, `add-service-dialog`, `crew-panel` rates, `bulk-edit-line-items-dialog`,
and the project edit form's tax/discount inputs.

### 7.4 Action level — the `disabled` trap

A `disabled` button fires no pointer events, so its tooltip never opens: a dead control and
*no explanation*, which is worse than today's toast. Gated actions therefore use
`aria-disabled="true"` + `opacity-45` + `cursor-not-allowed` + a no-op handler + a real tooltip
(inside its own `TooltipProvider` — there is no global one) + keyboard focusable.

Gated menu items show the lock glyph and the reason as a `t-micro` second line rather than
vanishing. Disappearing controls teach nothing.

### 7.5 The CONFIRMED acceptance gate

Undesigned in the reviewed draft, and it fires at the most emotionally loaded moment in the
workflow — the client just said yes and the PM wants the job green. A raw `ConvexError` toast
here reads as a broken product.

Advancing to CONFIRMED without an accepted quote opens a `Dialog`:

> **Quote v2 hasn't been accepted**
> Mark it accepted first, or confirm anyway and say why.
> `[ Mark v2 accepted ]` (primary) · reason field (10–1000 chars) · `[ Confirm anyway ]`

`Confirm anyway` is gated per §7.4 for anyone outside the override audience (admin/owner or the
project's PM), tooltip: *"Only admins and this job's PM can confirm without an accepted quote."*
The primary path is the *correct* one, one click away.

### 7.6 Unpriced badge, and the composite on-site state

`UnpricedBadge` (built, mounted nowhere) goes on every `$0`-defaulted line and group:
*"Added while pricing was locked — set a price in the next quote version."*

**The composite ON_SITE state** — JUSTIFY tier + `$0` lines + drift against an accepted quote,
all at once — is the *normal* state of a live job and must render coherently: the rail shows
**one** row (drift, CTA `Create quote v3`), the sidebar shows `Changes need a reason`, and
unpriced lines carry badges. It is legitimate to create v3 for a running job; that is how
on-site additions get billed.

### 7.7 List, board and card glyphs

12px lucide `Lock` beside the project status on `project-table`, `project-board` and dashboard
cards, `text-muted`, tooltip carrying the §7.1 state line. Derived from row data already
present — no extra query. This is what makes the lock knowable *before* you open the project.

---

## 8. Revision viewer & compare

Full overlay `Dialog`, `--r-lg`, `--sh-card`, 90vw × 85vh. Content left, revision rail right.

```
┌─ Quote v2 · RVLT-2026-0087 ───────────────────── ✕ ─┐
│ ┌───────────────────────────┐ ┌──────────────────┐  │
│ │ (read-only "as of v2")    │ │ v3 Draft  Current│  │
│ │  Lighting                 │ │ v2 Sent 26 Jul ● │  │
│ │  6× Source Four 1,200 →1,320│ │ v1 Superseded   │  │
│ │  + 1× Followspot      480 │ │ ──────────────── │  │
│ │  Total   16,900 → 18,120  │ │ [vs previous]    │  │
│ └───────────────────────────┘ │ [vs the job now] │  │
│  ‹  Change 1 of 3  ›          └──────────────────┘  │
│  [ Download PDF ]        [ Use v2's pricing for v4 ]│
└──────────────────────────────────────────────────────┘
```

**Trimmed per D5.** Highlighting is **always on** — a toggle that turns off the reason you
opened compare view isn't a feature. The `‹ 1 of 3 ›` stepper stays; at 120 lines a diff list
is unusable. The any-version picker is replaced by a **two-item segmented control**:
`vs previous` and `vs the job now` — the only two comparisons anyone actually makes, and half
the empty/error surface.

Changed rows are marked with `--select` (`rgba(224,54,61,.20)`) held while stepped to, then
faded — an in-system token, not an invented "pulse". No second activity timeline here:
`ProjectActivityFeed` already reads the same `activityLog` from the sticky sidebar.

### 8.1 Reprice-from-revision — the forward-only undo (decided, Phase D)

Primary action is **`Use v2's pricing for v4`**, never `Restore` (§1.2). Shown only when no
draft exists, preserving the one-draft invariant.

**What it does:** creates the next draft revision and resets the project's **money fields** to
that revision's values. Structure is untouched — same gear, same quantities, same dates. It is
the forward-only equivalent of the Restore every reference pattern offers, and it exists
because a user who can compare two versions will reach for the undo; that is what comparing is
for.

**The label is deliberately narrow.** An earlier draft read "Start v4 from this version", which
reads as restoring the whole job, gear included. It doesn't, and an undo people misread is an
undo people stop trusting.

**Mechanically it is small:** `restoreProjectSnapshot` with `scope: "FINANCIAL"`
(`convex/lib/projectSnapshots.ts:198`) already patches only `LOCKED_PROJECT_FIELDS` /
`LOCKED_GROUP_FIELDS` / `LOCKED_LINE_ITEM_FIELDS` from a snapshot, and clears prices to unset
(rather than deleting rows) for anything added since (`:233`). That is exactly this behaviour.
The mutation composes `newVersionNative` + that call in one transaction, through
`assertLifecycleGuard`, writing **one** audit entry for the whole operation — not one per line.

**Confirm dialog — it must disclose both surprises before it runs:**

> **Use v2's pricing for v4?**
> v4 will be created with the prices from quote v2. Gear, quantities and dates are unchanged.
> · **3 items added since v2 have no price in it** — they'll be unpriced and need one.
> · The rental window has changed since v2, so these prices were worked out over a different
>   duration. *(shown only when the window actually moved)*
> `[ Cancel ]` `[ Create v4 with v2's pricing ]`

Silent `$0` lines on a quote are exactly the failure this program exists to prevent, so the
unpriced count is stated up front, not discovered afterwards via badges.

**The artifact never changes.** A superseded revision's PDF downloads byte-identical to the day
it was sent — no retroactive "SUPERSEDED" stamp, because the client's copy doesn't have one.
The UI carries the state; the bytes stay honest. This is the deliberate divergence from
Harvest's live-stamped document, and it is the whole point of Phase B.

---

## 9. Org-level Finance section (Phase F)

**Nav:** directly below `Projects` — Finance is project-derived and adjacency says so. Module
hue **teal**, unused by the current nav set; red is never a module hue. Uses `NavLink`, never a
plain `<Link>` (DOM crash risk).

**Layout** — `ListPageLayout`: `PageHeader` ("Finance", no "Manage your…" boilerplate) → up to
4 individually-bordered `--sh-card` stat tiles, each linking to its section (never an inline
metrics strip with dividers) → filters → sections.

Tiles: `Quotes out` · `Expiring ≤7d` · `Uninvoiced` · `Outstanding`.

**Sections** are one list with sticky group headers, not six tables — six tables is six empty
states and six scroll contexts. Groups with zero rows are **omitted**, not shown empty. Rows:
project number + name, client, the section-relevant date, amount, one deep link into that
project's Finance tab.

**Whole-page zero state** (a quiet week, not an error): `documents` illustration at 56px,
"Nothing needs chasing", "No quotes awaiting a reply and no invoices outstanding." This is the
one place in the finance surface where a Kalam annotation is permitted — it is a *good* state.

**Deliberate omission:** no charts. This is a worklist, not a report. `DateRangeBar` was removed
app-wide in 2026-07 for exactly this reason.

---

## 10. Responsive (DESIGN.md §15)

- **Finance tab:** rows collapse to one line (`v2 · Sent · $18,120`). **Full-row tap opens a
  revision sheet — no inline icon buttons and no `⋯` in mobile card mode** (DESIGN.md §15;
  the reviewed draft contradicted this). Actions live inside the sheet.
- **Sticky finance rail** stacks above the tab content on mobile, not below — lock state and
  value are the first things you need.
- **Send dialog** goes full-screen below 768px; the preview pane is replaced by
  `Download draft PDF` (a 3-page PDF in a 375px column is not a preview). Footer sticks.
- **Revision viewer:** view a revision and download its PDF. **Compare and the change stepper
  are desktop-only.** Comparing a 120-line money document is a desk task; a stepper over a
  six-column table at 375px is worse than "open it on a laptop".
- **Alert rail:** rows wrap to two lines; no collapse (there are only four).
- Touch targets ≥44px. Safe areas via inline `style` with `env()`, not Tailwind arbitraries.

## 11. Accessibility

- Every state is **colour + text**, never colour alone. Expiry says "3 days left"; locks say why.
- `<LockedField>`: `aria-readonly` + `aria-describedby` → the reason.
- Gated actions: `aria-disabled`, focusable, tooltip keyboard-reachable.
- **Alert rail:** `aria-live` **off on first paint** — a polite region that mounts *with*
  content announces all of it on every project load and every client navigation. Enabled only
  for notices that arrive post-mount (the lock landing after a send). A hard-lock row uses
  `role="alert"`, not polite.
- Change stepper: `Previous change` / `Next change`, position announced.
- Dialogs: focus trapped, returned to the invoking control; `Esc` confirms only when dirty.
- Session timer `aria-live="off"`.
- Verified against `docs/a11y-manual-checklist.md`.

## 12. Component inventory

**New:** `ProjectAlertRail` (+ row primitive), `FinanceSidebarRail`, `LockedField`,
`GatedAction`, `QuoteRevisionRow`, `SendQuoteDialog`, `IssueInvoiceDialog`,
`RecallQuoteDialog`, `AcceptQuoteDialog`, `DeclineQuoteDialog`, `ConfirmWithoutAcceptedQuoteDialog`,
`RevisionViewerDialog`, `ChangeStepper`, `RepriceFromRevisionDialog` (§8.1), `lock-copy.ts`,
`quoteStatusIntent()` in `status-colors.ts`.

**Reused unchanged:** `Dialog`, `Tooltip` (+ own provider), `Badge`, `Skeleton`,
`SectionHeader`, `FadeIn`, `combobox-picker`, `PersonAvatar`, `UnpricedBadge`,
`JustificationDialog`, `project-snapshot-diff.ts`, `ProjectCostsPanel`, `ProjectActivityFeed`.

**Migrated into the rail** — and **restyled**, not moved as-is: `ProjectConflictsBanner`,
`StalePricingBanner`, `UnlockSessionBanner`. `StalePricingBanner` currently uses
`bg-amber-500/5` (a full-background tint, banned by DESIGN.md Notices) and hardcoded
`text-amber-600 dark:text-amber-400` instead of `text-warn`. Every migrated row re-renders
through the rail's row primitive with `intentStyles` tokens and a left-edge 3px accent.

**Cut:** the Money block (duplicate of `ProjectSummaryStrip` + `ProjectCostsPanel`); the
viewer's second timeline; the highlight toggle; the any-version compare picker; in-dialog PDF
pagination; the three-button invoice-kind row; the `2 more notices` collapse; mobile compare.

**Retired:** the `Financials` tab shell; `window.confirm` in the finance path.

## 13. Testing (design-specific)

- jsdom smoke tests that **open** every overlay — the standing `TooltipProvider` /
  Base-UI-in-Radix-modal regression class (`model-roi-tab.smoke.test.tsx` is the precedent)
- Alert rail: CTA-first sort, all four conditions, all-clear renders nothing, merged
  drift+stale row renders both actions
- `LockedField`: no layout shift between states; renders locked while status is `undefined`
- `GatedAction`: tooltip keyboard-reachable, control focusable
- Every revision state renders a distinct, labelled treatment (incl. Superseded's no-pill)
- Send dialog: terminal success state exposes `Download PDF`; error preserves all four fields
- Lifecycle reorder: pre- and post-acceptance section order
- Reprice-from-revision (§8.1): the confirm dialog states the unpriced-item count before
  running; the warning about a moved rental window appears only when the window actually
  moved; structure is provably unchanged after the operation; one audit entry, not N

## 14. Resolved scope question

**Reprice-from-revision — decided 2026-07-28: build it in Phase D.** Full spec at §8.1.

It was surfaced by this review as out-of-scope work that the design implied but no issue
covered. Resolved in favour of building because the mechanic already exists and is tested
(`restoreProjectSnapshot` FINANCIAL scope), the expectation is universal across every version
-history pattern studied, and without it the revision viewer is a read-only cul-de-sac that
shows you a problem and offers no way to act on it.

Scope added to Phase D (#989): one mutation, one confirm dialog, the viewer footer action,
tests. Renamed from "Start v(N+1) from this version" to **"Use vN's pricing for v(N+1)"** so
the label can't be read as restoring structure.
