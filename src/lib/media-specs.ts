import { type FunctionReference } from "convex/server";
import { api } from "../../convex/_generated/api";

/**
 * Shared media registry (Phase C). Maps each media "kind" to its parent FK column,
 * whether it carries the single-primary-photo flag, and its Convex CRUD module.
 * Used by both the read helpers ({@link file:./media-read.ts}) and the Convex-only
 * write helpers ({@link file:./media-write.ts}) — extracted out of the deleted
 * `media-mirror.ts` so deleting the mirror doesn't break the readers.
 */
export type MediaKind =
  | "model"
  | "asset"
  | "kit"
  | "project"
  | "client"
  | "location"
  | "subHire";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyQueryRef = FunctionReference<"query", "public", any, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMutationRef = FunctionReference<"mutation", "public", any, any>;

export interface MediaSpec {
  /** Parent foreign-key column (e.g. `modelId`). */
  fk: string;
  /** Only model/asset/kit carry the single-primary-photo flag + setPrimary. */
  photo: boolean;
  convex: {
    list: AnyQueryRef;
    listByParent: AnyQueryRef;
    getById: AnyQueryRef;
    create: AnyMutationRef;
    createIfMissing: AnyMutationRef;
    update: AnyMutationRef;
    remove: AnyMutationRef;
    /** Photo kinds (model/asset/kit) only. */
    setPrimary?: AnyMutationRef;
    /** modelMedia only. */
    reorder?: AnyMutationRef;
  };
}

export const MEDIA_SPECS: Record<MediaKind, MediaSpec> = {
  model: { fk: "modelId", photo: true, convex: api.modelMedia },
  asset: { fk: "assetId", photo: true, convex: api.assetMedia },
  kit: { fk: "kitId", photo: true, convex: api.kitMedia },
  project: { fk: "projectId", photo: false, convex: api.projectMedia },
  client: { fk: "clientId", photo: false, convex: api.clientMedia },
  location: { fk: "locationId", photo: false, convex: api.locationMedia },
  subHire: { fk: "subHireId", photo: false, convex: api.subHireMedia },
};
