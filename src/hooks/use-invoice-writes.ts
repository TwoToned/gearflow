"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import {
  invoiceSchema,
  invoiceIssueSchema,
  type InvoiceFormValues,
  type InvoiceIssueValues,
} from "@/lib/validations/invoice";
import { getInvoiceNumberConfig } from "@/server/settings";
import { generateInvoiceArtifact } from "@/server/finance-documents";
import { datePartsInTimezone } from "@/lib/project-number";

/** Browser-direct INVOICE writes (WS1 #940) — mirrors use-native-client-writes.ts. */
export function useInvoiceWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const createM = useMutation(api.invoicesWrites.createNative);
  const issueM = useMutation(api.invoicesWrites.issueNative);
  const voidM = useMutation(api.invoicesWrites.voidNative);
  const deleteDraftM = useMutation(api.invoicesWrites.deleteDraftNative);
  const deleteVoidM = useMutation(api.invoicesWrites.deleteVoidNative);
  const createCreditM = useMutation(api.invoicesWrites.createCreditNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    create: async (
      projectId: string,
      clientId: string,
      data: InvoiceFormValues,
    ): Promise<{ id: string }> => {
      const org = requireOrg();
      const parsed = invoiceSchema.parse(data);
      return await createM({
        id: createId(),
        organizationId: org,
        projectId,
        clientId,
        kind: parsed.kind,
        notes: parsed.notes || undefined,
        dueDate: parsed.dueDate?.getTime(),
        depositPercent: parsed.depositPercent,
        depositAmount: parsed.depositAmount,
        depositMode: parsed.depositMode,
        actor: actor(),
        auditId: createId(),
        now: Date.now(),
      });
    },
    /**
     * Assigns the invoice number — reads the CURRENT invoice-number format
     * config (server action, small read-only call, matches
     * getProjectNumberConfig's precedent) and allocates in-mutation. Then
     * renders and stores the invoice PDF (#987), which is what makes an ISSUED
     * invoice immutable as a DOCUMENT and not only as a row.
     *
     * Same failure contract as sending a quote: a render failure leaves the
     * invoice issued with `artifactReady: false` and a retry in the finance
     * panel, never an unissued invoice or a silent gap.
     *
     * `data` carries the issue dialog's fields (#989) — invoiceDate defaults to
     * today, dueDate defaults server-side to invoiceDate + the org's
     * `paymentTermsDays` when omitted. This is what closes the "every invoice
     * issued has no due date" bug: the panel used to call `issue(id)` bare.
     */
    issue: async (
      id: string,
      data: InvoiceIssueValues = {},
    ): Promise<{ id: string; invoiceNumber: string; artifactReady: boolean }> => {
      const org = requireOrg();
      const parsed = invoiceIssueSchema.parse(data);
      const config = await getInvoiceNumberConfig();
      const now = new Date();
      const result = await issueM({
        id,
        orgId: org,
        autoNumber: {
          format: config.format,
          reset: config.reset,
          padding: config.padding,
          parts: datePartsInTimezone(now, config.timezone),
        },
        invoiceDate: (parsed.invoiceDate ?? now).getTime(),
        dueDate: parsed.dueDate?.getTime(),
        notes: parsed.notes || undefined,
        actor: actor(),
        auditId: createId(),
        now: now.getTime(),
      });

      let artifactReady = true;
      try {
        await generateInvoiceArtifact(result.id);
      } catch {
        artifactReady = false;
      }
      return { ...result, artifactReady };
    },
    void: async (id: string, reason: string): Promise<void> => {
      const org = requireOrg();
      await voidM({ id, orgId: org, reason, actor: actor(), auditId: createId(), now: Date.now() });
    },
    deleteDraft: async (id: string): Promise<void> => {
      const org = requireOrg();
      await deleteDraftM({ id, orgId: org, actor: actor(), auditId: createId(), now: Date.now() });
    },
    deleteVoid: async (id: string, opts: { confirmLabel: string }): Promise<void> => {
      const org = requireOrg();
      await deleteVoidM({ id, orgId: org, confirmLabel: opts.confirmLabel, actor: actor(), auditId: createId(), now: Date.now() });
    },
    createCredit: async (creditForInvoiceId: string, notes?: string): Promise<{ id: string }> => {
      const org = requireOrg();
      return await createCreditM({
        id: createId(),
        orgId: org,
        creditForInvoiceId,
        notes,
        actor: actor(),
        auditId: createId(),
        now: Date.now(),
      });
    },
  };
}
