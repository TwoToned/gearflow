import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { prisma } from "@/lib/prisma";
import { rolePermissions, type PermissionMap } from "@/lib/permissions";
import { getTheOrg } from "@/lib/single-org";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ role: null, roleName: null, permissions: null, memberId: null });
    }

    const org = await getTheOrg();
    const orgId = org?.id;
    if (!orgId) {
      return NextResponse.json({ role: null, roleName: null, permissions: null, memberId: null });
    }

    const member = await prisma.member.findFirst({
      where: { organizationId: orgId, userId: session.user.id },
      select: { id: true, role: true },
    });

    if (!member) {
      return NextResponse.json({ role: null, roleName: null, permissions: null, memberId: null });
    }

    // Built-in roles only (custom roles were removed).
    const permissions: PermissionMap | null = rolePermissions[member.role] ?? null;

    return NextResponse.json({
      role: member.role,
      roleName: member.role,
      permissions,
      // Opaque org-membership cuid for PostHog `identify()` (POLICY.md R-8.9.4) —
      // deliberately the Member row id, not the raw Better Auth user id, so a
      // person's identity is scoped per-org-membership like the rest of RBAC.
      memberId: member.id,
    });
  } catch {
    return NextResponse.json({ role: null, roleName: null, permissions: null });
  }
}
