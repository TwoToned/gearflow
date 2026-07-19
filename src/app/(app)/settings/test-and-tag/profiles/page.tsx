"use client";
// use-client: interactive — React state/effects (client-only) (R-8.1.1)

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Copy,
  Pencil,
  Trash2,
  Loader2,
  Shield,
  Zap,
} from "lucide-react";

import { useTestProfileWrites } from "@/hooks/use-test-profile-writes";
import { useTestProfiles } from "@/hooks/use-test-profiles";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useCanDo } from "@/lib/use-permissions";
import { useActiveOrganization } from "@/lib/auth-client";
import { FadeIn } from "@/components/ui/motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MobileCardList, type ColumnDef } from "@/components/ui/data-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SEED_PROFILES, type VisualCheck, type ElectricalTest, type ProfileThresholds } from "@/lib/test-profiles/seed-data";

const EQUIPMENT_CLASS_LABELS: Record<string, string> = {
  CLASS_I: "Class I",
  CLASS_II: "Class II",
  CLASS_II_DOUBLE_INSULATED: "Class II (DI)",
  LEAD_CORD_ASSEMBLY: "Lead/Cord",
};

const APPLIANCE_TYPE_LABELS: Record<string, string> = {
  APPLIANCE: "Appliance",
  CORD_SET: "Cord Set",
  EXTENSION_LEAD: "Extension Lead",
  POWER_BOARD: "Power Board",
  RCD_PORTABLE: "RCD Portable",
  RCD_FIXED: "RCD Fixed",
  THREE_PHASE: "Three-Phase",
  MICROWAVE: "Microwave",
  OTHER: "Other",
};

type Profile = {
  id: string;
  name: string;
  equipmentClass: string;
  applianceType: string;
  visualChecks: VisualCheck[];
  electricalTests: ElectricalTest[];
  thresholds: ProfileThresholds;
  requiresSubTests: boolean;
  defaultSubTestCount: number;
  subTestLabel: string;
  isDefault: boolean;
  isActive: boolean;
};

export default function TestProfilesPage() {
  const canEdit = useCanDo("testTag", "create");
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Reactive test-profile list straight from Convex (auto-updates on any
  // create/update/duplicate/seed/delete). The Convex list returns ALL profiles
  // including inactive, so re-apply the active filter (matches the old
  // getTestProfiles default) and sort by name client-side.
  const allProfiles = useTestProfiles(orgId);
  const isLoading = allProfiles === undefined;
  const writes = useTestProfileWrites();

  // No invalidation: every testProfiles reader (this page, model-form,
  // test-and-tag/new) subscribes to Convex, so the browser-direct write's
  // Convex mutation pushes the update live.
  const seedMutation = useServerMutation({
    mutationFn: writes.seedDefaultProfiles,
    onSuccess: (data) => {
      toast.success(`Created ${(data as { created: number }).created} default profiles`);
    },
    onError: (e) => toast.error(e.message),
  });

  const duplicateMutation = useServerMutation({
    mutationFn: writes.duplicateProfile,
    onSuccess: () => {
      toast.success("Profile duplicated");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = useServerMutation({
    mutationFn: writes.deleteProfile,
    onSuccess: () => {
      toast.success("Profile deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  const profileList = useMemo(() => {
    const source = (allProfiles ?? []) as unknown as Profile[];
    return source
      .filter((p) => p.isActive !== false)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [allProfiles]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-fg-3" />
      </div>
    );
  }

  // Empty state
  if (profileList.length === 0 && !isCreating && !editingProfile) {
    return (
      <FadeIn>
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="flex items-center justify-center w-11 h-11 rounded-lg bg-teal-500/10">
            <Shield className="h-5 w-5 text-teal-500" />
          </div>
          <h2 className="text-lg font-semibold text-fg-1">No test profiles configured</h2>
          <p className="text-sm text-fg-3 text-center max-w-md">
            Test profiles define which visual checks and electrical tests are required for each equipment type.
            Seed the standard AS/NZS 3760 defaults to get started.
          </p>
          <div className="flex gap-2 mt-2">
            <Button
              onClick={() => seedMutation.mutate()}
              disabled={seedMutation.isPending}
            >
              {seedMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Zap className="mr-2 h-4 w-4" />
              Seed AS/NZS 3760 Defaults
            </Button>
            {canEdit && (
              <Button variant="line" onClick={() => setIsCreating(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create Custom
              </Button>
            )}
          </div>
        </div>
      </FadeIn>
    );
  }

  // Mobile card layout for the profiles table (rendered below `md`). Cells reuse
  // the exact desktop <TableCell> content and must stay pure (both breakpoints mount).
  const cols: ColumnDef<Profile>[] = [
    {
      id: "name",
      header: "Name",
      mobile: "title",
      cell: (profile) => <div className="font-medium text-fg-1">{profile.name}</div>,
    },
    {
      id: "class",
      header: "Class",
      mobile: "meta",
      cell: (profile) => (
        <span className="text-fg-2">
          {EQUIPMENT_CLASS_LABELS[profile.equipmentClass] || profile.equipmentClass}
        </span>
      ),
    },
    {
      id: "type",
      header: "Type",
      mobile: "meta",
      cell: (profile) => (
        <span className="text-fg-2">
          {APPLIANCE_TYPE_LABELS[profile.applianceType] || profile.applianceType}
        </span>
      ),
    },
    {
      id: "tests",
      header: "Tests",
      mobile: "meta",
      cell: (profile) => {
        const enabledTests = (profile.electricalTests || []).filter((t: ElectricalTest) => t.enabled);
        return <span className="text-sm text-fg-3">{enabledTests.length} electrical</span>;
      },
    },
    {
      id: "subtests",
      header: "Sub-Tests",
      mobile: "meta",
      cell: (profile) =>
        profile.requiresSubTests ? (
          <span className="text-sm text-fg-2">
            {profile.defaultSubTestCount} {profile.subTestLabel.toLowerCase()}s
          </span>
        ) : (
          <span className="text-sm text-fg-3">—</span>
        ),
    },
    {
      id: "status",
      header: "Status",
      mobile: "badge",
      cell: (profile) =>
        profile.isActive ? (
          <Badge status="neutral" className="text-teal-600 border-teal-200 bg-teal-50">Active</Badge>
        ) : (
          <Badge status="neutral" className="text-fg-3">Inactive</Badge>
        ),
    },
    {
      id: "actions",
      header: "Actions",
      mobile: "actions",
      cell: (profile) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={(e) => e.stopPropagation()}>
              <span className="sr-only">Actions</span>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" /></svg>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setEditingProfile(profile); }}>
                <Pencil className="mr-2 h-4 w-4" />Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); duplicateMutation.mutate(profile.id); }}>
                <Copy className="mr-2 h-4 w-4" />Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(profile.id); }}
              >
                <Trash2 className="mr-2 h-4 w-4" />Delete
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <FadeIn>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-fg-1">Test Profiles</h2>
            <p className="text-sm text-fg-3">
              Configure which tests are required for each equipment type per AS/NZS 3760.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="line" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending} size="sm">
              {seedMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
              Seed Defaults
            </Button>
            {canEdit && (
              <Button onClick={() => setIsCreating(true)} size="sm">
                <Plus className="mr-2 h-4 w-4" />
                New Profile
              </Button>
            )}
          </div>
        </div>

        <div className="hidden md:block border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="uppercase text-xs tracking-wider">Name</TableHead>
                <TableHead className="uppercase text-xs tracking-wider">Class</TableHead>
                <TableHead className="uppercase text-xs tracking-wider">Type</TableHead>
                <TableHead className="uppercase text-xs tracking-wider">Tests</TableHead>
                <TableHead className="uppercase text-xs tracking-wider">Sub-Tests</TableHead>
                <TableHead className="uppercase text-xs tracking-wider">Status</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profileList.map((profile) => {
                const enabledTests = (profile.electricalTests || []).filter((t: ElectricalTest) => t.enabled);
                return (
                  <TableRow key={profile.id} className="group relative hover:bg-surface-hover cursor-pointer" onClick={() => setEditingProfile(profile)}>
                    <TableCell>
                      <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-teal-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                      <div className="font-medium text-fg-1">{profile.name}</div>
                    </TableCell>
                    <TableCell className="text-fg-2">
                      {EQUIPMENT_CLASS_LABELS[profile.equipmentClass] || profile.equipmentClass}
                    </TableCell>
                    <TableCell className="text-fg-2">
                      {APPLIANCE_TYPE_LABELS[profile.applianceType] || profile.applianceType}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-fg-3">{enabledTests.length} electrical</span>
                    </TableCell>
                    <TableCell>
                      {profile.requiresSubTests ? (
                        <span className="text-sm text-fg-2">
                          {profile.defaultSubTestCount} {profile.subTestLabel.toLowerCase()}s
                        </span>
                      ) : (
                        <span className="text-sm text-fg-3">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {profile.isActive ? (
                        <Badge status="neutral" className="text-teal-600 border-teal-200 bg-teal-50">Active</Badge>
                      ) : (
                        <Badge status="neutral" className="text-fg-3">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={(e) => e.stopPropagation()}>
                            <span className="sr-only">Actions</span>
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" /></svg>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuGroup>
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setEditingProfile(profile); }}>
                              <Pencil className="mr-2 h-4 w-4" />Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); duplicateMutation.mutate(profile.id); }}>
                              <Copy className="mr-2 h-4 w-4" />Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(profile.id); }}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />Delete
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {/* Mobile: the empty/loading states are early-returned above, so this
            branch only renders when there are profiles to show. */}
        {profileList.length > 0 && (
          <MobileCardList
            className="md:hidden"
            data={profileList}
            columns={cols}
            getRowId={(p) => p.id}
            onRowClick={(profile) => setEditingProfile(profile)}
          />
        )}
      </div>

      {/* Edit / Create Dialog */}
      {(editingProfile || isCreating) && (
        <ProfileEditDialog
          profile={editingProfile}
          onClose={() => { setEditingProfile(null); setIsCreating(false); }}
        />
      )}
    </FadeIn>
  );
}

// ─── Profile Edit Dialog ──────────────────────────────────────────────────────

function ProfileEditDialog({
  profile,
  onClose,
}: {
  profile: Profile | null;
  onClose: () => void;
}) {
  const isNew = !profile;

  // Initialize from profile or seed template
  const [name, setName] = useState(profile?.name || "");
  const [equipmentClass, setEquipmentClass] = useState(profile?.equipmentClass || "CLASS_I");
  const [applianceType, setApplianceType] = useState(profile?.applianceType || "APPLIANCE");
  const [visualChecks, setVisualChecks] = useState<VisualCheck[]>(
    profile?.visualChecks || SEED_PROFILES[0].visualChecks
  );
  const [electricalTests, setElectricalTests] = useState<ElectricalTest[]>(
    profile?.electricalTests || SEED_PROFILES[0].electricalTests
  );
  const [thresholds, setThresholds] = useState<ProfileThresholds>(
    profile?.thresholds || SEED_PROFILES[0].thresholds
  );
  const [requiresSubTests, setRequiresSubTests] = useState(profile?.requiresSubTests || false);
  const [defaultSubTestCount, setDefaultSubTestCount] = useState(profile?.defaultSubTestCount || 1);
  const [subTestLabel, setSubTestLabel] = useState(profile?.subTestLabel || "Outlet");
  const [isActive, setIsActive] = useState(profile?.isActive ?? true);

  const writes = useTestProfileWrites();
  const createMutation = useServerMutation({
    mutationFn: writes.createProfile,
    onSuccess: () => {
      toast.success("Profile created");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = useServerMutation({
    mutationFn: (data: Parameters<typeof writes.updateProfile>[1]) =>
      writes.updateProfile(profile!.id, data),
    onSuccess: () => {
      toast.success("Profile updated");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSave = () => {
    const data = {
      name,
      equipmentClass,
      applianceType,
      visualChecks,
      electricalTests,
      thresholds,
      requiresSubTests,
      defaultSubTestCount,
      subTestLabel,
      isActive,
    };

    if (isNew) {
      createMutation.mutate(data);
    } else {
      updateMutation.mutate(data);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  const toggleVisualCheck = (key: string) => {
    setVisualChecks(prev =>
      prev.map(c => c.key === key ? { ...c, enabled: !c.enabled } : c)
    );
  };

  const toggleElectricalTest = (key: string) => {
    setElectricalTests(prev =>
      prev.map(t => t.key === key ? { ...t, enabled: !t.enabled } : t)
    );
  };

  const updateThreshold = (key: keyof ProfileThresholds, value: string) => {
    const num = parseFloat(value);
    setThresholds(prev => ({
      ...prev,
      [key]: isNaN(num) ? undefined : num,
    }));
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? "New Test Profile" : `Edit: ${profile?.name}`}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Basic info */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="profile-name">Profile Name</Label>
              <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Class I Appliance" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Equipment Class</Label>
                <Select value={equipmentClass} onValueChange={(v) => { if (v) setEquipmentClass(v); }}>
                  <SelectTrigger>
                    <SelectValue>{EQUIPMENT_CLASS_LABELS[equipmentClass] || equipmentClass}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(EQUIPMENT_CLASS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Appliance Type</Label>
                <Select value={applianceType} onValueChange={(v) => { if (v) setApplianceType(v); }}>
                  <SelectTrigger>
                    <SelectValue>{APPLIANCE_TYPE_LABELS[applianceType] || applianceType}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(APPLIANCE_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Visual Checks */}
          <div className="space-y-3">
            <Label className="text-base font-medium">Visual Inspection Checks</Label>
            <div className="grid grid-cols-1 gap-2">
              {visualChecks.map((check) => (
                <label key={check.key} className="flex items-center gap-3 p-2 rounded-md hover:bg-surface-hover cursor-pointer min-h-[44px]">
                  <Checkbox
                    checked={check.enabled}
                    onCheckedChange={() => toggleVisualCheck(check.key)}
                  />
                  <span className="text-sm text-fg-2">{check.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Electrical Tests */}
          <div className="space-y-3">
            <Label className="text-base font-medium">Electrical Tests</Label>
            <div className="space-y-2">
              {electricalTests.map((test) => (
                <div key={test.key} className="flex items-center gap-3 p-2 rounded-md hover:bg-surface-hover min-h-[44px]">
                  <Checkbox
                    checked={test.enabled}
                    onCheckedChange={() => toggleElectricalTest(test.key)}
                  />
                  <span className="text-sm text-fg-2 flex-1">{test.label}</span>
                  {test.threshold !== null && test.enabled && (
                    <span className="text-xs text-fg-3">
                      {test.operator === "lt" && "<"}{test.operator === "lte" && "≤"}{test.operator === "gt" && ">"}{test.operator === "gte" && "≥"}{" "}
                      {test.threshold} {test.unit}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Thresholds */}
          <div className="space-y-3">
            <Label className="text-base font-medium">Pass/Fail Thresholds</Label>
            <div className="grid grid-cols-2 gap-4">
              {electricalTests.some(t => t.key === "earthContinuity" && t.enabled) && (
                <div className="space-y-1">
                  <Label className="text-xs text-fg-3">Earth Continuity Max (Ω)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={thresholds.earthMax ?? ""}
                    onChange={(e) => updateThreshold("earthMax", e.target.value)}
                    inputMode="decimal"
                  />
                </div>
              )}
              {electricalTests.some(t => t.key === "insulationResistance" && t.enabled) && (
                <div className="space-y-1">
                  <Label className="text-xs text-fg-3">Insulation Min (MΩ)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={thresholds.insulationMin ?? ""}
                    onChange={(e) => updateThreshold("insulationMin", e.target.value)}
                    inputMode="decimal"
                  />
                </div>
              )}
              {electricalTests.some(t => t.key === "leakageCurrent" && t.enabled) && (
                <div className="space-y-1">
                  <Label className="text-xs text-fg-3">Leakage Max (mA)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={thresholds.leakageMax ?? ""}
                    onChange={(e) => updateThreshold("leakageMax", e.target.value)}
                    inputMode="decimal"
                  />
                </div>
              )}
              {electricalTests.some(t => t.key === "rcdTripTime" && t.enabled) && (
                <div className="space-y-1">
                  <Label className="text-xs text-fg-3">RCD Trip Time Max (ms)</Label>
                  <Input
                    type="number"
                    step="1"
                    value={thresholds.rcdTripTimeMax ?? ""}
                    onChange={(e) => updateThreshold("rcdTripTimeMax", e.target.value)}
                    inputMode="numeric"
                  />
                </div>
              )}
              {electricalTests.some(t => t.key === "microwaveLeakage" && t.enabled) && (
                <div className="space-y-1">
                  <Label className="text-xs text-fg-3">Microwave Leakage Max (mW/cm²)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={thresholds.microwaveLeakageMax ?? ""}
                    onChange={(e) => updateThreshold("microwaveLeakageMax", e.target.value)}
                    inputMode="decimal"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Sub-tests */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-base font-medium">Sub-Tests</Label>
              <Switch checked={requiresSubTests} onCheckedChange={setRequiresSubTests} />
            </div>
            {requiresSubTests && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs text-fg-3">Default Count</Label>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={defaultSubTestCount}
                    onChange={(e) => setDefaultSubTestCount(parseInt(e.target.value) || 1)}
                    inputMode="numeric"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-fg-3">Label</Label>
                  <Select value={subTestLabel} onValueChange={(v) => { if (v) setSubTestLabel(v); }}>
                    <SelectTrigger>
                      <SelectValue>{subTestLabel}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Outlet">Outlet</SelectItem>
                      <SelectItem value="Phase">Phase</SelectItem>
                      <SelectItem value="Port">Port</SelectItem>
                      <SelectItem value="Channel">Channel</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>

          {/* Active toggle */}
          {!isNew && (
            <div className="flex items-center justify-between py-2 border-t">
              <div>
                <Label className="text-base font-medium">Active</Label>
                <p className="text-xs text-fg-3">Inactive profiles won&apos;t be available for new tests</p>
              </div>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="line" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={isPending || !name.trim()}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isNew ? "Create Profile" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
