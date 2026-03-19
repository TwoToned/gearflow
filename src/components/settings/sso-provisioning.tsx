"use client";

import { useQuery } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getCustomRoles } from "@/server/custom-roles";
import type { OrgSSOSettings } from "@/lib/sso-types";

const PROVISIONING_MODES = [
  {
    value: "AUTO_CREATE",
    label: "Auto-create",
    description: "Users are created and added automatically on first SSO login.",
  },
  {
    value: "REQUIRE_APPROVAL",
    label: "Require approval",
    description: "Users are created but require admin approval before accessing the org.",
  },
  {
    value: "EXISTING_ONLY",
    label: "Existing users only",
    description: "Only existing org members can sign in via SSO. No new accounts are created.",
  },
] as const;

const BUILT_IN_ROLES = [
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "member", label: "Member" },
  { value: "viewer", label: "Viewer" },
];

interface Props {
  provisioningMode: OrgSSOSettings["provisioningMode"];
  defaultRole: string;
  canUpdate: boolean;
  onUpdate: (updates: Partial<OrgSSOSettings>) => void;
}

export function SSOProvisioningSection({ provisioningMode, defaultRole, canUpdate, onUpdate }: Props) {
  const { data: customRoles } = useQuery({
    queryKey: ["custom-roles"],
    queryFn: () => getCustomRoles(),
  });

  const allRoles = [
    ...BUILT_IN_ROLES,
    ...(customRoles || []).map((r: { id: string; name: string }) => ({
      value: `custom:${r.id}`,
      label: r.name,
    })),
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <Label>Provisioning Mode</Label>
        {PROVISIONING_MODES.map((mode) => (
          <label key={mode.value} className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="provisioningMode"
              value={mode.value}
              checked={provisioningMode === mode.value}
              onChange={() => onUpdate({ provisioningMode: mode.value })}
              disabled={!canUpdate}
              className="mt-1"
            />
            <div>
              <p className="text-sm font-medium">{mode.label}</p>
              <p className="text-xs text-fg-3">{mode.description}</p>
            </div>
          </label>
        ))}
      </div>

      <div className="space-y-2">
        <Label>Default Role for SSO Users</Label>
        <p className="text-xs text-fg-3">
          Role assigned when no group mapping matches.
        </p>
        <Select
          value={defaultRole}
          onValueChange={(value) => { if (value) onUpdate({ defaultRole: value }); }}
          disabled={!canUpdate}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {allRoles.map((role) => (
              <SelectItem key={role.value} value={role.value}>
                {role.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
