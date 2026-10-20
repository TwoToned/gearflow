# Canonical design remediation

Baseline: `4fbfbc5c436bc53355df7891a10575e91dfdbd91`. Authority: RVLT-Labs/rvlt-designlanguage v1.3.0, `f1a1825a0e07d9df56b3133151299dcd25216f9c`; `docs/AUTHORITY.md`, `authority.json`, normative rules/product contracts, tokens/contrast and registry—not marketing.

## Disposition

| Audit IDs | Product changes |
|---|---|
| F01–F04 | Theme-mapped action-red, red-text, control-line and info; readable muted text; preserve marks, focus and categorical module hues. |
| F05–F06 | Inactive child handlers blocked before Slot composition, safe native/Next links, loading labels remain accessible. |
| F08–F10, R01 | Reading typography and planner floor; real 44px coarse hit regions, pointer-aware compact sizes, unrestricted viewport zoom. |
| F11–F14 | Named lifecycle stages; canonical status API with explicit backward-compatible domain adapter; responsive scheduler and independent overlap lanes. |
| F15 | Durable, identity/org/project/version-bound deploy/return intake before lookup; explicit pending/review/failed/confirmed states, safe review/retry, atomic permission-checked receipts and idempotent fulfillment. |
| F16 | Non-sensitive public offline shell; network/auth-checked documents, no session/API/protected-document runtime caches; legacy runtime cache cleanup. |
| F17 | Unchanged supplied gaff SVG, narrowly reachable public static assets. |
| F18, F20–F24 | Keyboard sorting, Input/Search parity, Paper border/title roles, named focusable code scrollers, mounted/in-flight SSO fallback. |
| F19 | Preserve explicit Flow hue-active contract; unresolved upstream contrast wording conflict is not an established product defect. No canonical repository edit. |

F07 was rejected by the audit's actual font/CDP evidence. Fonts are not replaced or “fixed.” The disposition includes all 24 accepted/recommendation IDs; F07 is separate.

## Durable scan boundary

Intake is saved synchronously before barcode lookup, and is filtered by account, organisation and project. Captured live version, raw barcode, condition, notes and operation ID survive reload. A storage failure retains unsaved text and warns honestly. The same operation survives kit/accessory review, cancellation and retry; server confirmation is never announced early. Unmount/context change stops work not yet sent. A received acknowledgement still confirms its original record, without stale-screen feedback. Replay rejects changed project versions and ambiguous duplicate live kit parents rather than targeting a different row.

`scanIntake.commit` checks browser identity, permission and project before acknowledging an existing receipt. A matching receipt can acknowledge an already committed old-version operation; otherwise current live-version checks precede native fulfillment. Fulfillment, override audits and receipt commit atomically. Changed payload reuse is rejected. New scan endpoints are explicitly denied to machine/agent tokens, with generated API metadata kept current.

The public offline shell never opens another user's queue or cached tenant data. A fresh offline launch cannot authenticate, display protected project data or start a new protected scan session. Saved scans recover after reconnecting to the same verified context. This is a deliberately restricted offline boundary, not an offline authentication bypass.

## Verification and limits

Tests cover actual shared components, mounted warehouse/login interactions, real browser localStorage, native unit/kit fulfillment and local Convex transactions. The isolated browser replay fixture exercises offline capture/reload, reconnect, lost acknowledgement/duplicate replay and retained version/permission/conflict failures. It is a labelled synthetic local backend, not an authenticated production workflow.

Public routes and actual-component fixtures are checked at phone, tablet and desktop widths in both themes. Browser evidence, independent review reports, per-slice RED/GREEN logs and the complete 24-item matrix are provided in the remediation handoff rather than committed as generated screenshots/logs.

Full exact-head CI typecheck/build/lint/test gates remain mandatory. Earlier local monolithic typechecks were kernel OOM-killed, not TypeScript diagnostic results. Some initial warehouse wiring tests were added after implementation; that chronology is disclosed and is not described as strict pre-edit TDD. Physical iOS pinch zoom, human assistive technology, scanner hardware, sunlight/gloves and fully authenticated backend task acceptance remain distinct manual checks.

## Parent-only rollout

No merge or deployment is authorised to this worker. The current Convex Cloud destination is **RVLTLabs → RVLTFlow**, team **`rvlt`**, project **`rvltflow`**. **Two Toned Productions → `gearflow-PROD` is old and must never be targeted.**

Before merging, the parent must verify the existing workflow deployment credentials and public client URL point to the current intended production deployment in that project. The existing `build-image.yml` deploys Convex functions/schema first, checks API registry parity, then builds/pushes the GHCR image and triggers Coolify. Preserve that ordering: the new receipt schema/idempotent mutations must be live and read back before the frontend can send the new scan payload. Do not deploy the frontend alone or run a legacy project command. Confirm backend and frontend exact merge SHA/run, new service-worker imports, authentication redirects, public image decoding, cache upgrade/offline fallback and frontend health through the existing deployment mechanism.
