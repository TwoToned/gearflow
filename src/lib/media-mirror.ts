import { type FunctionReference } from "convex/server";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { prisma } from "@/lib/prisma";
import { api } from "../../convex/_generated/api";

/**
 * The seven `*_media` join tables — `model_media`, `asset_media`, `kit_media`,
 * `project_media`, `client_media`, `location_media`, `sub_hire_media` — are
 * DUAL-WRITTEN: every create / delete / set-primary / reorder writes the Prisma
 * row (the durable FK anchor — each carries a required + Cascade `fileId` FK to
 * `file_upload`, which itself stays in Prisma) AND mirrors to the matching Convex
 * table. Prisma is written first; the Convex payload is derived from the written
 * row so the two can't drift; the idempotent backfill is the heal path.
 *
 * Mirroring these lets the Phase-6 decommission source the reactive lists'
 * primary-photo grafts (getModelCounts / getKitCounts / getAssetRegistryPhotos)
 * off the Convex mirror via {@link file:./media-read.ts} instead of a Prisma
 * `*_media` join. Detail-page media galleries (composed inside large
 * cross-domain Prisma queries) stay on the fresh Prisma mirror — splitting one
 * `media` include out of a non-reactive detail query is gratuitous risk, same
 * call as the supplier/model name joins. See FEATUREDOCS/54.
 *
 * Write-path mapping (codex-reviewed):
 * - **create** → {@link mirrorMediaCreate} (targeted single insert).
 * - **delete / set-primary / reorder / parent-cascade** → {@link syncMediaForParent},
 *   an AUTHORITATIVE per-parent reconcile (re-read all of a parent's Prisma rows,
 *   upsert each into Convex, then REMOVE Convex rows whose Prisma id is gone).
 *   Media correctness is a parent-level invariant (one primary photo, sort order,
 *   promote-next-on-delete), so reconciling the whole parent is simpler and more
 *   drift-resistant than mirroring each intermediate row patch — and the
 *   remove-stale pass is what makes it correct after a delete (upsert-only would
 *   leave the deleted row in Convex). A parent's media set is small, so the
 *   list+upsert cost is negligible and these paths aren't hot.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRef = FunctionReference<"mutation", "public", any, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyQueryRef = FunctionReference<"query", "public", any, any>;
type Row = Record<string, unknown>;

export type MediaKind =
  | "model"
  | "asset"
  | "kit"
  | "project"
  | "client"
  | "location"
  | "subHire";

interface MediaSpec {
  /** The parent foreign-key column (e.g. `modelId`). */
  fk: string;
  /** Scalar columns to mirror. Only model/asset/kit carry `isPrimary`. */
  fields: string[];
  convex: {
    list: AnyQueryRef;
    listByParent: AnyQueryRef;
    create: AnyRef;
    createIfMissing: AnyRef;
    update: AnyRef;
    getById: AnyQueryRef;
    remove: AnyRef;
  };
  /** Re-read every Prisma row for one parent (the fresh source for reconcile). */
  findRows: (parentId: string) => Promise<Row[]>;
}

const BASE_FIELDS = ["id", "organizationId", "fileId", "type", "displayName", "sortOrder", "createdAt"];
/** model/asset/kit additionally carry the single-primary-photo flag. */
const PHOTO_FIELDS = [...BASE_FIELDS, "isPrimary"];

export const MEDIA_SPECS: Record<MediaKind, MediaSpec> = {
  model: {
    fk: "modelId",
    fields: [...PHOTO_FIELDS, "modelId"],
    convex: api.modelMedia,
    findRows: (id) => prisma.modelMedia.findMany({ where: { modelId: id } }) as unknown as Promise<Row[]>,
  },
  asset: {
    fk: "assetId",
    fields: [...PHOTO_FIELDS, "assetId"],
    convex: api.assetMedia,
    findRows: (id) => prisma.assetMedia.findMany({ where: { assetId: id } }) as unknown as Promise<Row[]>,
  },
  kit: {
    fk: "kitId",
    fields: [...PHOTO_FIELDS, "kitId"],
    convex: api.kitMedia,
    findRows: (id) => prisma.kitMedia.findMany({ where: { kitId: id } }) as unknown as Promise<Row[]>,
  },
  project: {
    fk: "projectId",
    fields: [...BASE_FIELDS, "projectId"],
    convex: api.projectMedia,
    findRows: (id) => prisma.projectMedia.findMany({ where: { projectId: id } }) as unknown as Promise<Row[]>,
  },
  client: {
    fk: "clientId",
    fields: [...BASE_FIELDS, "clientId"],
    convex: api.clientMedia,
    findRows: (id) => prisma.clientMedia.findMany({ where: { clientId: id } }) as unknown as Promise<Row[]>,
  },
  location: {
    fk: "locationId",
    fields: [...BASE_FIELDS, "locationId"],
    convex: api.locationMedia,
    findRows: (id) => prisma.locationMedia.findMany({ where: { locationId: id } }) as unknown as Promise<Row[]>,
  },
  subHire: {
    fk: "subHireId",
    fields: [...BASE_FIELDS, "subHireId"],
    convex: api.subHireMedia,
    findRows: (id) => prisma.subHireMedia.findMany({ where: { subHireId: id } }) as unknown as Promise<Row[]>,
  },
};

/**
 * Scalar-only projection of a media row (strips the `file` relation include
 * that several call sites carry, so the strict Convex create validator never
 * sees a nested relation object).
 */
export function mediaDoc(kind: MediaKind, row: Row): Row {
  const out: Row = {};
  for (const f of MEDIA_SPECS[kind].fields) if (f in row) out[f] = row[f];
  return out;
}

async function createIn(fn: AnyRef, doc: Row) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(fn, toConvexDoc(doc) as any);
}

async function patchIn(fn: AnyRef, id: string, doc: Row) {
  const { id: _id, ...rest } = toConvexDoc(doc);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(fn, { id, patch: rest } as any);
}

/**
 * Tolerant remove: the durable Prisma delete already committed, so a missing
 * Convex mirror row (predates dual-write, or whose create failed earlier) must
 * NOT surface as a user-facing error. The generated `remove` throws
 * "<table> not found: <id>"; swallow exactly that. Matches the `removeIn`
 * pattern in check-item-assignment-mirror / crew-scheduling-mirror.
 */
async function removeIn(fn: AnyRef, id: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (await getConvexClient()).mutation(fn, { id } as any);
  } catch (e) {
    if (!(e instanceof Error && /not found/i.test(e.message))) throw e;
  }
}

async function upsertIn(spec: MediaSpec, id: string, doc: Row) {
  const convex = await getConvexClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await convex.query(spec.convex.getById, { id } as any);
  if (existing) await patchIn(spec.convex.update, id, doc);
  else await createIn(spec.convex.create, doc);
}

/** Mirror a freshly written Prisma media row into Convex (targeted create). */
export async function mirrorMediaCreate(kind: MediaKind, row: Row) {
  // createIfMissing guards against concurrent creates (e.g. two rapid uploads or
  // a backfill running alongside a live create). Plain create would insert a
  // duplicate id, then any subsequent .unique() lookup on by_cuid would throw.
  await createIn(MEDIA_SPECS[kind].convex.createIfMissing, mediaDoc(kind, row));
}

/**
 * Authoritative per-parent reconcile. Re-read every Prisma media row for the
 * parent, upsert each into Convex, then remove any Convex row for that parent
 * whose Prisma id is gone. Call AFTER the Prisma write commits, for every path
 * that changes a parent-level media invariant: delete (+ promote-next),
 * set-primary, reorder, or a parent cascade-delete (parent gone → Prisma rows
 * empty → all of the parent's Convex rows are removed).
 */
export async function syncMediaForParent(kind: MediaKind, orgId: string, parentId: string) {
  const spec = MEDIA_SPECS[kind];
  void orgId; // reconcile is parent-scoped now; orgId kept for call-site compatibility
  const prismaRows = await spec.findRows(parentId);
  const convex = await getConvexClient();
  for (const row of prismaRows) {
    await upsertIn(spec, row.id as string, mediaDoc(kind, row));
  }
  // P1-4: query ONLY this parent's Convex rows (was an org-wide list + JS filter),
  // and re-read the live Prisma ids immediately before deleting so a row created
  // concurrently during the upsert pass isn't removed as stale (race guard).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const convexRows = (await convex.query(spec.convex.listByParent, { parentId } as any)) as Row[];
  const liveIds = new Set((await spec.findRows(parentId)).map((r) => r.id as string));
  for (const cr of convexRows) {
    if (!liveIds.has(cr.id as string)) {
      await removeIn(spec.convex.remove, cr.id as string);
    }
  }
}
