"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus, Radar } from "lucide-react";
import { updateGroupMappings, updateSSOSettings } from "@/server/sso";
import { useActiveOrganization } from "@/lib/auth-client";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useCustomRoles } from "@/hooks/use-custom-roles";
import { refreshSSOSettings } from "@/hooks/use-sso-settings";
import { toast } from "sonner";
import type { OrgSSOSettings, SSOGroupMapping } from "@/lib/sso-types";

const BUILT_IN_ROLES = [
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "member", label: "Member" },
  { value: "warehouse", label: "Warehouse" },
  { value: "viewer", label: "Viewer" },
];

const ROLE_SYNC_OPTIONS = [
  {
    value: "SYNC_ON_LOGIN",
    label: "Sync on every login",
    description: "Role is updated from IdP groups each time the user signs in.",
  },
  {
    value: "INITIAL_ONLY",
    label: "Initial assignment only",
    description: "Role is set on first SSO login and never changed automatically.",
  },
  {
    value: "MANUAL_ONLY",
    label: "Manual only",
    description: "Group mappings are ignored. Admins assign roles manually.",
  },
] as const;

interface Props {
  mappings: SSOGroupMapping[];
  roleSyncBehavior: OrgSSOSettings["roleSyncBehavior"];
  oidcGroupsClaim: string;
  samlGroupsAttribute: string;
  groupValueType: OrgSSOSettings["groupValueType"];
  canUpdate: boolean;
}

export function SSOGroupMappingSection({
  mappings,
  roleSyncBehavior,
  oidcGroupsClaim,
  samlGroupsAttribute,
  groupValueType,
  canUpdate,
}: Props) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const [localMappings, setLocalMappings] = useState<SSOGroupMapping[]>(mappings);
  const [dirty, setDirty] = useState(false);

  const { data: customRoles } = useCustomRoles(orgId);

  const allRoles = [
    ...BUILT_IN_ROLES,
    ...(customRoles || []).map((r: { id: string; name: string }) => ({
      value: `custom:${r.id}`,
      label: r.name,
      customRoleId: r.id,
    })),
  ];

  const saveMappings = useServerMutation({
    mutationFn: (m: SSOGroupMapping[]) => updateGroupMappings(m),
    onSuccess: () => {
      refreshSSOSettings(orgId);
      toast.success("Group mappings saved");
      setDirty(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateSettings = useServerMutation({
    mutationFn: (updates: Partial<OrgSSOSettings>) => updateSSOSettings(updates),
    onSuccess: () => {
      refreshSSOSettings(orgId);
      toast.success("Settings updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const addMapping = () => {
    setLocalMappings([...localMappings, { idpGroupName: "", gearflowRole: "member" }]);
    setDirty(true);
  };

  const removeMapping = (index: number) => {
    setLocalMappings(localMappings.filter((_, i) => i !== index));
    setDirty(true);
  };

  const updateMapping = (index: number, updates: Partial<SSOGroupMapping>) => {
    const updated = [...localMappings];
    updated[index] = { ...updated[index], ...updates };

    // If selecting a custom role, set the customRoleId
    if (updates.gearflowRole?.startsWith("custom:")) {
      const roleInfo = allRoles.find((r) => r.value === updates.gearflowRole);
      updated[index].customRoleId = (roleInfo as { customRoleId?: string })?.customRoleId;
    } else if (updates.gearflowRole) {
      updated[index].customRoleId = undefined;
    }

    // Clear unmapped flag when a role is assigned
    if (updates.gearflowRole && updates.gearflowRole !== "__unmapped__") {
      updated[index].unmapped = false;
    }

    setLocalMappings(updated);
    setDirty(true);
  };

  return (
    <div className="space-y-6">
      {/* Role Sync Behavior */}
      <div className="space-y-3">
        <Label>Role Sync Behavior</Label>
        {ROLE_SYNC_OPTIONS.map((opt) => (
          <label key={opt.value} className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="roleSyncBehavior"
              value={opt.value}
              checked={roleSyncBehavior === opt.value}
              onChange={() => updateSettings.mutate({ roleSyncBehavior: opt.value })}
              disabled={!canUpdate}
              className="mt-1"
            />
            <div>
              <p className="text-sm font-medium">{opt.label}</p>
              <p className="text-xs text-fg-3">{opt.description}</p>
            </div>
          </label>
        ))}
      </div>

      {/* Claim Configuration */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>OIDC Groups Claim</Label>
          <Input
            value={oidcGroupsClaim}
            onChange={(e) => updateSettings.mutate({ oidcGroupsClaim: e.target.value })}
            placeholder="groups"
            disabled={!canUpdate}
          />
          <p className="text-xs text-fg-3">
            The claim name in the OIDC token that contains group memberships.
          </p>
        </div>
        <div className="space-y-2">
          <Label>SAML Groups Attribute</Label>
          <Input
            value={samlGroupsAttribute}
            onChange={(e) => updateSettings.mutate({ samlGroupsAttribute: e.target.value })}
            placeholder="groups"
            disabled={!canUpdate}
          />
          <p className="text-xs text-fg-3">
            The SAML assertion attribute that contains group memberships.
          </p>
        </div>
      </div>

      {/* Group Value Type */}
      <div className="space-y-2">
        <Label>Match Groups By</Label>
        <Select
          value={groupValueType}
          onValueChange={(v) => updateSettings.mutate({ groupValueType: v as "name" | "id" })}
          disabled={!canUpdate}
        >
          <SelectTrigger className="w-48">
            <SelectValue>{{ name: "Group Name", id: "Group ID" }[groupValueType] ?? groupValueType}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Group Name</SelectItem>
            <SelectItem value="id">Group ID</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Mapping Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Group Mappings</Label>
          {canUpdate && (
            <Button variant="outline" size="sm" onClick={addMapping}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add Mapping
            </Button>
          )}
        </div>

        {localMappings.length === 0 ? (
          <p className="text-sm text-fg-3 py-4 text-center border rounded-md">
            No group mappings configured. Groups will be auto-discovered when users sign in via SSO.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-medium text-fg-3 px-1">
              <span>IdP Group {groupValueType === "id" ? "ID" : "Name"}</span>
              <span>GearFlow Role</span>
              <span className="w-8" />
            </div>
            {localMappings.map((mapping, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                <div className="flex items-center gap-1.5">
                  {mapping.unmapped && (
                    <Radar className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  )}
                  <Input
                    value={groupValueType === "id" ? (mapping.idpGroupId || "") : mapping.idpGroupName}
                    onChange={(e) =>
                      updateMapping(i, groupValueType === "id"
                        ? { idpGroupId: e.target.value }
                        : { idpGroupName: e.target.value })
                    }
                    placeholder={groupValueType === "id" ? "group-id-123" : "Engineering"}
                    disabled={!canUpdate}
                  />
                </div>
                <Select
                  value={mapping.customRoleId ? `custom:${mapping.customRoleId}` : (mapping.gearflowRole || "__unmapped__")}
                  onValueChange={(v) => {
                    if (v && v !== "__unmapped__") {
                      updateMapping(i, { gearflowRole: v, unmapped: false });
                    }
                  }}
                  disabled={!canUpdate}
                >
                  <SelectTrigger className={mapping.unmapped ? "border-amber-500/50 text-amber-600" : ""}>
                    <SelectValue>
                      {mapping.unmapped || !mapping.gearflowRole ? "Not mapped" : undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unmapped__" disabled>
                      Not mapped
                    </SelectItem>
                    {allRoles.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {canUpdate && (
                  <Button variant="ghost" size="sm" onClick={() => removeMapping(i)}>
                    <Trash2 className="h-3.5 w-3.5 text-fg-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {dirty && canUpdate && (
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLocalMappings(mappings);
                setDirty(false);
              }}
            >
              Discard
            </Button>
            <Button
              size="sm"
              onClick={() => saveMappings.mutate(localMappings)}
              disabled={saveMappings.isPending}
            >
              {saveMappings.isPending ? "Saving..." : "Save Mappings"}
            </Button>
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="space-y-1.5">
        {localMappings.some((m) => m.unmapped) && (
          <p className="text-xs text-fg-3 flex items-center gap-1.5">
            <Radar className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            Groups with a <span className="text-amber-600 font-medium">radar icon</span> were auto-discovered from IdP logins.
            Assign a role and save to activate them.
          </p>
        )}
        {customRoles && customRoles.length > 0 && (
          <p className="text-xs text-fg-3">
            Custom roles with an SSO Group Claim configured in Team Settings will be matched automatically,
            in addition to the mappings above.
          </p>
        )}
      </div>
    </div>
  );
}
