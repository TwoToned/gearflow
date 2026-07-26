/**
 * T&T report template registry — maps report types to their template + input
 * builders. Project documents (quote, invoice, packing-list, return-sheet,
 * delivery-docket) go through `document-composer.ts` instead; call sheets use
 * `call-sheet-services.ts` directly.
 */
import type { Template } from "@pdfme/common";
import type { TestTagReportType } from "../types";

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
