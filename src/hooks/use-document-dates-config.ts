"use client";

import { useServerQuery } from "@/hooks/use-server-query";
import { getDocumentDatesConfig } from "@/server/settings";
import { DEFAULT_QUOTE_VALIDITY_DAYS } from "@/lib/quote-validity";
import { DEFAULT_PAYMENT_TERMS_DAYS } from "@/lib/invoice-terms";

/**
 * The org's quote-validity / payment-terms defaults, for the send/issue
 * dialogs' date previews (#989). Never invalidated — an org rarely changes
 * these, and the mutations re-resolve the same config server-side rather than
 * trusting this round trip (R-9.3), so a stale value here is at worst a
 * momentarily-wrong PREVIEW, never a wrong write.
 */
export function useDocumentDatesConfig() {
  const { data, isLoading } = useServerQuery({
    queryKey: ["document-dates-config"],
    queryFn: getDocumentDatesConfig,
  });
  return {
    isLoading,
    quoteValidityDays: data?.quoteValidityDays ?? DEFAULT_QUOTE_VALIDITY_DAYS,
    paymentTermsDays: data?.paymentTermsDays ?? DEFAULT_PAYMENT_TERMS_DAYS,
    timezone: data?.timezone,
  };
}
