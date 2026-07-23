# Key Patterns & Conventions

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

## Convex Browser-Direct Write Pattern (the default for domain writes)

Every domain write is a guarded Convex mutation, called directly from the
browser — there is no server-action hop. See
[FEATUREDOCS/54-convex-data-layer.md](./54-convex-data-layer.md) for the full
security-boundary rules; this is the shape every `*Writes.ts` mutation follows
(real example, trimmed — `convex/clientWrites.ts`):

```typescript
// convex/<domain>Writes.ts
export const createNative = mutation({
  args: { id: v.string(), organizationId: v.string(), /* ...fields */, actor: actorValidator, auditId: v.string() },
  handler: async (ctx, args) => {
    await assertWritesEnabled(ctx, "client");        // 1. global kill-switch
    await enforceBrowserWriteLimit(ctx);               // 2. per-caller rate limit
    await requireOrgPermission(ctx, args.organizationId, "client", "create"); // 3. RBAC
    const actor = await resolveActor(ctx, args.actor); // 4. unspoofable audit actor
    // ...insert + writeActivityLog(ctx, { ...auditId })
  },
});
```

A `use-<domain>-writes.ts` hook wraps the raw `useMutation(api.*)` calls with
id-minting (`createId()`), the verified actor, and the zod-parsed form data
(real example, trimmed — `src/hooks/use-native-client-writes.ts`):

```typescript
"use client";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

export function useClientWrites() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const createM = useMutation(api.clientWrites.createNative);

  return {
    create: async (data: ClientFieldsInput) => {
      const parsed = clientSchema.parse(data); // same zod schema the form uses
      const id = createId();
      await createM({
        id, organizationId: activeOrg!.id, ...toClientFields(parsed),
        createdAt: Date.now(), updatedAt: Date.now(),
        actor: { userId: session!.user.id, userName: session!.user.name },
        auditId: createId(),
      });
      return { id };
    },
  };
}
```

## Convex Read Pattern

Browser components subscribe with `useAuthedQuery` (an auth-gated drop-in for
`useQuery` — see `src/hooks/use-authed-query.ts` for why the gating exists)
instead of a data-fetching library:

```typescript
"use client";
import { api } from "../../convex/_generated/api";
import { useAuthedQuery } from "@/hooks/use-authed-query";

const counts = useAuthedQuery(api.collaboration.listThreadCommentCounts, { projectId });
// counts is live-updating — no manual invalidation, no polling, no loading-state
// plumbing beyond `counts === undefined` while the subscription is still loading.
```

## Server Action Pattern (permanent carve-outs ONLY)

Reach for this only for the surfaces FEATUREDOCS/54 lists as permanent
carve-outs (auth/crypto, HMAC/external API, email/iCal, CSV/Node) — not for
new domain CRUD:

```typescript
"use server";
export async function myAction(data: InputType) {
  const { organizationId, userId, userName } = await getOrgContext();
  await requirePermission("resource", "action");
  const result = await someExternalOrCryptoOperation(data);
  return serialize(result);
}
```

## Form Validation Pattern
```typescript
// src/lib/validations/my-form.ts
export const mySchema = z.object({
  name: z.string().min(1, "Required"),
  date: z.union([z.literal(""), z.coerce.date()]).optional()
    .transform(v => v === "" ? undefined : v),
  price: z.coerce.number().optional(),
  tags: z.array(z.string()).default([]),
});
export type MyFormValues = z.input<typeof mySchema>; // NOT z.infer
```
React Hook Form + `zodResolver(mySchema)`. The same schema is reused by the
Convex write hook above (`clientSchema.parse(data)`) so client-form validation
and the mutation boundary agree.

## Date Handling
Server-action carve-outs still receive dates as strings after `serialize()`.
Always wrap:
```typescript
const date = input.scheduledDate ? new Date(input.scheduledDate) : null;
```
Convex mutations take/return millisecond timestamps (`number`, via
`Date.now()`), not Date objects or ISO strings — don't mix the two
conventions across a single call.

## Important Gotchas
- Zod schemas CANNOT be exported from `"use server"` files — must be in `src/lib/validations/`
- `pdfme` (`@pdfme/generator`) can't render Unicode symbols with Helvetica — use plain text/boxes
- Kit join tables use `addedAt` (not `createdAt`)
- Bulk detection on line items: `!!lineItem.bulkAssetId || (!lineItem.assetId && lineItem.quantity > 1)`
- Kit detection on line items: `!!lineItem.kitId && !lineItem.isKitChild`
- `by_cuid` / `by_modelId` Convex indexes are **global** — re-check `organizationId`
  on every doc fetched through them (see FEATUREDOCS/54)
