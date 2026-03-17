import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { prisma } from "@/lib/prisma";
import { rolePermissions, type PermissionMap } from "@/lib/permissions";
import { getTheOrg } from "@/lib/single-org";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ role: null, roleName: null, permissions: null });
    }

    const org = await getTheOrg();
    const orgId = org?.id;
    if (!orgId) {
      return NextResponse.json({ role: null, roleName: null, permissions: null });
    }

    const member = await prisma.member.findFirst({
      where: { organizationId: orgId, userId: session.user.id },
      select: { role: true },
    });

    if (!member) {
      return NextResponse.json({ role: null, roleName: null, permissions: null });
    }

    let permissions: PermissionMap | null = null;
    let roleName = member.role;

    if (member.role.startsWith("custom:")) {
      const customRoleId = member.role.slice("custom:".length);
      const customRole = await prisma.customRole.findUnique({
        where: { id: customRoleId },
        select: { name: true, permissions: true },
      });
      if (customRole) {
        roleName = customRole.name;
        try {
          permissions = JSON.parse(customRole.permissions) as PermissionMap;
        } catch {
          permissions = null;
        }
      }
    } else {
      permissions = rolePermissions[member.role] ?? null;
    }

    return NextResponse.json({
      role: member.role,
      roleName,
      permissions,
    });
  } catch {
    return NextResponse.json({ role: null, roleName: null, permissions: null });
  }
}
