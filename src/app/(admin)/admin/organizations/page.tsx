"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/admin-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Search, Trash2, Building2, Eye, Upload, Download, Plus } from "lucide-react";
import Link from "next/link";
import { Label } from "@/components/ui/label";
import {
  getAllOrganizations,
  adminDeleteOrganization,
  adminCreateOrganization,
} from "@/server/site-admin";

export default function AdminOrganizationsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createSlug, setCreateSlug] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importName, setImportName] = useState("");
  const [importSlug, setImportSlug] = useState("");
  const [importing, setImporting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-organizations", search, page],
    queryFn: () => getAllOrganizations({ page, pageSize: 20, search }),
  });

  async function handleImport() {
    if (!importFile) return;
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      if (importName.trim()) formData.append("name", importName.trim());
      if (importSlug.trim()) formData.append("slug", importSlug.trim());

      const res = await fetch("/api/admin/org-import", {
        method: "POST",
        body: formData,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Import failed");

      queryClient.invalidateQueries({ queryKey: ["admin-organizations"] });
      toast.success(`Imported "${body.name}" successfully`);
      setImportOpen(false);
      setImportFile(null);
      setImportName("");
      setImportSlug("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  const deleteMutation = useMutation({
    mutationFn: (orgId: string) => adminDeleteOrganization(orgId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-organizations"] });
      toast.success("Organization deleted");
      setDeleteTarget(null);
      setConfirmName("");
    },
    onError: (e) => toast.error(e.message),
  });

  const createMutation = useMutation({
    mutationFn: () => adminCreateOrganization({ name: createName.trim(), slug: createSlug.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-organizations"] });
      toast.success("Organization created");
      setCreateOpen(false);
      setCreateName("");
      setCreateSlug("");
    },
    onError: (e) => toast.error(e.message),
  });

  function slugify(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  }

  return (
    <AdminShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Organizations</h1>
          <p className="text-muted-foreground">
            Manage all organizations on the platform.
          </p>
        </div>

        {/* Search + Import */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search organizations..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-9"
            />
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create
          </Button>
          <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Import
          </Button>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="p-3 text-left font-medium">Organization</th>
                    <th className="p-3 text-left font-medium hidden sm:table-cell">Slug</th>
                    <th className="p-3 text-left font-medium hidden md:table-cell">Owner</th>
                    <th className="p-3 text-center font-medium hidden sm:table-cell">Members</th>
                    <th className="p-3 text-left font-medium hidden lg:table-cell">Created</th>
                    <th className="p-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-muted-foreground">
                        Loading...
                      </td>
                    </tr>
                  ) : data?.organizations?.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-muted-foreground">
                        No organizations found.
                      </td>
                    </tr>
                  ) : (
                    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
                    data?.organizations?.map(
                      (org: any) => (
                        <tr key={org.id} className="border-b hover:bg-muted/30">
                          <td className="p-3">
                            <Link
                              href={`/admin/organizations/${org.id}`}
                              className="flex items-center gap-2 hover:underline"
                            >
                              <Building2 className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">{org.name}</span>
                            </Link>
                          </td>
                          <td className="p-3 text-muted-foreground font-mono text-xs hidden sm:table-cell">
                            {org.slug}
                          </td>
                          <td className="p-3 hidden md:table-cell">
                            {org.members[0]?.user?.name || "-"}
                          </td>
                          <td className="p-3 text-center hidden sm:table-cell">
                            <Badge variant="secondary">{org._count.members}</Badge>
                          </td>
                          <td className="p-3 text-muted-foreground hidden lg:table-cell">
                            {new Date(org.createdAt).toLocaleDateString()}
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Manage organization"
                                render={<Link href={`/admin/organizations/${org.id}`} />}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Export backup"
                                onClick={async () => {
                                  try {
                                    const res = await fetch(`/api/admin/org-export/${org.id}`);
                                    if (!res.ok) throw new Error("Export failed");
                                    const blob = await res.blob();
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement("a");
                                    a.href = url;
                                    a.download = `org-export-${org.slug}.zip`;
                                    a.click();
                                    URL.revokeObjectURL(url);
                                    toast.success("Export downloaded");
                                  } catch {
                                    toast.error("Export failed");
                                  }
                                }}
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive"
                                onClick={() =>
                                  setDeleteTarget({ id: org.id, name: org.name })
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ),
                    )
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Pagination */}
        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {data.organizations?.length} of {data.total}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.totalPages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setConfirmName("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Organization</DialogTitle>
            <DialogDescription>
              This will permanently delete{" "}
              <strong>{deleteTarget?.name}</strong> and all its data. This
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm">
              Type <strong>{deleteTarget?.name}</strong> to confirm:
            </p>
            <Input
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder="Organization name"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={
                confirmName !== deleteTarget?.name ||
                deleteMutation.isPending
              }
              onClick={() =>
                deleteTarget && deleteMutation.mutate(deleteTarget.id)
              }
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete Organization"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Create Organization Dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setCreateName("");
            setCreateSlug("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Organization</DialogTitle>
            <DialogDescription>
              Create a new organization. You will be assigned as the owner.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="create-org-name">Organization Name</Label>
              <Input
                id="create-org-name"
                placeholder="Two Toned Productions"
                value={createName}
                onChange={(e) => {
                  setCreateName(e.target.value);
                  setCreateSlug(slugify(e.target.value));
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-org-slug">URL Slug</Label>
              <Input
                id="create-org-slug"
                placeholder="two-toned-productions"
                value={createSlug}
                onChange={(e) => setCreateSlug(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers, and hyphens only.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!createName.trim() || !createSlug.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? "Creating..." : "Create Organization"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Organization Dialog */}
      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          if (!open) {
            setImportOpen(false);
            setImportFile(null);
            setImportName("");
            setImportSlug("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Organization</DialogTitle>
            <DialogDescription>
              Upload an organization export (.zip) to create a new organization
              with all its data and media.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Export File</label>
              <Input
                type="file"
                accept=".zip"
                onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                New Organization Name{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Input
                placeholder="Leave blank to auto-generate"
                value={importName}
                onChange={(e) => setImportName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                New Slug{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Input
                placeholder="Leave blank to auto-generate"
                value={importSlug}
                onChange={(e) => setImportSlug(e.target.value)}
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
