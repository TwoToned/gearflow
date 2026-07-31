"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";

import { useServerMutation } from "@/hooks/use-server-mutation";
import { refreshOrganization } from "@/hooks/use-organization";
import { useActiveOrganization } from "@/lib/auth-client";
import { updateOrganization } from "@/server/settings";
import type { OrgSettings, OrgDocumentSettings } from "@/lib/org-settings-types";
import { DEFAULT_QUOTE_VALIDITY_DAYS, QUOTE_VALIDITY_BOUNDS } from "@/lib/quote-validity";
import { DEFAULT_PAYMENT_TERMS_DAYS, PAYMENT_TERMS_BOUNDS } from "@/lib/invoice-terms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface DocumentSettingsProps {
  orgName: string;
  settings: OrgSettings;
  onDocumentsChange?: (documents: OrgDocumentSettings | undefined) => void;
}


export function DocumentSettings({ orgName, settings, onDocumentsChange }: DocumentSettingsProps) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const documents = settings.documents || {};

  const [footerText, setFooterText] = useState(documents.footerText || "");
  const [footerSecondLine, setFooterSecondLine] = useState(documents.footerSecondLine || "");
  const [termsAndConditions, setTermsAndConditions] = useState(documents.termsAndConditions || "");
  const [showTermsOnInvoice, setShowTermsOnInvoice] = useState(!!documents.showTermsAndConditionsOnInvoice);
  const [paymentDetails, setPaymentDetails] = useState(documents.paymentDetails || "");
  const [quoteValidityDays, setQuoteValidityDays] = useState(documents.quoteValidityDays ?? DEFAULT_QUOTE_VALIDITY_DAYS);
  const [paymentTermsDays, setPaymentTermsDays] = useState(documents.paymentTermsDays ?? DEFAULT_PAYMENT_TERMS_DAYS);

  // Sync from server when settings change
  useEffect(() => {
    const d = settings.documents || {};
    setFooterText(d.footerText || ""); // eslint-disable-line react-hooks/set-state-in-effect
    setFooterSecondLine(d.footerSecondLine || ""); // eslint-disable-line react-hooks/set-state-in-effect
    setTermsAndConditions(d.termsAndConditions || ""); // eslint-disable-line react-hooks/set-state-in-effect
    setShowTermsOnInvoice(!!d.showTermsAndConditionsOnInvoice); // eslint-disable-line react-hooks/set-state-in-effect
    setPaymentDetails(d.paymentDetails || ""); // eslint-disable-line react-hooks/set-state-in-effect
    setQuoteValidityDays(d.quoteValidityDays ?? DEFAULT_QUOTE_VALIDITY_DAYS); // eslint-disable-line react-hooks/set-state-in-effect
    setPaymentTermsDays(d.paymentTermsDays ?? DEFAULT_PAYMENT_TERMS_DAYS); // eslint-disable-line react-hooks/set-state-in-effect
  }, [settings.documents]);

  function buildDocuments(): OrgDocumentSettings | undefined {
    const next: OrgDocumentSettings = {
      footerText: footerText.trim() || undefined,
      footerSecondLine: footerSecondLine.trim() || undefined,
      termsAndConditions: termsAndConditions.trim() || undefined,
      showTermsAndConditionsOnInvoice: showTermsOnInvoice ? true : undefined,
      paymentDetails: paymentDetails.trim() || undefined,
      quoteValidityDays: quoteValidityDays !== DEFAULT_QUOTE_VALIDITY_DAYS ? quoteValidityDays : undefined,
      paymentTermsDays: paymentTermsDays !== DEFAULT_PAYMENT_TERMS_DAYS ? paymentTermsDays : undefined,
    };
    const hasAny =
      !!next.footerText ||
      !!next.footerSecondLine ||
      !!next.termsAndConditions ||
      next.showTermsAndConditionsOnInvoice !== undefined ||
      !!next.paymentDetails ||
      next.quoteValidityDays !== undefined ||
      next.paymentTermsDays !== undefined;
    return hasAny ? next : undefined;
  }

  const mutation = useServerMutation({
    mutationFn: () =>
      updateOrganization({
        name: orgName,
        settings: { ...settings, documents: buildDocuments() },
      }),
    onSuccess: () => {
      onDocumentsChange?.(buildDocuments());
      refreshOrganization(orgId);
      toast.success("Document settings saved");
    },
    onError: (e) => toast.error(e.message),
  });

  const hasChanges =
    footerText !== (documents.footerText || "") ||
    footerSecondLine !== (documents.footerSecondLine || "") ||
    termsAndConditions !== (documents.termsAndConditions || "") ||
    showTermsOnInvoice !== !!documents.showTermsAndConditionsOnInvoice ||
    paymentDetails !== (documents.paymentDetails || "") ||
    quoteValidityDays !== (documents.quoteValidityDays ?? DEFAULT_QUOTE_VALIDITY_DAYS) ||
    paymentTermsDays !== (documents.paymentTermsDays ?? DEFAULT_PAYMENT_TERMS_DAYS);

  const validityOutOfRange =
    !Number.isFinite(quoteValidityDays) ||
    quoteValidityDays < QUOTE_VALIDITY_BOUNDS.min ||
    quoteValidityDays > QUOTE_VALIDITY_BOUNDS.max;

  const paymentTermsOutOfRange =
    !Number.isFinite(paymentTermsDays) ||
    paymentTermsDays < PAYMENT_TERMS_BOUNDS.min ||
    paymentTermsDays > PAYMENT_TERMS_BOUNDS.max;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="footerText">Footer text</Label>
        <Input
          id="footerText"
          value={footerText}
          onChange={(e) => setFooterText(e.target.value)}
          placeholder={`${orgName || "Your org"} | your@email.com | 0400 000 000`}
          maxLength={200}
        />
        <p className="text-xs text-fg-3">
          Shown at the bottom of every page. Leave blank to auto-generate from your org name, email, and phone.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="footerSecondLine">Footer second line</Label>
        <Input
          id="footerSecondLine"
          value={footerSecondLine}
          onChange={(e) => setFooterSecondLine(e.target.value)}
          placeholder="Optional second line"
          maxLength={200}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="termsAndConditions">Terms &amp; conditions</Label>
        <Textarea
          id="termsAndConditions"
          value={termsAndConditions}
          onChange={(e) => setTermsAndConditions(e.target.value)}
          placeholder="Shown as a block on quotes. No tokens — supports **bold**, *italic*, and '- ' bullets."
          maxLength={4000}
          rows={5}
        />
        <p className="text-xs text-fg-3">Always shown on quotes. Supports **bold**, *italic*, and &quot;- &quot; bullet lines.</p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showTermsOnInvoice}
            onChange={(e) => setShowTermsOnInvoice(e.target.checked)}
            className="accent-primary"
          />
          Also show these terms &amp; conditions on invoices
        </label>
      </div>

      <div className="space-y-2">
        <Label htmlFor="paymentDetails">Payment details</Label>
        <Textarea
          id="paymentDetails"
          value={paymentDetails}
          onChange={(e) => setPaymentDetails(e.target.value)}
          placeholder={"Bank: Example Bank\nBSB: 000-000\nAccount number: 00000000\nAccount name: Your Org Pty Ltd"}
          maxLength={2000}
          rows={4}
        />
        <p className="text-xs text-fg-3">
          Shown on invoices only, next to the total. Supports **bold**, *italic*, and &quot;- &quot; bullet lines. Leave blank to omit.
        </p>
      </div>

      <div className="space-y-2 sm:max-w-xs">
        <Label htmlFor="quoteValidityDays">Quote validity (days)</Label>
        <Input
          id="quoteValidityDays"
          type="number"
          min={QUOTE_VALIDITY_BOUNDS.min}
          max={QUOTE_VALIDITY_BOUNDS.max}
          value={quoteValidityDays}
          onChange={(e) => setQuoteValidityDays(e.target.valueAsNumber)}
          aria-invalid={validityOutOfRange}
        />
        <p className="text-xs text-fg-3">
          Default &ldquo;valid for&rdquo; when sending a quote. The send dialog stamps the resulting
          &ldquo;valid until&rdquo; date onto that revision, so it never shifts afterwards.
        </p>
      </div>

      <div className="space-y-2 sm:max-w-xs">
        <Label htmlFor="paymentTermsDays">Payment terms (days)</Label>
        <Input
          id="paymentTermsDays"
          type="number"
          min={PAYMENT_TERMS_BOUNDS.min}
          max={PAYMENT_TERMS_BOUNDS.max}
          value={paymentTermsDays}
          onChange={(e) => setPaymentTermsDays(e.target.valueAsNumber)}
          aria-invalid={paymentTermsOutOfRange}
        />
        <p className="text-xs text-fg-3">
          Default due date when issuing an invoice — invoice date + this many days (&ldquo;Net {paymentTermsDays || DEFAULT_PAYMENT_TERMS_DAYS}&rdquo;). The issue dialog lets you override it per invoice.
        </p>
      </div>

      <div className="flex justify-end">
        <Button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !hasChanges || validityOutOfRange || paymentTermsOutOfRange}
        >
          {mutation.isPending ? "Saving..." : "Save Document Settings"}
        </Button>
      </div>
    </div>
  );
}
