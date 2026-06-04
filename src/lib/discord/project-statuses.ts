import { ProjectStatus } from "@/generated/prisma/client";

/**
 * Projects in a terminal state: no longer a "current" assignment, and their
 * Discord channel should be archived rather than kept live. Mirrors the
 * finished-status set used by availability queries.
 */
export const TERMINAL_PROJECT_STATUSES: ProjectStatus[] = [
  ProjectStatus.COMPLETED,
  ProjectStatus.INVOICED,
  ProjectStatus.CANCELLED,
  ProjectStatus.RETURNED,
];

/** Prisma filter selecting only active (non-terminal) projects. */
export const ACTIVE_PROJECT_STATUS_FILTER = { notIn: TERMINAL_PROJECT_STATUSES } as const;

export function isTerminalProjectStatus(status: ProjectStatus | string): boolean {
  return (TERMINAL_PROJECT_STATUSES as string[]).includes(status);
}
