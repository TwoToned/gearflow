"use server";

import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { removeUserFromConvex } from "@/lib/user-mirror";
import {
  upsertMemberMirror,
  upsertMemberMirrorByOrgUser,
  removeMemberMirror,
} from "@/lib/member-mirror";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { getSiteSettingsFromConvex } from "@/lib/site-settings-read";
import { requireSession } from "@/lib/auth-server";
import { serialize } from "@/lib/serialize";
import { invalidatePlatformNameCache } from "@/lib/platform";
import { sendEmail } from "@/lib/email";
import { siteAdminInvitationEmail } from "@/lib/email-templates";
import { getPlatformName } from "@/lib/platform";
import { getTheOrg, invalidateOrgCache } from "@/lib/single-org";
import { env } from "@/env";
import { logActivity } from "@/lib/activity-log";
import { runWithConcurrency } from "@/lib/concurrency";
import { requireSiteAdmin, isSiteAdmin as checkIsSiteAdmin } from "@/lib/admin-auth";

/** Check if the current user is a site admin */
export async function isSiteAdmin(): Promise<boolean> {
  return checkIsSiteAdmin();
}

// ─── Site Settings ─────────────────────────────────────────────────────────

export async function getSiteSettings() {
  // siteSettings is Convex-only (Phase C). Returns the singleton or defaults; a
  // row is created on the first updateSiteSettings save (no create-on-read).
  return serialize(await getSiteSettingsFromConvex());
}

export async function updateSiteSettings(data: {
  platformName?: string;
  platformIcon?: string | null;
  platformLogo?: string | null;
  registrationPolicy?: string;
  twoFactorGlobalPolicy?: string;
  defaultCurrency?: string;
  defaultTaxRate?: number;
  allowOrgCreation?: boolean;
}) {
  const session = await requireSiteAdmin();

  // Upsert the Convex singleton (create-if-missing + patch in one race-safe
  // mutation). null on platformIcon/platformLogo clears the field.
  const updated = await (await getConvexClient()).mutation(
    api.siteSettings.upsertSingleton,
    { fallbackId: createId(), now: Date.now(), patch: data },
  );

  // Invalidate the cached platform name so it picks up changes immediately
  invalidatePlatformNameCache();

  const theOrg = await getTheOrg();
  if (theOrg) {
    await logActivity({
      organizationId: theOrg.id,
      userId: session.user.id,
      userName: session.user.name,
      action: "UPDATE",
      entityType: "siteSettings",
      entityId: updated.id,
      entityName: "Site Settings",
      summary: "Updated site settings",
      details: data as Record<string, unknown>,
    });
  }

  // Return the mapped singleton so the write result matches getSiteSettings's shape.
  return serialize(await getSiteSettingsFromConvex());
}

// ─── Org Creation Policy ──────────────────────────────────────────────────

/** Check whether the current user is allowed to create organizations.
 * Single-org mode: only allowed if no org exists yet (bootstrap).
 */
export async function checkOrgCreationAllowed(): Promise<{ allowed: boolean; isSiteAdmin: boolean }> {
  const admin = await checkIsSiteAdmin();
  const org = await getTheOrg();
  // Only allow creation if no org exists (bootstrap)
  return { allowed: !org && admin, isSiteAdmin: admin };
}

/** Get the single organization for admin pages. */
export async function adminGetTheOrg() {
  await requireSiteAdmin();
  const org = await getTheOrg();
  if (!org) return null;
  return serialize(org);
}

// ─── Organization Management ───────────────────────────────────────────────

export async function adminCreateOrganization(data: {
  name: string;
  slug: string;
  ownerUserId?: string;
}) {
  const session = await requireSiteAdmin();
  const { name, slug, ownerUserId } = data;

  if (!name.trim() || !slug.trim()) {
    throw new Error("Name and slug are required.");
  }

  // Validate slug format
  const normalizedSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/(^-|-$)/g, "");
  if (!normalizedSlug) throw new Error("Invalid slug.");

  // Check slug uniqueness
  const existing = await prisma.organization.findUnique({ where: { slug: normalizedSlug } });
  if (existing) throw new Error("An organization with this slug already exists.");

  // Determine owner — defaults to the admin performing the action
  const ownerId = ownerUserId || session.user.id;
  const ownerUser = await prisma.user.findUnique({ where: { id: ownerId }, select: { id: true } });
  if (!ownerUser) throw new Error("Owner user not found.");

  const org = await prisma.$transaction(async (tx) => {
    const newOrg = await tx.organization.create({
      data: { name: name.trim(), slug: normalizedSlug },
    });
    await tx.member.create({
      data: { organizationId: newOrg.id, userId: ownerId, role: "owner" },
    });
    return newOrg;
  });

  // Additive (org + owner created): mirror best-effort after the transaction.
  await upsertMemberMirrorByOrgUser(org.id, ownerId);

  await logActivity({
    organizationId: org.id,
    userId: session.user.id,
    userName: session.user.name,
    action: "CREATE",
    entityType: "organization",
    entityId: org.id,
    entityName: org.name,
    summary: `Created organization ${org.name}`,
  });

  return serialize(org);
}

export async function getAllOrganizations(params?: {
  page?: number;
  pageSize?: number;
  search?: string;
}) {
  await requireSiteAdmin();
  const { page = 1, pageSize = 20, search } = params || {};

  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { slug: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [organizations, total] = await Promise.all([
    prisma.organization.findMany({
      where,
      include: {
        members: {
          include: { user: { select: { id: true, name: true, email: true } } },
          where: { role: "owner" },
          take: 1,
        },
        _count: { select: { members: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.organization.count({ where }),
  ]);

  return serialize({
    organizations,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function adminUpdateOrganization(
  orgId: string,
  data: { name?: string; slug?: string },
) {
  const session = await requireSiteAdmin();

  if (data.slug) {
    const normalizedSlug = data.slug.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/(^-|-$)/g, "");
    if (!normalizedSlug) throw new Error("Invalid slug.");
    const existing = await prisma.organization.findFirst({
      where: { slug: normalizedSlug, id: { not: orgId } },
    });
    if (existing) throw new Error("An organization with this slug already exists.");
    data.slug = normalizedSlug;
  }

  const updated = await prisma.organization.update({
    where: { id: orgId },
    data,
  });

  invalidateOrgCache();

  await logActivity({
    organizationId: orgId,
    userId: session.user.id,
    userName: session.user.name,
    action: "UPDATE",
    entityType: "organization",
    entityId: orgId,
    entityName: updated.name,
    summary: `Updated organization ${updated.name}`,
    details: data,
  });

  return serialize(updated);
}

export async function adminDeleteOrganization(orgId: string) {
  const session = await requireSiteAdmin();

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true },
  });
  if (!org) throw new Error("Organization not found");

  await prisma.organization.delete({ where: { id: orgId } });

  await logActivity({
    organizationId: orgId,
    userId: session.user.id,
    userName: session.user.name,
    action: "DELETE",
    entityType: "organization",
    entityId: orgId,
    entityName: org.name,
    summary: `Deleted organization ${org.name}`,
  });

  return { success: true };
}

export async function adminGetOrganizationDetails(orgId: string) {
  await requireSiteAdmin();

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, email: true, image: true } } },
        orderBy: { createdAt: "asc" },
      },
      _count: {
        // Domain relations (assets/bulkAssets/projects/kits) live in Convex now;
        // only KEPT auth relations remain countable here.
        select: {
          members: true,
          invitations: true,
        },
      },
    },
  });

  if (!org) throw new Error("Organization not found");
  return serialize(org);
}

// ─── User Management ───────────────────────────────────────────────────────

export async function getAllUsers(params?: {
  page?: number;
  pageSize?: number;
  search?: string;
  roleFilter?: string;
}) {
  await requireSiteAdmin();
  const { page = 1, pageSize = 20, search, roleFilter } = params || {};

  const where: Record<string, unknown> = {};
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }
  if (roleFilter) {
    where.role = roleFilter;
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true,
        banned: true,
        twoFactorEnabled: true,
        createdAt: true,
        updatedAt: true,
        members: {
          include: {
            organization: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  return serialize({
    users,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function promoteToSiteAdmin(userId: string) {
  const session = await requireSiteAdmin();

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { role: "admin" },
  });

  const theOrg = await getTheOrg();
  if (theOrg) {
    await logActivity({
      organizationId: theOrg.id,
      userId: session.user.id,
      userName: session.user.name,
      action: "UPDATE",
      entityType: "user",
      entityId: userId,
      entityName: targetUser?.name || userId,
      summary: `Promoted ${targetUser?.name || userId} to site admin`,
    });
  }

  return { success: true };
}

export async function demoteFromSiteAdmin(userId: string) {
  const session = await requireSiteAdmin();
  if (session.user.id === userId) {
    throw new Error("You cannot demote yourself.");
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { role: "user" },
  });

  const theOrg = await getTheOrg();
  if (theOrg) {
    await logActivity({
      organizationId: theOrg.id,
      userId: session.user.id,
      userName: session.user.name,
      action: "UPDATE",
      entityType: "user",
      entityId: userId,
      entityName: targetUser?.name || userId,
      summary: `Demoted ${targetUser?.name || userId} from site admin`,
    });
  }

  return { success: true };
}

export async function banUser(userId: string) {
  const session = await requireSiteAdmin();
  if (session.user.id === userId) {
    throw new Error("You cannot ban yourself.");
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { banned: true },
  });

  const theOrg = await getTheOrg();
  if (theOrg) {
    await logActivity({
      organizationId: theOrg.id,
      userId: session.user.id,
      userName: session.user.name,
      action: "UPDATE",
      entityType: "user",
      entityId: userId,
      entityName: targetUser?.name || userId,
      summary: `Banned ${targetUser?.name || userId}`,
    });
  }

  return { success: true };
}

export async function unbanUser(userId: string) {
  const session = await requireSiteAdmin();

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { banned: false },
  });

  const theOrg = await getTheOrg();
  if (theOrg) {
    await logActivity({
      organizationId: theOrg.id,
      userId: session.user.id,
      userName: session.user.name,
      action: "UPDATE",
      entityType: "user",
      entityId: userId,
      entityName: targetUser?.name || userId,
      summary: `Unbanned ${targetUser?.name || userId}`,
    });
  }

  return { success: true };
}

export async function adminDeleteUser(userId: string) {
  const session = await requireSiteAdmin();
  if (session.user.id === userId) {
    throw new Error("You cannot delete yourself.");
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });

  // Capture the dual-written rows this user owns, so we can mirror their
  // deletion to Convex after the transaction commits (Convex calls cannot run
  // inside a Prisma $transaction).
  const convexForDelete = await getConvexClient();

  // kitSerializedItem / kitBulkItem are Convex-only; both now have a by_addedById
  // index, so this GDPR sweep resolves them in one indexed query each instead of
  // enumerating every org's whole table (mirrors assetScanLogs.listByScannedById/
  // testTagRecords.listByTestedById below). organization stays on Prisma (KEPT table).
  const allOrgsForSweep = await prisma.organization.findMany({ select: { id: true } });
  // projectLineItem is Convex-only too; collect the lines whose checkedOutById /
  // returnedById point at this user so we can clear those FKs post-commit.
  const lineItemsToClearCheckedOut: { id: string }[] = [];
  const lineItemsToClearReturned: { id: string }[] = [];
  // project is Convex-only — collect projects this user manages so the
  // projectManagerId FK can be cleared post-commit (replaces the old in-tx
  // prisma.project.updateMany).
  const projectsToClearManager: { id: string }[] = [];
  for (const org of allOrgsForSweep) {
    const [lines, projects] = await Promise.all([
      convexForDelete.query(api.projectLineItems.list, { orgId: org.id }),
      convexForDelete.query(api.projects.list, { orgId: org.id }),
    ]);
    for (const li of lines) {
      if (li.checkedOutById === userId) lineItemsToClearCheckedOut.push({ id: li.id });
      if (li.returnedById === userId) lineItemsToClearReturned.push({ id: li.id });
    }
    for (const p of projects) if (p.projectManagerId === userId) projectsToClearManager.push({ id: p.id });
  }

  const [serializedItemsToRemove, bulkItemsToRemove, scanLogsToRemove, testTagRecordsToRemove] = await Promise.all([
    convexForDelete.query(api.kitSerializedItems.listByAddedById, { addedById: userId }),
    convexForDelete.query(api.kitBulkItems.listByAddedById, { addedById: userId }),
    convexForDelete.query(api.assetScanLogs.listByScannedById, { scannedById: userId }),
    convexForDelete.query(api.testTagRecords.listByTestedById, { testedById: userId }),
  ]);
  // SubTestRecords cascade-delete when their TestTagRecord is removed; capture
  // them so their Convex mirrors are removed too.
  const subTestRecordsToRemove = testTagRecordsToRemove.length
    ? await convexForDelete.query(api.subTestRecords.listByRecordIds, { recordIds: testTagRecordsToRemove.map((r) => r.id) })
    : [];

  await prisma.$transaction(async (tx) => {
    // Null out nullable User FK references (KEPT tables only).
    // maintenanceRecord and project are Convex-only now — the
    // projectManagerId / reportedById / assignedToId FK scrubs run post-commit
    // (api.projects.patchProject + api.maintenanceRecords.scrubUserRefs below).

    // domain data lives in Convex; user-deletion no longer cascades Prisma domain rows
    await tx.user.delete({ where: { id: userId } });
  });

  // Convex-only follow-ups (cannot run inside a $transaction). projectLineItem,
  // kitSerializedItem and kitBulkItem are Convex-only: clear the user FKs on
  // line items and delete the kit-member rows this user added.
  // Every follow-up here is an independent FK-clear / row-remove across distinct
  // Convex tables (maintenanceRecord.scrubUserRefs is per-org) — was one
  // sequential Convex round-trip per row across ~9 loops (a heavy GDPR sweep).
  // Run them with BOUNDED concurrency (not a bare Promise.all): a user who
  // touched thousands of rows would otherwise fan out thousands of concurrent
  // requests, hit Convex/HTTP limits, reject the whole batch, and leave the
  // already-deleted user with unswept references.
  const deletionTasks: Array<() => Promise<unknown>> = [
    ...lineItemsToClearCheckedOut.map((li) => () =>
      convexForDelete.mutation(api.projectLineItems.patchLineItem, { id: li.id, set: {}, clear: ["checkedOutById"] }),
    ),
    ...lineItemsToClearReturned.map((li) => () =>
      convexForDelete.mutation(api.projectLineItems.patchLineItem, { id: li.id, set: {}, clear: ["returnedById"] }),
    ),
    // project is Convex-only — clear the projectManagerId FK on this user's projects.
    ...projectsToClearManager.map((p) => () =>
      convexForDelete.mutation(api.projects.patchProject, { id: p.id, set: {}, clear: ["projectManagerId"] }),
    ),
    ...serializedItemsToRemove.map((item) => () => convexForDelete.mutation(api.kitSerializedItems.remove, { id: item.id })),
    ...bulkItemsToRemove.map((item) => () => convexForDelete.mutation(api.kitBulkItems.remove, { id: item.id })),
    ...scanLogsToRemove.map((item) => () => convexForDelete.mutation(api.assetScanLogs.remove, { id: item.id })),
    ...subTestRecordsToRemove.map((item) => () => convexForDelete.mutation(api.subTestRecords.remove, { id: item.id })),
    ...testTagRecordsToRemove.map((item) => () => convexForDelete.mutation(api.testTagRecords.remove, { id: item.id })),
    // maintenanceRecord is Convex-only: clear this user's reportedById/assignedToId
    // FK references across every org (GDPR sweep is cross-org).
    ...allOrgsForSweep.map((org) => () =>
      convexForDelete.mutation(api.maintenanceRecords.scrubUserRefs, { organizationId: org.id, userId }),
    ),
    // crewMembers.userId links a crew profile to this platform account (R-8.12.2,
    // #614) — by_userId is a global index, so one call covers every org.
    () => convexForDelete.mutation(api.crewMembers.scrubUserRefs, { userId }),
  ];
  await runWithConcurrency(deletionTasks, 20);

  // Remove the user from the Convex `users` mirror (best-effort).
  await removeUserFromConvex(userId);

  // Verifiable removal (POLICY.md R-8.12.2): confirm the user's IDENTITY PII is actually
  // gone from both stores after the sweep, so the erasure is auditable, not fire-and-forget.
  const verification = await verifyUserErased(userId);

  const theOrg = await getTheOrg();
  if (theOrg) {
    await logActivity({
      organizationId: theOrg.id,
      userId: session.user.id,
      userName: session.user.name,
      action: "DELETE",
      entityType: "user",
      entityId: userId,
      entityName: targetUser?.name || userId,
      summary: `Deleted user ${targetUser?.name || userId}` +
        (verification.erased ? " — erasure verified" : ` — WARNING: PII remains (${verification.remaining.join(", ")})`),
    });
  }
  if (!verification.erased) {
    logger.error("[erasure] user PII remains after deletion (R-8.12.2)", {
      userId,
      remaining: verification.remaining,
    });
  }

  return { success: true, verification };
}

/**
 * Verify a user's identity PII is gone from every store after an erasure
 * (POLICY.md R-8.12.2). Read-only: returns which stores still reference the user so the
 * erasure is auditable. Convex search indexes update automatically when the `users`
 * mirror row is removed, so a clean mirror means the user is unsearchable there too.
 */
async function verifyUserErased(
  userId: string,
): Promise<{ erased: boolean; remaining: string[] }> {
  const remaining: string[] = [];

  // Postgres (Better Auth identity tables — sessions/accounts cascade off `user`).
  const [pgUser, pgSession, pgAccount] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
    prisma.session.findFirst({ where: { userId }, select: { id: true } }),
    prisma.account.findFirst({ where: { userId }, select: { id: true } }),
  ]);
  if (pgUser) remaining.push("postgres:user");
  if (pgSession) remaining.push("postgres:session");
  if (pgAccount) remaining.push("postgres:account");

  // Convex `users` mirror (drives cross-domain name/email resolution + search).
  try {
    const convex = await getConvexClient();
    const [mirror, crewMemberLink] = await Promise.all([
      convex.query(api.users.getById, { id: userId }),
      convex.query(api.crewMembers.existsByUserId, { userId }),
    ]);
    if (mirror) remaining.push("convex:users-mirror");
    if (crewMemberLink) remaining.push("convex:crewMembers.userId");
  } catch {
    remaining.push("convex:unverified");
  }

  return { erased: remaining.length === 0, remaining };
}

export async function forceDisable2FA(userId: string) {
  const session = await requireSiteAdmin();

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });

  await prisma.$transaction([
    prisma.twoFactor.deleteMany({ where: { userId } }),
    prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false },
    }),
  ]);

  const theOrg = await getTheOrg();
  if (theOrg) {
    await logActivity({
      organizationId: theOrg.id,
      userId: session.user.id,
      userName: session.user.name,
      action: "UPDATE",
      entityType: "user",
      entityId: userId,
      entityName: targetUser?.name || userId,
      summary: `Force-disabled 2FA for ${targetUser?.name || userId}`,
    });
  }

  return { success: true };
}

export async function adminTransferOwnership(orgId: string, newOwnerId: string) {
  const session = await requireSiteAdmin();

  const result = await prisma.$transaction(async (tx) => {
    // Find current owner
    const currentOwner = await tx.member.findFirst({
      where: { organizationId: orgId, role: "owner" },
      include: { user: { select: { name: true, email: true } } },
    });

    // Verify new owner is a member
    const newOwner = await tx.member.findFirst({
      where: { organizationId: orgId, userId: newOwnerId },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!newOwner) throw new Error("New owner must be a member of the organization.");

    // Demote current owner
    if (currentOwner) {
      await tx.member.update({
        where: { id: currentOwner.id },
        data: { role: "admin" },
      });
    }

    // Promote new owner
    await tx.member.update({
      where: { id: newOwner.id },
      data: { role: "owner" },
    });

    return { currentOwner, newOwner };
  });

  // Admin ownership transfer (demote + promote). Best-effort mirror after the
  // transaction for both affected members (platform-admin path; nightly reconcile
  // is the backstop §3.3.4).
  if (result.currentOwner) {
    await upsertMemberMirrorByOrgUser(orgId, result.currentOwner.userId);
  }
  await upsertMemberMirrorByOrgUser(orgId, newOwnerId);

  await logActivity({
    organizationId: orgId,
    userId: session.user.id,
    userName: session.user.name,
    action: "UPDATE",
    entityType: "organization",
    entityId: orgId,
    entityName: orgId,
    summary: `Transferred ownership to ${result.newOwner.user.name || result.newOwner.user.email}`,
    details: {
      from: result.currentOwner?.user.name || result.currentOwner?.user.email,
      to: result.newOwner.user.name || result.newOwner.user.email,
    },
  });

  return { success: true };
}

// ─── Org Member Management (Site Admin) ───────────────────────────────────

// Assignable built-in roles (custom roles were removed). Sole rejection of
// arbitrary/elevated role strings in the admin member actions — owner excluded.
const ADMIN_ASSIGNABLE_ROLES = ["admin", "manager", "member", "warehouse", "viewer"];

export async function adminAddMemberToOrg(orgId: string, email: string, role: string) {
  const session = await requireSiteAdmin();

  const user = await prisma.user.findFirst({
    where: { email: email.toLowerCase().trim() },
  });
  if (!user) throw new Error("No account found with that email.");

  const existing = await prisma.member.findFirst({
    where: { organizationId: orgId, userId: user.id },
  });
  if (existing) throw new Error("User is already a member of this organization.");

  if (!ADMIN_ASSIGNABLE_ROLES.includes(role)) {
    throw new Error("Invalid role");
  }

  await prisma.member.create({
    data: { organizationId: orgId, userId: user.id, role },
  });

  // Additive: mirror best-effort after the Prisma commit.
  await upsertMemberMirrorByOrgUser(orgId, user.id);

  await logActivity({
    organizationId: orgId,
    userId: session.user.id,
    userName: session.user.name,
    action: "CREATE",
    entityType: "member",
    entityId: user.id,
    entityName: user.name || user.email,
    summary: `Added ${user.name || user.email} to organization as ${role}`,
    details: { role },
  });

  return { success: true };
}

export async function adminRemoveMemberFromOrg(orgId: string, memberId: string) {
  const session = await requireSiteAdmin();

  const member = await prisma.member.findFirst({
    where: { id: memberId, organizationId: orgId },
    include: { user: { select: { name: true, email: true } } },
  });
  if (!member) throw new Error("Member not found.");
  if (member.role === "owner") throw new Error("Cannot remove the owner. Transfer ownership first.");

  // Restrictive (revocation): remove from the Convex mirror FIRST (strict), then
  // commit the Prisma delete (§3.3.4).
  await removeMemberMirror(
    { organizationId: orgId, userId: member.userId },
    { strict: true },
  );

  await prisma.member.delete({ where: { id: memberId } });

  await logActivity({
    organizationId: orgId,
    userId: session.user.id,
    userName: session.user.name,
    action: "DELETE",
    entityType: "member",
    entityId: memberId,
    entityName: member.user.name || member.user.email,
    summary: `Removed ${member.user.name || member.user.email} from organization`,
  });

  return { success: true };
}

export async function adminChangeMemberRole(orgId: string, memberId: string, newRole: string) {
  const session = await requireSiteAdmin();

  const member = await prisma.member.findFirst({
    where: { id: memberId, organizationId: orgId },
    include: { user: { select: { name: true, email: true } } },
  });
  if (!member) throw new Error("Member not found.");
  if (member.role === "owner") throw new Error("Cannot change the owner's role. Transfer ownership instead.");

  if (!ADMIN_ASSIGNABLE_ROLES.includes(newRole)) {
    throw new Error("Invalid role");
  }

  // Restrictive (a role change may reduce permissions): mirror the NEW role to
  // Convex FIRST (strict), then commit Prisma (§3.3.4). Pass the new role
  // explicitly — reading Prisma here would mirror the stale old role.
  await upsertMemberMirror(
    {
      id: memberId,
      organizationId: orgId,
      userId: member.userId,
      role: newRole,
      createdAt: member.createdAt,
    },
    { strict: true },
  );

  await prisma.member.update({
    where: { id: memberId },
    data: { role: newRole },
  });

  await logActivity({
    organizationId: orgId,
    userId: session.user.id,
    userName: session.user.name,
    action: "UPDATE",
    entityType: "member",
    entityId: memberId,
    entityName: member.user.name || member.user.email,
    summary: `Changed ${member.user.name || member.user.email}'s role to ${newRole}`,
    details: { from: member.role, to: newRole },
  });

  return { success: true };
}

// ─── Platform Invite (Site Admin) ─────────────────────────────────────────

export async function adminInviteUser(email: string) {
  await requireSiteAdmin();

  const normalizedEmail = email.toLowerCase().trim();
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error("Please enter a valid email address.");
  }

  // Check if user already exists
  const existingUser = await prisma.user.findFirst({
    where: { email: normalizedEmail },
  });
  if (existingUser) {
    throw new Error("A user with this email already exists.");
  }

  // Check for existing pending invitation (no org)
  const existingInvite = await prisma.invitation.findFirst({
    where: {
      email: normalizedEmail,
      status: "pending",
      expiresAt: { gte: new Date() },
    },
  });
  if (existingInvite) {
    throw new Error("An invitation has already been sent to this email.");
  }

  // We need an organizationId for the invitation record (Better Auth requires it).
  const anyOrg = await getTheOrg();
  if (!anyOrg) {
    throw new Error("No organization configured. Complete setup first.");
  }

  const session = await requireSession();

  const invitation = await prisma.invitation.create({
    data: {
      organizationId: anyOrg.id,
      email: normalizedEmail,
      role: "member",
      status: "pending",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      inviterId: session.user.id,
    },
  });

  const baseUrl = env.NEXT_PUBLIC_APP_URL;
  const registerUrl = `${baseUrl}/register?invite=${invitation.id}`;
  const pName = await getPlatformName();

  await sendEmail({
    to: normalizedEmail,
    ...siteAdminInvitationEmail({ registerUrl, platformName: pName }),
  });

  await logActivity({
    organizationId: anyOrg.id,
    userId: session.user.id,
    userName: session.user.name,
    action: "CREATE",
    entityType: "invitation",
    entityId: invitation.id,
    entityName: normalizedEmail,
    summary: `Invited ${normalizedEmail} to join`,
  });

  return { success: true, email: normalizedEmail };
}

// ─── Pending Invitations (Site Admin) ─────────────────────────────────────

export async function adminGetPendingInvitations() {
  await requireSiteAdmin();

  const invitations = await prisma.invitation.findMany({
    where: {
      status: "pending",
      expiresAt: { gte: new Date() },
    },
    include: {
      organization: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return serialize(invitations);
}

export async function adminRevokeInvitation(invitationId: string) {
  const session = await requireSiteAdmin();

  const invitation = await prisma.invitation.findUnique({
    where: { id: invitationId },
  });
  if (!invitation || invitation.status !== "pending") {
    throw new Error("Invitation not found or already processed.");
  }

  await prisma.invitation.update({
    where: { id: invitationId },
    data: { status: "cancelled" },
  });

  await logActivity({
    organizationId: invitation.organizationId,
    userId: session.user.id,
    userName: session.user.name,
    action: "DELETE",
    entityType: "invitation",
    entityId: invitationId,
    entityName: invitation.email,
    summary: `Revoked invitation for ${invitation.email}`,
  });

  return { success: true };
}

// ─── Dashboard Stats ───────────────────────────────────────────────────────

export async function getAdminDashboardStats() {
  await requireSiteAdmin();

  const [totalUsers, totalOrgs, recentUsers, recentOrgs, siteAdminCount] = await Promise.all([
    prisma.user.count(),
    prisma.organization.count(),
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, name: true, email: true, createdAt: true },
    }),
    prisma.organization.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, name: true, slug: true, createdAt: true },
    }),
    prisma.user.count({ where: { role: "admin" } }),
  ]);

  return serialize({
    totalUsers,
    totalOrgs,
    siteAdminCount,
    recentUsers,
    recentOrgs,
  });
}
