"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Upload, Download, Building2, Eye, Loader2 } from "lucide-react";
import Link from "next/link";
import {
  adminGetTheOrg,
  adminGetOrganizationDetails,
} from "@/server/site-admin";

export default function AdminOrganizationsPage() {
  const queryClient = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const { data: theOrg, isLoading: orgLoading } = useQuery({
    queryKey: ["admin-the-org"],
    queryFn: adminGetTheOrg,
  });

  const { data: orgDetails } = useQuery({
    queryKey: ["admin-org-detail", theOrg?.id],
    queryFn: () => adminGetOrganizationDetails(theOrg!.id),
    enabled: !!theOrg?.id,
  });

  async function handleExport() {
    if (!theOrg) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/admin/org-export/${theOrg.id}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `org-export-${theOrg.slug}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function handleImport() {
    if (!importFile) return;
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", importFile);

      const res = await fetch("/api/admin/org-import", {
        method: "POST",
        body: formData,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Import failed");

      queryClient.invalidateQueries({ queryKey: ["admin-the-org"] });
      queryClient.invalidateQueries({ queryKey: ["admin-org-detail"] });
      toast.success(`Imported "${body.name}" successfully`);
      setImportOpen(false);
      setImportFile(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const counts = (orgDetails as any)?._count ?? { assets: 0, bulkAssets: 0, projects: 0, kits: 0 };
  const memberCount = (orgDetails as any)?.members?.length ?? 0;
  const owner = (orgDetails as any)?.members?.find((m: any) => m.role === "owner");

  return (
    <AdminShell>
      <div className="space-y-6">
        <div>
          <h1 className="t-title text-fg">Organization</h1>
          <p className="text-fg-3">
            Manage the platform organization.
          </p>
        </div>

        {orgLoading ? (
          <div className="rounded-lg bg-bg-surface surface-ring">
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-fg-3" />
            </div>
          </div>
        ) : !theOrg ? (
          <div className="rounded-lg bg-bg-surface surface-ring">
            <div className="py-12 text-center text-fg-3">
              <Building2 className="mx-auto mb-3 h-8 w-8" />
              <p>No organization configured yet.</p>
              <p className="text-sm mt-1">The first user to log in will set up the organization during onboarding.</p>
            </div>
          </div>
        ) : (
          <>
            {/* Org Overview */}
            <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm font-bold">
                    {theOrg.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="t-heading">{theOrg.name}</h3>
                    <p className="text-sm text-fg-3 font-mono">{theOrg.slug}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={exporting} onClick={handleExport}>
                    <Download className="mr-2 h-4 w-4" />
                    {exporting ? "Exporting..." : "Export"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                    <Upload className="mr-2 h-4 w-4" />
                    Import
                  </Button>
                  <Button size="sm" render={<Link href={`/admin/organizations/${theOrg.id}`} />}>
                    <Eye className="mr-2 h-4 w-4" />
                    Manage
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                <div>
                  <p className="t-title t-data">{memberCount}</p>
                  <p className="text-xs text-fg-3">Members</p>
                </div>
                <div>
                  <p className="t-title t-data">{counts.assets}</p>
                  <p className="text-xs text-fg-3">Assets</p>
                </div>
                <div>
                  <p className="t-title t-data">{counts.bulkAssets}</p>
                  <p className="text-xs text-fg-3">Bulk Assets</p>
                </div>
                <div>
                  <p className="t-title t-data">{counts.projects}</p>
                  <p className="text-xs text-fg-3">Projects</p>
                </div>
                <div>
                  <p className="t-title t-data">{counts.kits}</p>
                  <p className="text-xs text-fg-3">Kits</p>
                </div>
              </div>
              {owner && (
                <div className="mt-4 pt-4 border-t">
                  <p className="text-sm text-fg-3">
                    Owner: <span className="text-fg font-medium">{owner.user?.name || owner.user?.email || "Unknown"}</span>
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Import Organization Dialog */}
      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          if (!open) {
            setImportOpen(false);
            setImportFile(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Organization</DialogTitle>
            <DialogDescription>
              Upload an organization export (.zip) to overwrite the current
              organization&apos;s data.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Export File</Label>
              <Input
                type="file"
                accept=".zip"
                onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!importFile || importing}
              onClick={handleImport}
            >
              {importing ? "Importing..." : "Import Organization"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}
