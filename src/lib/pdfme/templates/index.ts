/**
 * Template registry — maps document types to their template + input builders.
 */
import type { Template } from "@pdfme/common";
import type { DocumentData, DocumentType } from "../types";

import { buildQuoteTemplate, buildQuoteInputs } from "./quote";
import { buildInvoiceTemplate, buildInvoiceInputs } from "./invoice";
import { buildPackingListTemplate, buildPackingListInputs } from "./packing-list";
import { buildReturnSheetTemplate, buildReturnSheetInputs } from "./return-sheet";
import { buildDeliveryDocketTemplate, buildDeliveryDocketInputs } from "./delivery-docket";
import { buildCallSheetTemplate, buildCallSheetInputs } from "./call-sheet";

interface TemplateBuilder {
  buildTemplate: () => Template;
  buildInputs: (data: DocumentData, callSheetDate?: Date) => Record<string, string>;
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

export {
  buildQuoteTemplate, buildQuoteInputs,
  buildInvoiceTemplate, buildInvoiceInputs,
  buildPackingListTemplate, buildPackingListInputs,
  buildReturnSheetTemplate, buildReturnSheetInputs,
  buildDeliveryDocketTemplate, buildDeliveryDocketInputs,
  buildCallSheetTemplate, buildCallSheetInputs,
};
