import { z } from "zod";

// ─── API Keys (Phase 6 — #1002) ─────────────────────────────────────────────
//
// Shared by the create-key dialog's react-hook-form + the Convex-side bounds
// `apiKeys` writes get from `src/server/api-keys.ts`. Scope STRINGS are not
// validated against the RBAC vocabulary here — `hasScope`/`isScopeGranted`
// (convex/lib/scopes.ts) already reject an unrecognised scope at write time,
// and duplicating that check here would be a second hand-maintained copy
// (POLICY.md R-3.1).

export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(1, "A key name is required").max(100),
  actingUserId: z.string().min(1, "Choose who this key acts as"),
  scopes: z.array(z.string()).default([]),
  expiresAt: z.string().optional().nullable(),
  noFinancials: z.boolean().default(false),
});

export type ApiKeyCreateFormValues = z.input<typeof apiKeyCreateSchema>;
