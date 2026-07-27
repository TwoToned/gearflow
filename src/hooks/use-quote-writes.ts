"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import { quoteSchema, type QuoteFormValues } from "@/lib/validations/quote";

/** Browser-direct QUOTE writes (WS1 #940) — mirrors use-native-client-writes.ts. */
export function useQuoteWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const publishM = useMutation(api.quotesWrites.publishNative);

  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const requireOrg = (): string => {
    if (!orgId) throw new Error("No active organization");
    return orgId;
  };

  return {
    publish: async (projectId: string, data: QuoteFormValues): Promise<{ id: string; version: number }> => {
      const org = requireOrg();
      const parsed = quoteSchema.parse(data);
      return await publishM({
        id: createId(),
        organizationId: org,
        projectId,
        notes: parsed.notes || undefined,
        actor: actor(),
        auditId: createId(),
        now: Date.now(),
      });
    },
  };
}
