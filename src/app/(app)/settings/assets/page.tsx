"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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
import {
  getOrganization,
  updateOrganization,
  type OrgSettings,
} from "@/server/settings";
import { getCategories } from "@/server/categories";
import { useCanDo } from "@/lib/use-permissions";
import { useActiveOrganization } from "@/lib/auth-client";

export default function AssetsSettingsPage() {
  const queryClient = useQueryClient();
  const canEdit = useCanDo("orgSettings", "update");
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: org } = useQuery({
    queryKey: ["organization", orgId],
    queryFn: getOrganization,
  });

  const [name, setName] = useState("");
  const [settings, setSettings] = useState<OrgSettings>({});

  useEffect(() => {
    if (org) {
      setName((org as Record<string, unknown>).name as string || ""); // eslint-disable-line react-hooks/set-state-in-effect
      setSettings((org as Record<string, unknown>).settings as OrgSettings || {}); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [org]);

  const { data: categories } = useQuery({
    queryKey: ["categories", orgId],
    queryFn: getCategories,
  });

  const allCategories = (categories || []) as Array<{
    id: string;
    name: string;
    parentId: string | null;
    parent: { name: string } | null;
  }>;

  const updateMutation = useMutation({
    mutationFn: () => updateOrganization({ name, settings }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization", orgId] });
      toast.success("Settings saved");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateSetting = (key: keyof OrgSettings, value: string | number | null) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Asset Tags</CardTitle>
          <CardDescription>
            Configure auto-incrementing asset tag format.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="assetTagPrefix">Prefix</Label>
              <Input
                id="assetTagPrefix"
                value={settings.assetTagPrefix || ""}
                onChange={(e) => updateSetting("assetTagPrefix", e.target.value)}
                placeholder="e.g. GF-"
                disabled={!canEdit}
              />
              <p className="text-xs text-muted-foreground">
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
          </div>
          <p className="text-xs text-muted-foreground">
            Next tag: <span className="font-mono font-medium">{(settings.assetTagPrefix || "")}{String((settings.assetTagCounter ?? 0) + 1).padStart(settings.assetTagDigits ?? 4, "0")}</span>
          </p>
          {canEdit && (
            <div className="flex justify-end">
              <Button
                onClick={() => updateMutation.mutate()}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Prep-Kit Cases</CardTitle>
          <CardDescription>
            Select which category contains your cases and containers. Assets in this category
            (and its subcategories) can be used as prep-kit containers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
          {canEdit && (
            <div className="flex justify-end">
              <Button
                onClick={() => updateMutation.mutate()}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Categories</CardTitle>
            <CardDescription>
              Organize your equipment into categories and subcategories.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" render={<Link href="/assets/categories" />}>
              Manage Categories
            </Button>
          </CardContent>
        </Card>
      )}

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Suppliers</CardTitle>
            <CardDescription>
              Manage your equipment suppliers and vendors.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" render={<Link href="/suppliers" />}>
              Manage Suppliers
            </Button>
          </CardContent>
        </Card>
      )}

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Locations</CardTitle>
            <CardDescription>
              Manage warehouses, venues, and storage locations.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" render={<Link href="/locations" />}>
              Manage Locations
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
