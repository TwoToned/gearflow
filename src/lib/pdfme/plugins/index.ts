/**
 * Plugin registry — exports all custom gearflow pdfme plugins.
 * Used by generatePdf() when calling pdfme's generate().
 *
 * #1157 (cleanup) — `gearflowTable`, `gearflowFinancialSummary`,
 * `gearflowRichText` and `gearflowDraftWatermark` were removed here (#1156
 * cut the 5 project doc types they served over to react-pdf; nothing else
 * ever registered a schema of those types). `gearflowPageHeader`,
 * `gearflowPageFooter` and `gearflowSignatureLine` stay — call sheets, T&T
 * reports and the timeline builder still render through this registry and
 * still use them (see `templates/*.ts`).
 */
import { text } from "@pdfme/schemas";
import gearflowPageHeader from "./gearflow-page-header";
import gearflowPageFooter from "./gearflow-page-footer";
import gearflowCheckbox from "./gearflow-checkbox";
import gearflowSignatureLine from "./gearflow-signature-line";
import gearflowCrewTable from "./gearflow-crew-table";
import gearflowCallSheetInfo from "./gearflow-call-sheet-info";
import gearflowDayHeader from "./gearflow-day-header";
import { gearflowDataTable } from "./gearflow-data-table";
import { gearflowSummaryBox } from "./gearflow-summary-box";
import { gearflowTextBlock } from "./gearflow-text-block";

export const gearflowPlugins = {
  // Built-in pdfme plugins
  text,
  // Custom plugins — project documents
  gearflowPageHeader,
  gearflowPageFooter,
  gearflowCheckbox,
  gearflowSignatureLine,
  gearflowCrewTable,
  gearflowCallSheetInfo,
  gearflowDayHeader,
  // Custom plugins — reports
  gearflowDataTable,
  gearflowSummaryBox,
  gearflowTextBlock,

  // ── Rebrand aliases (RVLT Flow) ──────────────────────────────────────────
  // pdfme matches a schema's `type` against the KEY in this record. Registering
  // each plugin under its `rvltFlow*` name too lets new/saved templates use the
  // rebranded type while every existing template (persisted with `gearflow*`
  // types) keeps rendering. Additive only — do NOT remove the legacy keys until
  // stored templates have been migrated.
  rvltFlowPageHeader: gearflowPageHeader,
  rvltFlowPageFooter: gearflowPageFooter,
  rvltFlowCheckbox: gearflowCheckbox,
  rvltFlowSignatureLine: gearflowSignatureLine,
  rvltFlowCrewTable: gearflowCrewTable,
  rvltFlowCallSheetInfo: gearflowCallSheetInfo,
  rvltFlowDayHeader: gearflowDayHeader,
  rvltFlowDataTable: gearflowDataTable,
  rvltFlowSummaryBox: gearflowSummaryBox,
  rvltFlowTextBlock: gearflowTextBlock,
};

/** Preferred (rebranded) name for the plugin registry. Same object, both key sets. */
export const rvltFlowPlugins = gearflowPlugins;

export {
  gearflowPageHeader,
  gearflowPageFooter,
  gearflowCheckbox,
  gearflowSignatureLine,
  gearflowCrewTable,
  gearflowCallSheetInfo,
  gearflowDayHeader,
  gearflowDataTable,
  gearflowSummaryBox,
  gearflowTextBlock,
};
