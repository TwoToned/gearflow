# Project versioning v2 — mockup sources

Static HTML artboards behind the design canvas linked from
[`docs/designs/project-versioning-v2.md`](../../project-versioning-v2.md)
(https://claude.ai/artifact/EgwLTWJLKyyTeymqhjtNes). Each file opens directly in a
browser; the `support.js` reference is the canvas editor's hook and 404s harmlessly.

| File | Artboard |
|---|---|
| `Main.dc.html` | Project header with the version menu open |
| `VersionStrip.dc.html` | The one status strip — five states |
| `EquipmentOnVersion.dc.html` | Equipment tab while on a non-live, editable version |
| `FinanceTab.dc.html` | Finance tab as a documents-per-version list |
| `VersionsPanel.dc.html` | Versions panel (right sheet) |
| `MakeLive.dc.html` | Make-live dialog |
| `Compare.dc.html` | Compare as a mode on the real page (changed rows highlighted in place) |

Tokens, type and component anatomy are lifted from `DESIGN.md`, `src/app/globals.css`,
`src/components/ui/{badge,tabs}.tsx` and `src/components/projects/project-lock-strip.tsx`.
