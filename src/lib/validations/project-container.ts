import { z } from "zod";

/** `projectContainers.kind` (packing containers, #1296) — mirrors
 *  `convex/lib/validators.ts`'s `ContainerKind` union; keep both in sync. */
export const CONTAINER_KINDS = ["ASSET", "BULK_ASSET", "CUSTOM"] as const;

export const projectContainerSchema = z
  .object({
    kind: z.enum(CONTAINER_KINDS),
    assetId: z.string().optional(),
    bulkAssetId: z.string().optional(),
    label: z.string().min(1, "Label is required").max(120),
    description: z.string().max(500).optional(),
    parentContainerId: z.string().optional(),
  })
  .refine((v) => (v.kind === "ASSET" ? !!v.assetId : v.kind === "BULK_ASSET" ? !!v.bulkAssetId : true), {
    message: "An asset must be selected for this container kind.",
    path: ["assetId"],
  });

export type ProjectContainerFormValues = z.input<typeof projectContainerSchema>;
