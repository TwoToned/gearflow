"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormSection } from "@/components/layout/page-layouts";
import {
  updateOrganization,
  type OrgSettings,
} from "@/server/settings";
import { useCategoriesWithParent } from "@/hooks/use-categories";
import { useCanDo } from "@/lib/use-permissions";
import { useActiveOrganization } from "@/lib/auth-client";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useOrganization, refreshOrganization } from "@/hooks/use-organization";
import { FadeIn } from "@/components/ui/motion";

export default function AssetsSettingsPage() {
  const canEdit = useCanDo("orgSettings", "update");
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: org } = useOrganization(orgId);

  const [name, setName] = useState("");
  const [settings, setSettings] = useState<OrgSettings>({});

  useEffect(() => {
    if (org) {
      setName((org as Record<string, unknown>).name as string || ""); // eslint-disable-line react-hooks/set-state-in-effect
      setSettings((org as Record<string, unknown>).settings as OrgSettings || {}); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [org]);

  // Reactive categories (Convex) with synthetic parent name, sorted to match the
  // old getCategories() order.
  const allCategories = useCategoriesWithParent(orgId) ?? [];

  const updateMutation = useServerMutation({
    mutationFn: () => updateOrganization({ name, settings }),
    onSuccess: () => {
      refreshOrganization(orgId);
      toast.success("Settings saved");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateSetting = (key: keyof OrgSettings, value: string | number | null) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <FadeIn>
    <div className="space-y-6">
      <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
        <div className="space-y-6">
          <FormSection title="Asset Tags" description="Configure auto-incrementing asset tag format.">
            <div className="space-y-2">
              <Label htmlFor="assetTagPrefix">Prefix</Label>
              <Input
                id="assetTagPrefix"
                value={settings.assetTagPrefix || ""}
                onChange={(e) => updateSetting("assetTagPrefix", e.target.value)}
                placeholder="e.g. GF-"
                disabled={!canEdit}
              />
              <p className="text-xs text-fg-3">
                Include any separator (e.g. &quot;GF-&quot; or &quot;GF&quot;)
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="assetTagDigits">Number of Digits</Label>
              <Input
                id="assetTagDigits"
                type="number"
                min={1}
                max={10}
                value={settings.assetTagDigits ?? 4}
                onChange={(e) => updateSetting("assetTagDigits", parseInt(e.target.value) || 4)}
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="assetTagCounter">Current Counter</Label>
              <Input
                id="assetTagCounter"
                type="number"
                value={settings.assetTagCounter ?? 0}
                onChange={(e) => updateSetting("assetTagCounter", parseInt(e.target.value) || 0)}
                disabled={!canEdit}
              />
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs text-fg-3">
                Next tag: <span className="font-mono font-medium">{(settings.assetTagPrefix || "")}{String((settings.assetTagCounter ?? 0) + 1).padStart(settings.assetTagDigits ?? 4, "0")}</span>
              </p>
            </div>
          </FormSection>

          <FormSection title="Prep Containers" description="Select which category contains your cases and containers. Assets in this category can be selected as prep containers in the warehouse.">
            <div className="space-y-2">
              <Label htmlFor="prepKitCategory">Case Category</Label>
              <Select
                value={settings.prepKitCategoryId || "none"}
                onValueChange={(value) => updateSetting("prepKitCategoryId", value === "none" ? "" : value)}
                disabled={!canEdit}
              >
                <SelectTrigger id="prepKitCategory" className="w-full sm:w-64">
                  <SelectValue>
                    {settings.prepKitCategoryId
                      ? allCategories.find((c) => c.id === settings.prepKitCategoryId)?.name || "Select category"
                      : "None (custom names only)"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (custom names only)</SelectItem>
                  {allCategories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.parent ? `${cat.parent.name} / ${cat.name}` : cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </FormSection>
        </div>

        {canEdit && (
          <div className="mt-6 flex justify-end border-t border-border pt-4">
            <Button
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        )}
      </div>

      {canEdit && (
        <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <div className="space-y-6">
            <FormSection title="Categories" description="Organize your equipment into categories and subcategories.">
              <div>
                <Button variant="outline" render={<Link href="/assets/categories" />}>
                  Manage Categories
                </Button>
              </div>
            </FormSection>

            <FormSection title="Suppliers" description="Track your equipment suppliers, vendor contacts, and procurement partners.">
              <div>
                <Button variant="outline" render={<Link href="/suppliers" />}>
                  Manage Suppliers
                </Button>
              </div>
            </FormSection>

            <FormSection title="Locations" description="Manage warehouses, venues, and storage locations.">
              <div>
                <Button variant="outline" render={<Link href="/locations" />}>
                  Manage Locations
                </Button>
              </div>
            </FormSection>
          </div>
        </div>
      )}
    </div>
    </FadeIn>
  );
}
