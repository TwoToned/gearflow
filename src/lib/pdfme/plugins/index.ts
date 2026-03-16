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

export const gearflowPlugins = {
  // Built-in pdfme plugins
  text,
  // Custom plugins
  gearflowTable,
  gearflowFinancialSummary,
  gearflowPageHeader,
  gearflowPageFooter,
  gearflowCheckbox,
  gearflowSignatureLine,
  gearflowCrewTable,
};

export {
  gearflowTable,
  gearflowFinancialSummary,
  gearflowPageHeader,
  gearflowPageFooter,
  gearflowCheckbox,
  gearflowSignatureLine,
  gearflowCrewTable,
};
