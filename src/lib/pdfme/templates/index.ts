/**
 * Template registry — maps document types to their template + input builders.
 */
import type { Template } from "@pdfme/common";
import type { DocumentData, DocumentType, TestTagReportType } from "../types";
import type { TemplateSettings } from "../template-settings";

import { buildQuoteTemplate, buildQuoteInputs } from "./quote";
import { buildInvoiceTemplate, buildInvoiceInputs } from "./invoice";
import { buildPackingListTemplate, buildPackingListInputs } from "./packing-list";
import { buildReturnSheetTemplate, buildReturnSheetInputs } from "./return-sheet";
import { buildDeliveryDocketTemplate, buildDeliveryDocketInputs } from "./delivery-docket";
import { buildCallSheetTemplate, buildCallSheetInputs } from "./call-sheet";

// T&T report templates
import { buildTtRegisterTemplate, buildTtRegisterInputs } from "./tt-register";
import { buildTtOverdueTemplate, buildTtOverdueInputs } from "./tt-overdue";
import { buildTtSessionTemplate, buildTtSessionInputs } from "./tt-session";
import { buildTtItemHistoryTemplate, buildTtItemHistoryInputs } from "./tt-item-history";
import { buildTtDueScheduleTemplate, buildTtDueScheduleInputs } from "./tt-due-schedule";
import { buildTtClassSummaryTemplate, buildTtClassSummaryInputs } from "./tt-class-summary";
import { buildTtTesterActivityTemplate, buildTtTesterActivityInputs } from "./tt-tester-activity";
import { buildTtFailedItemsTemplate, buildTtFailedItemsInputs } from "./tt-failed-items";
import { buildTtBulkSummaryTemplate, buildTtBulkSummaryInputs } from "./tt-bulk-summary";
import { buildTtComplianceCertTemplate, buildTtComplianceCertInputs } from "./tt-compliance-cert";

// ─── Project Document Builders ─────────────────────────────────────────────

export interface TemplateBuilder {
  buildTemplate: (settings?: TemplateSettings) => Template;
  buildInputs: (data: DocumentData, callSheetDate?: Date, settings?: TemplateSettings) => Record<string, string>;
}

const templateBuilders: Record<DocumentType, TemplateBuilder> = {
  quote: { buildTemplate: buildQuoteTemplate, buildInputs: buildQuoteInputs },
  invoice: { buildTemplate: buildInvoiceTemplate, buildInputs: buildInvoiceInputs },
  "packing-list": { buildTemplate: buildPackingListTemplate, buildInputs: buildPackingListInputs },
  "return-sheet": { buildTemplate: buildReturnSheetTemplate, buildInputs: buildReturnSheetInputs },
  "delivery-docket": { buildTemplate: buildDeliveryDocketTemplate, buildInputs: buildDeliveryDocketInputs },
  "call-sheet": { buildTemplate: buildCallSheetTemplate, buildInputs: buildCallSheetInputs },
};

export function getTemplateBuilder(docType: DocumentType): TemplateBuilder {
  const builder = templateBuilders[docType];
  if (!builder) {
    throw new Error(`Unknown document type: ${docType}`);
  }
  return builder;
}

// ─── T&T Report Builders ───────────────────────────────────────────────────

interface TtReportBuilder {
  buildTemplate: () => Template;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildInputs: (data: any, orgData: any) => Record<string, string>;
}

const ttReportBuilders: Record<TestTagReportType, TtReportBuilder> = {
  "tt-register": { buildTemplate: buildTtRegisterTemplate, buildInputs: buildTtRegisterInputs },
  "tt-overdue": { buildTemplate: buildTtOverdueTemplate, buildInputs: buildTtOverdueInputs },
  "tt-session": { buildTemplate: buildTtSessionTemplate, buildInputs: buildTtSessionInputs },
  "tt-item-history": { buildTemplate: buildTtItemHistoryTemplate, buildInputs: buildTtItemHistoryInputs },
  "tt-due-schedule": { buildTemplate: buildTtDueScheduleTemplate, buildInputs: buildTtDueScheduleInputs },
  "tt-class-summary": { buildTemplate: buildTtClassSummaryTemplate, buildInputs: buildTtClassSummaryInputs },
  "tt-tester-activity": { buildTemplate: buildTtTesterActivityTemplate, buildInputs: buildTtTesterActivityInputs },
  "tt-failed-items": { buildTemplate: buildTtFailedItemsTemplate, buildInputs: buildTtFailedItemsInputs },
  "tt-bulk-summary": { buildTemplate: buildTtBulkSummaryTemplate, buildInputs: buildTtBulkSummaryInputs },
  "tt-compliance-cert": { buildTemplate: buildTtComplianceCertTemplate, buildInputs: buildTtComplianceCertInputs },
};

export function getTtReportBuilder(reportType: TestTagReportType): TtReportBuilder {
  const builder = ttReportBuilders[reportType];
  if (!builder) {
    throw new Error(`Unknown T&T report type: ${reportType}`);
  }
  return builder;
}

export {
  buildQuoteTemplate, buildQuoteInputs,
  buildInvoiceTemplate, buildInvoiceInputs,
  buildPackingListTemplate, buildPackingListInputs,
  buildReturnSheetTemplate, buildReturnSheetInputs,
  buildDeliveryDocketTemplate, buildDeliveryDocketInputs,
  buildCallSheetTemplate, buildCallSheetInputs,
};
