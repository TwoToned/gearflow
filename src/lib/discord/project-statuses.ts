import { ProjectStatus } from "@/generated/prisma/client";

/**
 * Projects in a terminal state: no longer a "current" assignment, and (if the
 * org configured `channelArchiveOnStatuses` to include them) their Discord
 * channel is archived rather than kept live. Mirrors the finished-status set
 * used by availability queries.
 */
export const TERMINAL_PROJECT_STATUSES: ProjectStatus[] = [
  ProjectStatus.COMPLETED,
  ProjectStatus.INVOICED,
  ProjectStatus.CANCELLED,
  ProjectStatus.RETURNED,
];

/** Project statuses ordered from earliest (enquiry) to latest (cancelled). */
export const PROJECT_STATUS_ORDER: ProjectStatus[] = [
  ProjectStatus.ENQUIRY,
  ProjectStatus.QUOTING,
  ProjectStatus.QUOTED,
  ProjectStatus.CONFIRMED,
  ProjectStatus.PREPPING,
  ProjectStatus.CHECKED_OUT,
  ProjectStatus.ON_SITE,
  ProjectStatus.RETURNED,
  ProjectStatus.COMPLETED,
  ProjectStatus.INVOICED,
  ProjectStatus.CANCELLED,
];

/**
 * "Should the bot create/keep a channel for this project's status?"
 *
 * Semantics: once a project reaches any status in `createOnStatuses`, the
 * channel sticks around until the status enters `archiveOnStatuses`. Statuses
 * before the create threshold (e.g. ENQUIRY when create=CONFIRMED) suppress
 * creation; statuses in the archive set trigger the move-to-archive flow.
 *
 * Honest edge: a project could pass through CONFIRMED and back to QUOTING — the
 * channel stays. We don't tear down a channel just because the project regresses;
 * an operator can manually delete if needed.
 */
export function shouldHaveChannel(
  current: ProjectStatus,
  createOnStatuses: ProjectStatus[],
  archiveOnStatuses: ProjectStatus[],
  hasChannelAlready: boolean,
): { shouldExist: boolean; shouldArchive: boolean } {
  const isArchive = archiveOnStatuses.includes(current);
  if (isArchive) return { shouldExist: true, shouldArchive: true };
  if (hasChannelAlready) return { shouldExist: true, shouldArchive: false };
  return { shouldExist: createOnStatuses.includes(current), shouldArchive: false };
}

/** Prisma filter selecting only active (non-terminal) projects. */
export const ACTIVE_PROJECT_STATUS_FILTER = { notIn: TERMINAL_PROJECT_STATUSES } as const;

export function isTerminalProjectStatus(status: ProjectStatus | string): boolean {
  return (TERMINAL_PROJECT_STATUSES as string[]).includes(status);
}
