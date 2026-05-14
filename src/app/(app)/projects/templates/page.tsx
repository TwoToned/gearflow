"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useActiveOrganization } from "@/lib/auth-client";
import { BookTemplate, Plus, Trash2, Copy } from "lucide-react";
import { getTemplates, deleteTemplate, duplicateProject } from "@/server/projects";
import { RequirePermission } from "@/components/auth/require-permission";
import { CanDo } from "@/components/auth/permission-gate";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { Badge } from "@/components/ui/badge";
import { FadeIn } from "@/components/ui/motion";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const typeLabels: Record<string, string> = {
  DRY_HIRE: "Dry Hire",
  WET_HIRE: "Wet Hire",
  INSTALLATION: "Installation",
  TOUR: "Tour",
  CORPORATE: "Corporate",
  THEATRE: "Theatre",
  FESTIVAL: "Festival",
  CONFERENCE: "Conference",
  OTHER: "Other",
};

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function TemplatesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [createFrom, setCreateFrom] = useState<any>(null);
  const [projectNumber, setProjectNumber] = useState("");
  const [projectName, setProjectName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: templates, isLoading } = useQuery({
    queryKey: ["templates", orgId],
    queryFn: getTemplates,
  });

  const deleteMut = useMutation({
    mutationFn: deleteTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      toast.success("Template deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  const createMut = useMutation({
    mutationFn: () =>
      duplicateProject(createFrom.id, projectNumber, projectName),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project created from template");
      setCreateFrom(null);
      router.push(`/projects/${result.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <RequirePermission resource="project" action="read">
      <FadeIn>
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="t-title text-fg">Templates</h1>
            <p className="text-fg-3">
              Reusable project templates with pre-configured line items.
            </p>
          </div>
          <CanDo resource="project" action="create">
            <Button render={<Link href="/projects/templates/new" />}>
              <Plus className="mr-2 h-4 w-4" />
              New Template
            </Button>
          </CanDo>
        </div>

        <div className="rounded-lg bg-bg-surface surface-ring">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead className="text-center">Items</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-fg-3 py-8">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : !templates?.length ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-fg-3 py-8">
                      <BookTemplate className="mx-auto h-8 w-8 mb-2 opacity-50" />
                      No templates yet. Save a project as a template or create one from scratch.
                    </TableCell>
                  </TableRow>
                ) : (
                  templates.map((t: any) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <Link
                          href={`/projects/${t.id}`}
                          className="font-mono text-sm hover:underline"
                        >
                          {t.projectNumber}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link href={`/projects/${t.id}`} className="font-medium hover:underline">
                          {t.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {typeLabels[t.type] || t.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-fg-3">
                        {t.client?.name || "—"}
                      </TableCell>
                      <TableCell className="text-center text-fg-3">
                        {t._count?.lineItems ?? 0}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <CanDo resource="project" action="create">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setCreateFrom(t);
                                setProjectNumber("");
                                setProjectName(`${t.name}`);
                              }}
                            >
                              <Copy className="mr-1 h-3.5 w-3.5" />
                              Use
                            </Button>
                          </CanDo>
                          <CanDo resource="project" action="update">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              render={<Link href={`/projects/${t.id}/edit`} />}
                            >
                              <BookTemplate className="h-3.5 w-3.5" />
                            </Button>
                          </CanDo>
                          <CanDo resource="project" action="delete">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={() =>
                                setDeleteTarget({ id: t.id, name: t.name })
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </CanDo>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
        </div>
      </div>
      </FadeIn>

      {/* Create Project from Template */}
      <Dialog open={!!createFrom} onOpenChange={(open) => !open && setCreateFrom(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Project from Template</DialogTitle>
            <DialogDescription>
              Create a new project using &quot;{createFrom?.name}&quot; as a starting point.
              All line items will be copied. Dates will be cleared.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createMut.mutate();
            }}
          >
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="tpl-number">Project Code *</Label>
                <Input
                  id="tpl-number"
                  value={projectNumber}
                  onChange={(e) => setProjectNumber(e.target.value)}
                  required
                  className="font-mono"
                  placeholder="e.g. PROJ-2026-0042"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tpl-name">Name *</Label>
                <Input
                  id="tpl-name"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  required
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateFrom(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMut.isPending}>
                {createMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Project
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <DeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete template "${deleteTarget?.name ?? ""}"?`}
        description="This removes the project template. Projects already created from this template are not affected."
        confirmLabel="Delete template"
        onConfirm={() => {
          if (deleteTarget) {
            deleteMut.mutate(deleteTarget.id);
            setDeleteTarget(null);
          }
        }}
        pending={deleteMut.isPending}
      />
    </RequirePermission>
  );
}
