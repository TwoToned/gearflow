"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { toast } from "sonner";
import { autoStatusToast } from "@/lib/project-status-automation";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import { paymentSchema, type PaymentFormValues } from "@/lib/validations/payment";

/** Browser-direct PAYMENT writes (#1055) — mirrors use-invoice-writes.ts. */
export function usePaymentWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const recordM = useMutation(api.paymentsWrites.recordNative);
  const voidM = useMutation(api.paymentsWrites.voidNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    /** #1228 — a payment that settles an invoice in full confirms the job.
     *  Announced here, once, so the status never moves under the person who
     *  recorded it. `autoStatus` is non-null only on the payment that actually
     *  crossed the boundary. */
    record: async (
      invoiceId: string,
      data: PaymentFormValues,
    ): Promise<{ id: string; autoStatus: string | null }> => {
      const org = requireOrg();
      const parsed = paymentSchema.parse(data);
      const res = await recordM({
        id: createId(),
        orgId: org,
        invoiceId,
        amount: parsed.amount,
        method: parsed.method,
        reference: parsed.reference || undefined,
        paidAt: parsed.paidAt.getTime(),
        notes: parsed.notes || undefined,
        actor: actor(),
        auditId: createId(),
        now: Date.now(),
      });
      const copy = autoStatusToast(res.autoStatus);
      if (copy) toast(copy.title, { description: copy.description });
      return res;
    },
    void: async (id: string, reason: string): Promise<void> => {
      const org = requireOrg();
      await voidM({ id, orgId: org, reason, actor: actor(), auditId: createId(), now: Date.now() });
    },
  };
}
