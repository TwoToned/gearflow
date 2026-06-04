/**
 * Core asset read fns shared by the Discord routes. Permission is enforced
 * against the resolved `ServiceActor` (no session) via `requireActorPermission`,
 * so the bot path runs the exact same `asset:read` gate the app uses.
 */
import { Prisma, ProjectStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { DiscordApiError } from "@/lib/discord/api-errors";
import { requireActorPermission, type ServiceActor } from "./discord-actor";

type Db = Prisma.TransactionClient;

/** Projects in a terminal state no longer count as a "current" assignment. */
const TERMINAL_PROJECT_STATUSES: ProjectStatus[] = [
  ProjectStatus.COMPLETED,
  ProjectStatus.INVOICED,
  ProjectStatus.CANCELLED,
  ProjectStatus.RETURNED,
];

/** Shape the bot's `/asset lookup` command renders (mirrors AssetLookupResult). */
export interface DiscordAssetLookup {
  assetTag: string;
  description: string;
  status: string;
  testTagStatus: string | null;
  currentProject: { projectNumber: string; name: string } | null;
}

function formatTestTagStatus(nextDate: Date | null, now: Date): string | null {
  if (!nextDate) return null;
  const day = nextDate.toISOString().slice(0, 10);
  return nextDate.getTime() < now.getTime() ? `Overdue (due ${day})` : `Valid to ${day}`;
}

/**
 * Look up an asset by tag for a linked Discord actor. Case-insensitive match,
 * org-scoped. Throws ASSET_NOT_FOUND (with the code) when nothing matches.
 */
export async function getAssetForDiscord(
  actor: ServiceActor,
  code: string,
  db: Db = prisma,
  now: Date = new Date(),
): Promise<DiscordAssetLookup> {
  await requireActorPermission(actor, "asset", "read", db);

  const trimmed = code.trim();
  if (!trimmed) {
    throw new DiscordApiError("VALIDATION", "Asset code is required.", {
      details: { field: "code" },
    });
  }

  const asset = await db.asset.findFirst({
    where: {
      organizationId: actor.organizationId,
      assetTag: { equals: trimmed, mode: "insensitive" },
    },
    include: { model: { select: { name: true } } },
  });
  if (!asset) {
    throw new DiscordApiError("ASSET_NOT_FOUND", "No asset matches that code.", {
      details: { code: trimmed },
    });
  }

  const lineItem = await db.projectLineItem.findFirst({
    where: {
      assetId: asset.id,
      project: { isTemplate: false, status: { notIn: TERMINAL_PROJECT_STATUSES } },
    },
    select: { project: { select: { projectNumber: true, name: true } } },
  });

  return {
    assetTag: asset.assetTag,
    description: asset.customName ?? asset.model.name,
    status: asset.status,
    testTagStatus: formatTestTagStatus(asset.nextTestAndTagDate, now),
    currentProject: lineItem?.project
      ? { projectNumber: lineItem.project.projectNumber, name: lineItem.project.name }
      : null,
  };
}
