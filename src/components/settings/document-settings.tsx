"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";

import { useServerMutation } from "@/hooks/use-server-mutation";
import { refreshOrganization } from "@/hooks/use-organization";
import { useActiveOrganization } from "@/lib/auth-client";
import { updateOrganization } from "@/server/settings";
import type { OrgSettings, OrgDocumentSettings } from "@/lib/org-settings-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface DocumentSettingsProps {
  orgName: string;
  settings: OrgSettings;
  onDocumentsChange?: (documents: OrgDocumentSettings | undefined) => void;
}

const DEFAULT_QUOTE_VALIDITY_DAYS = 30;

export function DocumentSettings({ orgName, settings, onDocumentsChange }: DocumentSettingsProps) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const documents = settings.documents || {};

  const [footerText, setFooterText] = useState(documents.footerText || "");
  const [footerSecondLine, setFooterSecondLine] = useState(documents.footerSecondLine || "");
  const [termsAndConditions, setTermsAndConditions] = useState(documents.termsAndConditions || "");
  const [quoteValidityDays, setQuoteValidityDays] = useState(documents.quoteValidityDays ?? DEFAULT_QUOTE_VALIDITY_DAYS);

  // Sync from server when settings change
  useEffect(() => {
    const d = settings.documents || {};
    setFooterText(d.footerText || ""); // eslint-disable-line react-hooks/set-state-in-effect
    setFooterSecondLine(d.footerSecondLine || ""); // eslint-disable-line react-hooks/set-state-in-effect
    setTermsAndConditions(d.termsAndConditions || ""); // eslint-disable-line react-hooks/set-state-in-effect
    setQuoteValidityDays(d.quoteValidityDays ?? DEFAULT_QUOTE_VALIDITY_DAYS); // eslint-disable-line react-hooks/set-state-in-effect
  }, [settings.documents]);

  function buildDocuments(): OrgDocumentSettings | undefined {
    const next: OrgDocumentSettings = {
      footerText: footerText.trim() || undefined,
      footerSecondLine: footerSecondLine.trim() || undefined,
      termsAndConditions: termsAndConditions.trim() || undefined,
      quoteValidityDays: quoteValidityDays !== DEFAULT_QUOTE_VALIDITY_DAYS ? quoteValidityDays : undefined,
    };
    const hasAny =
      !!next.footerText || !!next.footerSecondLine || !!next.termsAndConditions || next.quoteValidityDays !== undefined;
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
    quoteValidityDays !== (documents.quoteValidityDays ?? DEFAULT_QUOTE_VALIDITY_DAYS);

  const validityOutOfRange = !Number.isFinite(quoteValidityDays) || quoteValidityDays < 1 || quoteValidityDays > 365;

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
          placeholder="Shown as a block on quotes. Plain text — no tokens."
          maxLength={4000}
          rows={5}
        />
        <p className="text-xs text-fg-3">Shown on quotes only.</p>
      </div>

      <div className="space-y-2 sm:max-w-xs">
        <Label htmlFor="quoteValidityDays">Quote validity (days)</Label>
        <Input
          id="quoteValidityDays"
          type="number"
          min={1}
          max={365}
          value={quoteValidityDays}
          onChange={(e) => setQuoteValidityDays(e.target.valueAsNumber)}
          aria-invalid={validityOutOfRange}
        />
        <p className="text-xs text-fg-3">
          Quotes show &ldquo;Valid until&rdquo; computed from the generation date plus this many days.
        </p>
      </div>

      <div className="flex justify-end">
        <Button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !hasChanges || validityOutOfRange}
        >
          {mutation.isPending ? "Saving..." : "Save Document Settings"}
        </Button>
      </div>
    </div>
  );
}
