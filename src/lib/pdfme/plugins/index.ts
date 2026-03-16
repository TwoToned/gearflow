/**
 * Plugin registry — exports all custom gearflow pdfme plugins.
 * Used by generatePdf() when calling pdfme's generate().
 */
import { text } from "@pdfme/schemas";
import gearflowTable from "./gearflow-table";
import gearflowFinancialSummary from "./gearflow-financial-summary";
import gearflowPageHeader from "./gearflow-page-header";
import gearflowPageFooter from "./gearflow-page-footer";
import gearflowCheckbox from "./gearflow-checkbox";
import gearflowSignatureLine from "./gearflow-signature-line";
import gearflowCrewTable from "./gearflow-crew-table";
import { gearflowDataTable } from "./gearflow-data-table";
import { gearflowSummaryBox } from "./gearflow-summary-box";
import { gearflowTextBlock } from "./gearflow-text-block";

export const gearflowPlugins = {
  // Built-in pdfme plugins
  text,
  // Custom plugins — project documents
  gearflowTable,
  gearflowFinancialSummary,
  gearflowPageHeader,
  gearflowPageFooter,
  gearflowCheckbox,
  gearflowSignatureLine,
  gearflowCrewTable,
  // Custom plugins — reports
  gearflowDataTable,
  gearflowSummaryBox,
  gearflowTextBlock,
};

export {
  gearflowTable,
  gearflowFinancialSummary,
  gearflowPageHeader,
  gearflowPageFooter,
  gearflowCheckbox,
  gearflowSignatureLine,
  gearflowCrewTable,
  gearflowDataTable,
  gearflowSummaryBox,
  gearflowTextBlock,
};
