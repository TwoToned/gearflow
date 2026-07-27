"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import { invoiceSchema, type InvoiceFormValues } from "@/lib/validations/invoice";
import { getInvoiceNumberConfig } from "@/server/settings";
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
        actor: actor(),
        auditId: createId(),
        now: Date.now(),
      });
    },
    /** Assigns the invoice number — reads the CURRENT invoice-number format
     *  config (server action, small read-only call, matches
     *  getProjectNumberConfig's precedent) and allocates in-mutation. */
    issue: async (id: string, dueDate?: Date): Promise<{ id: string; invoiceNumber: string }> => {
      const org = requireOrg();
      const config = await getInvoiceNumberConfig();
      const now = new Date();
      return await issueM({
        id,
        orgId: org,
        autoNumber: {
          format: config.format,
          reset: config.reset,
          padding: config.padding,
          parts: datePartsInTimezone(now, config.timezone),
        },
        dueDate: dueDate?.getTime(),
        actor: actor(),
        auditId: createId(),
        now: now.getTime(),
      });
    },
    void: async (id: string, reason: string): Promise<void> => {
      const org = requireOrg();
      await voidM({ id, orgId: org, reason, actor: actor(), auditId: createId(), now: Date.now() });
    },
    deleteDraft: async (id: string): Promise<void> => {
      const org = requireOrg();
      await deleteDraftM({ id, orgId: org, actor: actor(), auditId: createId(), now: Date.now() });
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
