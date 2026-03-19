"use client";

import { use } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useActiveOrganization } from "@/lib/auth-client";
import { getCrewMemberById } from "@/server/crew";
import { CrewMemberForm } from "@/components/crew/crew-member-form";
import { FadeIn } from "@/components/ui/motion";

export default function EditCrewMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: member, isLoading } = useQuery({
    queryKey: ["crew-member", orgId, id],
    queryFn: () => getCrewMemberById(id),
  });

  if (isLoading) return <div className="text-fg-3">Loading...</div>;
  if (!member) return <div className="text-fg-3">Crew member not found.</div>;

  const memberName = `${member.firstName} ${member.lastName}`;

  return (
    <FadeIn>
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center gap-2 text-sm text-fg-3 mb-4">
          <Link href="/crew" className="hover:text-fg transition-colors">Crew</Link>
          <ChevronRight className="h-3 w-3" />
          <Link href={`/crew/${id}`} className="hover:text-fg transition-colors">{memberName}</Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-fg">Edit</span>
        </div>
        <div>
          <h1 className="t-title text-fg">Edit Crew Member</h1>
          <p className="text-[13px] text-fg-3">
            Update crew member details.
          </p>
        </div>
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
          skillIds: member.skills?.map((s: { id: string }) => s.id) || [],
          userId: member.userId || "",
          isActive: member.isActive,
        }} />
      </div>
    </FadeIn>
  );
}
