"use client";
// use-client: live Convex data via client subscription (useQuery) (R-8.1.1)

import { use } from "react";
import Link from "next/link";
import { useServerQuery } from "@/hooks/use-server-query";
import { useActiveOrganization } from "@/lib/auth-client";
import { useConvex, useConvexAuth } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import { CrewMemberForm } from "@/components/crew/crew-member-form";
import { RequirePermission } from "@/components/auth/require-permission";
import { FadeIn } from "@/components/ui/motion";
import { FormSkeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export default function EditCrewMemberPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <RequirePermission resource="crew" action="update">
      <EditCrewMemberContent params={params} />
    </RequirePermission>
  );
}

function EditCrewMemberContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();

  const { data: member, isLoading } = useServerQuery({
    queryKey: ["crew-member", orgId, id, isAuthenticated],
    queryFn: () => convex.query(api.crew.memberDetail, { id, orgId: orgId! }),
    enabled: !!orgId && isAuthenticated,
  });

  if (isLoading) return <FadeIn><div className="mx-auto max-w-5xl"><FormSkeleton /></div></FadeIn>;
  if (!member) {
    return (
      <div className="mx-auto max-w-5xl rounded-[var(--r-lg)] border-l-2 border-l-t-out border border-line bg-card p-6 text-center">
        <p className="text-ui-text text-ink-2">Crew member not found.</p>
        <p className="mt-1 text-caption text-muted">It may have been deleted, or you don&apos;t have access to it.</p>
      </div>
    );
  }

  const memberName = `${member.firstName} ${member.lastName}`;

  return (
    <FadeIn>
      <div className="mx-auto max-w-5xl space-y-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/crew" />}>Crew</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href={`/crew/${id}`} />}>{memberName}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Edit</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <PageHeader title="Edit crew member" description="Update crew member details." />
        <CrewMemberForm initialData={{
          id,
          firstName: member.firstName,
          lastName: member.lastName,
          email: member.email || "",
          phone: member.phone || "",
          type: member.type,
          status: member.status,
          department: member.department || "",
          crewRoleId: member.crewRoleId || "",
          defaultDayRate: member.defaultDayRate != null ? String(member.defaultDayRate) : "",
          defaultHourlyRate: member.defaultHourlyRate != null ? String(member.defaultHourlyRate) : "",
          overtimeMultiplier: member.overtimeMultiplier != null ? String(member.overtimeMultiplier) : "",
          currency: member.currency || "",
          address: member.address || "",
          addressLatitude: member.addressLatitude ?? null,
          addressLongitude: member.addressLongitude ?? null,
          emergencyContactName: member.emergencyContactName || "",
          emergencyContactPhone: member.emergencyContactPhone || "",
          dateOfBirth: member.dateOfBirth ? new Date(member.dateOfBirth).toISOString().split("T")[0] : "",
          abnOrGst: member.abnOrGst || "",
          notes: member.notes || "",
          tags: member.tags || [],
          userId: member.userId || "",
          isActive: member.isActive,
        }} />
      </div>
    </FadeIn>
  );
}
