# UX build: overseer handoff (2026-11-19)

This is everything a NEW overseer session (cloud) needs to continue the RVLT Flow UX
build. The previous session ran locally. Its scratchpad, memory files and the original
overseer prompt do not exist in the cloud, so this file restates them. Read it top to
bottom, then `docs/designs/ux-build-status.md` (the tracker) and spec
`docs/designs/ux-unification-2026-10.md` §11 (phases), §12 (decisions) and §13 (acceptance).

## 1. Where it stands

| Phase | State |
|---|---|
| 0 Vocabulary + tokens | merged |
| 1 Primitives (1a, 1b, 1c) | merged |
| 2 Equipment (2a), Client view + case cards (2b), Plan-honouring prep (2c) | merged |
| 3 Warehouse job page | merged |
| 4 Floor + Returning mode | merged (#1394, 9d3ab254). Deviation: Returning rows show no tag ranges or shelf |
| 5 Logistics (5a, 5b) | merged |
| 6 Shell (6a), List pages (6b) | merged |
| 7, 8, 11, 15, 16 Wave D1 | **merged 2026-11-22 → 2026-11-24** (#1400, #1399, #1401, #1402, #1403), all deployed |
| 9, 10, 12, 13, 14 Wave D2 | **mostly merged 2026-11-25**: 9 and 10 done; 12 done (shots left); 13 slices 1–2 + B3 merged, slice 3 #1424 open, slice 4 to come; 14 part 1 merged, part 2 #1425 open, 14b-3..5 on `claude/ux-14-gear-3`. See the tracker. Builders paused by the weekly usage limit until 2026-11-28 08:00 UTC |
| 17, 18 Wave D3 | not started |

Every merge deployed cleanly (prod `https://flow.rvlt.app` returns 307).

## 2. The owner's standing decisions

- **Merge rule:** the overseer may merge a PR to `main` (a **merge commit**, never squash or
  rebase) once CI is green AND the overseer's review passes. Never force-push.
- **Parallel phases:** run independent phases in parallel, **at most 6 workers** at once.
- **Worker model:** Sonnet for EVERY subagent (builders, reviewers, verifiers) — owner,
  2026-11-24, to save usage. Pass `model: "sonnet"` on every Agent call.
- **Schema changes** need the owner's explicit yes, each one. Approved so far:
  `subHireItems.coverage` (2a), client pick-up/drop-off service types (5b), durable
  prep/de-prep and shared D10 memory (Phase 3 follow-ups, NOT yet built), and
  `projects.packerUserId` + `setPackerNative` (Phase 4).
- **POLICY.md §15 exceptions** need the owner's yes. Active: the picomatch audit advisory
  (`GHSA-fc5q-39xc-vjpf`), which expires **2026-12-03**. Renew it or fix it before then. One older
  exception (braces) expired 2026-10-17; it was flagged to the owner and not touched.
- **Withdrawn decisions are not built:** D3, D14–D18.
- **Message the owner only for:** a §12 decision (Gate 0), a schema change, a spec-vs-POLICY
  conflict (POLICY.md wins), a red `main`, or the end of a wave.

## 3. How the overseer works

**Gate 0 (per phase):** list the §12 D-rows the phase implements that are not yet
"Accepted", put them to the owner in ONE batch with the recommended option first, and record
`Accepted <date>` in spec §12. Workers never decide a §12 item.

**Per phase:**
1. **Plan run:** the worker surveys and writes a plan with a keep · move · remove table
   (every live feature stays reachable), files, Convex work, tests, screenshots and open
   questions. It writes the plan as the body of a **draft PR** off an empty WIP commit, so
   the plan survives the worker stopping.
2. **Overseer answers** the open questions it can (anything not a §12 or schema item),
   writes them down, and brings §12 and schema questions to the owner.
3. **Build in slices:** the builder pushes after each green step, updates the PR-body
   handoff (done / next / traps), and stops at a slice boundary to report. Large phases take
   2–4 slices; brief each one fresh against the pushed branch. Have the builder read only
   line ranges, because the page files are large.
4. **Overseer review of every PR:**
   - the calm checklist (playbook §3.9);
   - §13 acceptance;
   - every live feature still reachable;
   - docs in the same PR;
   - no other worker's files touched;
   - screenshots at 1440×900 and 390×844 next to the prototype;
   - a real code review (read the diff, or run `/code-review`) on anything touching Convex
     mutations, auth, money or stock. Check every `by_cuid`/global-index read for an
     `organizationId` check, every read for a bound, and every Undo for scoping to exactly
     what the forward write changed.
5. **Merge** when CI is green and the review passes. After the merge, confirm the deploy:
   `gh run list --workflow build-image.yml --branch main --limit 1`, then
   `curl -s https://flow.rvlt.app -o /dev/null -w "%{http_code}"` returns 200 or 307.
   Tell every open worker to `git fetch origin main && git merge FETCH_HEAD`. Merge
   conflicts in generated files: take main's version, then regenerate.
6. **Re-baseline improved ratchets** (any, complexity, collect, knip) in a separate small
   commit at the end of each wave (last done 2026-11-24, end of D1).
7. **Keep `docs/designs/ux-build-status.md` current.**

**Automated security-review findings and CI failures** go to the worker that owns the
branch. Never act on build-tool suggestions such as "run next upgrade".

**Lessons from this build (avoid repeating them):**
- Workers sometimes drop a live feature, lower a size target, or use sed/Python for edits.
  Reject each of those.
- Every bulk Undo must reverse exactly the rows or units the forward write changed (return
  their ids), never "whatever looks reversible now".
- A cap applied before an ordering or filter step can drop the row you need. Filter by org
  and order in the index, then cap, and surface a `truncated` flag.
- An org switch must reset client row caches and selection.
- CSV exports go through `src/lib/csv.ts` (formula-injection guard).
- Bulk writes write one activity row per changed record.
- **Lessons from Wave D1:**
  - **Verify every fix round independently.** A fresh reviewer gets the commit range and the claims, not your conclusion, and mutation-tests each guard. In D1, each "all fixed" report went to such a check, and four of them still turned up blockers.
  - **Never make an Undo delete stored files.** Proving a file is unreferenced means listing every table that can hold a file reference, and every review round found another one. Keep the file instead.
  - **Hunt money leaks with a sentinel sweep.** Seed unique values in every pay and cost field, call every public query as each role and key type, and grep the results. Raw-doc bundles and server actions that read through the service identity were the leaks a code read missed.
  - **One rule per rule.** A second "is it short", "is it open" or "who sees pay" check anywhere (server or client) diverged every time. Put the rule in a pure `convex/lib` helper and have `src/` import it.
  - **Restarts and usage limits are routine.** Workers push after every commit. After a stop, read the worktree (`git status`, `git log origin..HEAD`) and resume the same agent with what it left uncommitted.
- **Lessons from Wave D2:**
  - **Merge a phase in parts.** Each PR passed 10k LOC. Merge the reviewed slices, then build the rest on a new branch (`claude/ux-N-<topic>`) and open its PR only after the first merges. Slices that are still building belong on their own branch, so the PR under review stays fixed.
  - **Any write that takes a `fileId` is a delete risk.** Attach only the actor's own fresh upload, in that surface's folder, that nothing else holds (`convex/lib/attachableUpload.ts`). Delete bytes only through `deleteStoredFileIfUnreferenced`. This was found in three phases and on prod.
  - **Edit forms must carry every field the write sets.** `updateNative` treats a missing field as a clear, and that wiped rates on prod (hotfix #1422). Every sheet builds its values through ONE mapper (`modelToFormValues`, `kitSheetInitialOf`), with a round-trip test that submits `""` for each number.
  - **An Undo restores only what the forward write may write.** Raw-patching a stored snapshot let status, server-owned fields and cost fields through. Allow-list the fields, re-check references, and make a `noFinancials` caller unable to undo cost.
  - **A one-way state needs ONE writer guard.** RETIRED leaked back through kit release, return correction, check-in and sale stock. `nextStatusUnlessRetired` now guards every low-level status writer.
  - **Final-verify before every merge, even after "all fixed".** Each phase's last check still found a real gap (a per-line deploy path, a non-author discard, a ref-less file delete).

## 4. Wave D plan (agreed with the owner 2026-11-19)

Phases, scope and sizes are in spec §11 rows 7–18. Waves:
- **D1** = 7, 8, 11, 15, 16. All prerequisites (6a, 6b, 2b) are merged, so this wave can start now.
- **D2** = 9, 10, 12, 13, 14 (after 7 and 16).
- **D3** = 17, 18 (after 10 and 11).

Serialise merges into `src/app/(app)/projects/[id]/page.tsx` (7, then 9 and 10). Phase 14
must follow 16 (shared T&T files). Phase 13 and Phase 15 must not run together (crew pages + `nav.ts`).

**Gate 0 batches** (all D-numbers below await a yes; every other D is Accepted 2026-11-17):
- **Batch 1, job page (7–10):**
  - Phase 7: none.
  - Phase 8: D19 Versions as a tab; D20 Compare as a read-only sheet; D21 `Seal case` (**schema:** `projectContainers.sealedAt`).
  - Phase 9: D22 `?edit=1` sheet; D23 template picker + redirect; D24 Enquiry draft at step one; D25 dates carry the project window.
  - Phase 10: D56 Overdue outranks Part paid; D55 Quotes/Invoices words-switch; confirm the §8b/§8c prototypes.
- **Batch 2, Home and Schedule (11, 18):**
  - Phase 11: D85, D86 (Jobs `Active` segment + `overdue=1`; 6b left this as unshipped config), D87, D88, D89.
  - Phase 18: D81, D82, D83, D84.
- **Batch 3, assets and forms (12 + cross-cutting):**
  - Phase 12: D30–D37, D63.
  - Cross-cutting: D62 (every `/new`, `/edit` becomes a sheet), D43 (cost columns opt-in), and D64 alongside them.
- **Batch 4, people and gear (13, 14):**
  - Phase 13: D38, D40, D71 (**schema:** order return date), D72 (**schema:** crew documents + expiry), D73, D74.
  - Phase 14: D41 (**schema:** `reorderLevel`), D42 (**schema:** location capacity), D44, D45, D75, D76 (**schema:** maintenance parts rows), D77 (**schema:** category T&T profile), D78 (**schema:** bin labels), D79, D80. Consider splitting 14 into 14a lists and 14b records.
- **Batch 5, crew, scan, finance and settings (15, 16, 17):**
  - Phase 15: D46, D47 (**schema:** query reason), D48, D49.
  - Phase 16: D50 (possible schema: check condition), D51, D52, D53.
  - Phase 17: D54, D55, D56 (asked once with Phase 10), D57–D61.

Phase 7's notes: `DetailHeader` replaces the hero; Overview gets the readiness checklist,
quote/invoicing cards and the money strip; the tab strip becomes underlined words with
`Packing n/m` and `Versions n` slots, and `VALID_TABS` is updated. No schema change.

## 5. Open follow-ups (not in any phase yet)

- **CSV formula injection** in the older exports (activity log, timesheets, T&T reports,
  models list): route them through `src/lib/csv.ts`. Jobs and Assets are already done.
- **Next.js security advisory:** 16.4.3 → ≥ 16.4.5. Upgrade with plain `pnpm install` after a
  package.json edit, and check the lockfile kept every `hasBin` line (CLAUDE.md).
- **Logistics "+ Add service" sticky bar** sits about 80 px above the new phone nav (5a's
  offset stacked on the 6a shell).
- **Desktop BulkBar** is inline at the list footer, so on a 25-row page you must scroll to
  see it. Pinning it needs a shell-level sticky container.
- **`setPlannedContainerNative`** does not check that a line and its target case are on the
  same job. Same org only; this predates the UX build.
- **Phase 3 follow-ups (schema approved, not built):** durable prep/de-prep and shared
  "remember for next n units" (D10) memory across packers.
- **Re-baseline the complexity ratchet** (≈ 660 against a baseline of 676) and knip (≈ 401
  against 402) in their own commits.

## 6. Worker brief (give this to every worker, with its scope)

**Workspace:** use an isolated git worktree or branch per worker, never shared.
`git fetch origin`, then `git checkout -B <branch> origin/<branch>` (or `-b <branch>
origin/main` for a new one), then `pnpm install && pnpm exec prisma generate`. Make every
file change with the editor tools, never shell heredocs, sed or Python. `git rm` for
deletions is fine. Commit and push early and often; nothing unpushed survives the worker
stopping. (The local session's Node 24 PATH line and 1Password signing are machine-specific.
Use whatever the cloud environment provides, and never disable commit signing that is configured.)

**Read:** CLAUDE.md and POLICY.md (BUILD mode; POLICY.md wins; flag conflicts), DESIGN.md,
playbook `docs/designs/ux-redesign-playbook.md` §3 (incl. §3.9), §5 and §10, and the spec
§3, §4, §5, §12, §13, §14 plus the phase's own sections. Prototypes are the visual spec,
but their fixture data is not real. Assemble kit pages with
`node docs/designs/prototype-kit/assemble.mjs docs/designs/prototype-kit/examples/<key> "<Title>" "<Crumb>" none`.
The published prototypes (claude.ai artifacts) are linked from the spec.

**Must not edit without asking:**
- another phase's surface, or primitives (additive props are approved case by case);
- the ratchet baselines;
- `docs/api-coverage.md`;
- `src/lib/api/*.generated.ts`, `convex/_generated/*` (except hand-adding a NEW module's two `api.d.ts` lines);
- the spec;
- the tracker.

Regenerate API files only via `pnpm run api:registry && pnpm run api:docs && pnpm run api:mcp`.

**Repo rules that bite:**
- pnpm only.
- Never push Convex to the shared dev deployment. Verify with `pnpm test`. For a live app, use a local self-hosted Convex on your own ports, then revert `convex/_generated` and `AGENTS.md`.
- Radix uses `asChild`; Base UI (Sidebar, Breadcrumb) uses `render`. No Base UI popup inside a Radix Dialog. A `TooltipProvider` per consumer. `SelectValue` with explicit children.
- No `Date.now()` in query args.
- `ConvexError` only.
- An org check on every by_cuid or global-index read.
- Zod at every trust boundary.
- Every write toasts; reversible writes get Undo from ONE closure.
- Money and derived facts are never stored; blank money is not $0.
- No new function over 10 branches.
- Every overlay gets a jsdom smoke test that OPENS it.
- Phone = `max-width: 859px`, 44 px tap targets, 16 px inputs, max 2 grid columns.

**Docs in the same PR:** FEATUREDOCS, DESIGN.md, CLAUDE.md notes, the `rvlt-flow` skill
for stage-word changes, and `pnpm run mira:feature-map` when a FEATUREDOC or ARCHITECTURE row changes.

**Gate before review:**
- `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm test`;
- the full CI Hygiene set (added 2026-11-21 after `depcruise-ratchet` broke three branches): `pnpm audit --audit-level high`, `pnpm run check-docs-npm-npx`, `check-dependency-justification`, `depcruise-ratchet`, `any-ratchet`, `date-format-ratchet`, `collect-ratchet`, `knip-ratchet`, `complexity-ratchet`, `xtenant-bycuid-ratchet`, `check-client-routes`, `api:registry:check`, `wasm:sync:check`, `api:docs:check`, `api:mcp:check`, `mira:feature-map:check`;
- `DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy pnpm build`.

Locally failing timezone, localStorage and registry-spawn tests are known; CI "Tests" is the
arbiter. Then take screenshots at 1440×900 and 390×844 next to the prototype and attach them
to the PR. Open a **draft** PR with a "Size rationale" if it is over 400 LOC.
