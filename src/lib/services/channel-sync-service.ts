/**
 * Channel-sync source-of-truth fns. The bot holds no DB access, so it reads the
 * DESIRED channel state from here and records the created channel id back. The
 * design is converge-to-desired-state: the bot re-applies the full member set on
 * every project event, which is naturally idempotent and doubles as /reconcile.
 *
 * These are system operations (the bot acting as itself, not a user), so the
 * routes gate on the global bot Bearer (withBotAuth), not a per-user actor.
 */
import { Prisma, ProjectStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { DiscordApiError } from "@/lib/discord/api-errors";
import {
  ACTIVE_PROJECT_STATUS_FILTER,
  shouldHaveChannel,
} from "@/lib/discord/project-statuses";

type Db = Prisma.TransactionClient;

/** The desired Discord channel state for a project. */
export interface ProjectChannelSpec {
  projectId: string;
  projectNumber: string;
  name: string;
  status: string;
  isTemplate: boolean;
  /**
   * Should this project have a channel at all (per the org's `channelCreateOnStatuses`)?
   * False for projects below the create threshold; the bot no-ops if no channel
   * exists yet, but keeps an existing channel until status enters the archive set.
   */
  shouldExist: boolean;
  /**
   * Should the channel be archived (status in `channelArchiveOnStatuses`)? When
   * true, the bot moves the channel to the org's `archiveCategoryId` and locks
   * it. When the status flips back off the archive list, the bot moves it back
   * to the active category.
   */
  shouldArchive: boolean;
  /** Category the channel should live in (active by default; archive when shouldArchive). */
  targetCategoryId: string | null;
  /** Existing channel id, or null if not yet created. */
  channelId: string | null;
  /** Discord ids of assigned crew who have linked — the desired overwrite set. */
  members: string[];
  /** Assigned crew who have NOT linked yet (shown as a "pending access" warning). */
  pendingCount: number;
  /** True when the bot should post the welcome embed on this channel's first creation. */
  postWelcomeOnCreate: boolean;
}

/** Build the desired channel spec for a project (org-scoped). */
export async function getProjectChannelSpec(
  projectId: string,
  organizationId: string,
  db: Db = prisma,
): Promise<ProjectChannelSpec> {
  const [project, integration] = await Promise.all([
    db.project.findFirst({
      where: { id: projectId, organizationId },
      select: {
        id: true,
        projectNumber: true,
        name: true,
        status: true,
        isTemplate: true,
        discordChannelId: true,
        crewAssignments: {
          select: { crewMember: { select: { discordLink: { select: { discordUserId: true } } } } },
        },
      },
    }),
    db.discordIntegration.findUnique({
      where: { organizationId },
      select: {
        projectCategoryId: true,
        archiveCategoryId: true,
        channelCreateOnStatuses: true,
        channelArchiveOnStatuses: true,
        postWelcomeOnCreate: true,
      },
    }),
  ]);
  if (!project) {
    throw new DiscordApiError("PROJECT_NOT_FOUND", "Project not found.", {
      details: { projectId },
    });
  }

  const members = new Set<string>();
  let pendingCount = 0;
  for (const assignment of project.crewAssignments) {
    const link = assignment.crewMember.discordLink;
    if (link) members.add(link.discordUserId);
    else pendingCount += 1;
  }

  // Integration row absent (defensive — the route would normally fail first):
  // fall back to "always exist, never archive" so the bot does something sensible.
  const createOn = integration?.channelCreateOnStatuses ?? [ProjectStatus.CONFIRMED];
  const archiveOn = integration?.channelArchiveOnStatuses ?? [
    ProjectStatus.COMPLETED,
    ProjectStatus.INVOICED,
    ProjectStatus.RETURNED,
    ProjectStatus.CANCELLED,
  ];
  const { shouldExist, shouldArchive } = shouldHaveChannel(
    project.status,
    createOn,
    archiveOn,
    project.discordChannelId !== null,
  );
  const targetCategoryId = shouldArchive
    ? (integration?.archiveCategoryId ?? null)
    : (integration?.projectCategoryId ?? null);

  return {
    projectId: project.id,
    projectNumber: project.projectNumber,
    name: project.name,
    status: project.status,
    isTemplate: project.isTemplate,
    shouldExist,
    shouldArchive,
    targetCategoryId,
    channelId: project.discordChannelId,
    members: [...members],
    pendingCount,
    postWelcomeOnCreate: integration?.postWelcomeOnCreate ?? true,
  };
}

/**
 * Idempotently record the created channel id. Guard: only sets it when currently
 * null, so two racing creates can't both win. Returns the EFFECTIVE channel id —
 * if another worker already recorded a different one, the caller should delete
 * its just-created channel and use the returned id instead.
 */
export async function recordProjectChannelId(
  projectId: string,
  organizationId: string,
  channelId: string,
  db: Db = prisma,
): Promise<{ channelId: string | null; created: boolean }> {
  const claim = await db.project.updateMany({
    where: { id: projectId, organizationId, discordChannelId: null },
    data: { discordChannelId: channelId },
  });
  if (claim.count === 1) return { channelId, created: true };

  const existing = await db.project.findFirst({
    where: { id: projectId, organizationId },
    select: { discordChannelId: true },
  });
  return { channelId: existing?.discordChannelId ?? null, created: false };
}

/** Active (non-terminal, non-template) project ids a crew member is assigned to. */
export async function getCrewActiveProjects(
  crewMemberId: string,
  organizationId: string,
  db: Db = prisma,
): Promise<{ discordUserId: string | null; projectIds: string[] }> {
  const crew = await db.crewMember.findFirst({
    where: { id: crewMemberId, organizationId },
    select: { discordLink: { select: { discordUserId: true } } },
  });
  const assignments = await db.crewAssignment.findMany({
    where: {
      crewMemberId,
      organizationId,
      project: { isTemplate: false, status: ACTIVE_PROJECT_STATUS_FILTER },
    },
    select: { projectId: true },
  });
  const projectIds = [...new Set(assignments.map((a) => a.projectId))];
  return { discordUserId: crew?.discordLink?.discordUserId ?? null, projectIds };
}
