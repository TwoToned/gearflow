/**
 * `/asset fault` → DamageEvent. Resolves the three Step-5 hazards from the
 * /autoplan eng review:
 *
 *  1. RUNTIME-KILLER — `DamageEvent.createdById` is a required `User` FK, but a
 *     freelancer CrewMember has no User. We set `createdById` to the reporter's
 *     linked User when present, else a per-org SYSTEM actor (owner → admin → any
 *     member), and always record the true reporter in `reportedByCrewMemberId`.
 *  2. ENUM mismatch — "out of service" is NOT a severity. We accept only MINOR/MAJOR
 *     (TOTAL/out_of_service are rejected) + a `holdForRepair` flag that maps to
 *     `IN_MAINTENANCE` (there is no OUT_OF_SERVICE status).
 *  3. Status clobber / races — the hold flip is a guarded `updateMany` (only from
 *     AVAILABLE/RESERVED), so it never overrides a live CHECKED_OUT and a concurrent
 *     warehouse write loses cleanly.
 *
 * Permission: any LINKED crew may file a fault report (product intent — crew on
 * their phones). Only the status FLIP requires `maintenance:create`, so a low-priv
 * reporter is denied the flip but can still log the fault.
 */
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";
import { DiscordApiError } from "@/lib/discord/api-errors";
import { ACTIVE_PROJECT_STATUS_FILTER } from "@/lib/discord/project-statuses";
import { requireActorPermission, type ServiceActor } from "./discord-actor";

export interface FaultInput {
  code: string;
  description: string;
  severity: "MINOR" | "MAJOR";
  holdForRepair: boolean;
  /** Discord interaction id — makes a retried POST idempotent. */
  idempotencyKey?: string | null;
}

export interface FaultResult {
  damageEventId: string;
  assetTag: string;
  description: string;
  severity: string;
  holdForRepair: boolean;
  statusChanged: boolean;
  newStatus: string;
  idempotentReplay: boolean;
}

/** A real User id to satisfy the required createdById FK (owner → admin → any). */
async function resolveSystemActorUserId(
  organizationId: string,
  db: Prisma.TransactionClient,
): Promise<string> {
  for (const role of ["owner", "admin"]) {
    const m = await db.member.findFirst({ where: { organizationId, role }, select: { userId: true } });
    if (m) return m.userId;
  }
  const any = await db.member.findFirst({ where: { organizationId }, select: { userId: true } });
  if (any) return any.userId;
  throw new DiscordApiError("INTERNAL", "No system actor available to attribute the fault.");
}

export async function reportAssetFault(
  actor: ServiceActor,
  input: FaultInput,
  client: PrismaClient = prisma,
): Promise<FaultResult> {
  if (input.severity !== "MINOR" && input.severity !== "MAJOR") {
    throw new DiscordApiError("VALIDATION", "Severity must be MINOR or MAJOR.", {
      details: { field: "severity" },
    });
  }
  const description = input.description?.trim();
  if (!description) {
    throw new DiscordApiError("VALIDATION", "A fault description is required.", {
      details: { field: "description" },
    });
  }

  // Idempotent replay: same interaction id ⇒ return the already-created event.
  if (input.idempotencyKey) {
    const existing = await client.damageEvent.findUnique({
      where: { discordIdempotencyKey: input.idempotencyKey },
      include: { asset: { select: { assetTag: true, status: true } } },
    });
    if (existing) {
      return {
        damageEventId: existing.id,
        assetTag: existing.asset?.assetTag ?? input.code,
        description: existing.notes ?? description,
        severity: existing.severity,
        holdForRepair: input.holdForRepair,
        statusChanged: false,
        newStatus: existing.asset?.status ?? "UNKNOWN",
        idempotentReplay: true,
      };
    }
  }

  const asset = await client.asset.findFirst({
    where: {
      organizationId: actor.organizationId,
      assetTag: { equals: input.code.trim(), mode: "insensitive" },
    },
    select: { id: true, assetTag: true, status: true },
  });
  if (!asset) {
    throw new DiscordApiError("ASSET_NOT_FOUND", "No asset matches that code.", {
      details: { code: input.code.trim() },
    });
  }

  // Reporting is open to any linked crew; the status flip is privileged.
  if (input.holdForRepair) {
    await requireActorPermission(actor, "maintenance", "create", client);
  }

  // Attach to the asset's current active project, if any.
  const lineItem = await client.projectLineItem.findFirst({
    where: { assetId: asset.id, project: { isTemplate: false, status: ACTIVE_PROJECT_STATUS_FILTER } },
    select: { projectId: true },
  });

  // A real User id for the required createdById FK — reused for the activity log
  // (which also FKs userId), so a freelancer fault audits cleanly.
  const createdById = actor.userId ?? (await resolveSystemActorUserId(actor.organizationId, client));

  let result: FaultResult;
  try {
    result = await client.$transaction(async (tx) => {
      const damage = await tx.damageEvent.create({
        data: {
          organizationId: actor.organizationId,
          assetId: asset.id,
          projectId: lineItem?.projectId ?? null,
          severity: input.severity,
          notes: description,
          createdById,
          reportedByCrewMemberId: actor.crewMemberId,
          discordIdempotencyKey: input.idempotencyKey ?? null,
        },
      });

      let statusChanged = false;
      let newStatus = asset.status as string;
      if (input.holdForRepair) {
        const flip = await tx.asset.updateMany({
          where: { id: asset.id, organizationId: actor.organizationId, status: { in: ["AVAILABLE", "RESERVED"] } },
          data: { status: "IN_MAINTENANCE" },
        });
        if (flip.count === 1) {
          statusChanged = true;
          newStatus = "IN_MAINTENANCE";
        }
      }

      return {
        damageEventId: damage.id,
        assetTag: asset.assetTag,
        description,
        severity: input.severity,
        holdForRepair: input.holdForRepair,
        statusChanged,
        newStatus,
        idempotentReplay: false,
      };
    });
  } catch (err) {
    // Concurrent duplicate with the same idempotency key — return the winner.
    if (
      input.idempotencyKey &&
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const existing = await client.damageEvent.findUnique({
        where: { discordIdempotencyKey: input.idempotencyKey },
        include: { asset: { select: { assetTag: true, status: true } } },
      });
      if (existing) {
        return {
          damageEventId: existing.id,
          assetTag: existing.asset?.assetTag ?? asset.assetTag,
          description: existing.notes ?? description,
          severity: existing.severity,
          holdForRepair: input.holdForRepair,
          statusChanged: false,
          newStatus: existing.asset?.status ?? asset.status,
          idempotentReplay: true,
        };
      }
    }
    throw err;
  }

  await logActivity({
    organizationId: actor.organizationId,
    userId: createdById,
    userName: actor.userName,
    action: "CREATE",
    entityType: "damage_event",
    entityId: result.damageEventId,
    entityName: result.assetTag,
    summary: `${result.assetTag} fault reported via Discord (${result.severity})${result.statusChanged ? " — held for repair" : ""}`,
    assetId: asset.id,
  });

  return result;
}
