"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { toast } from "sonner";
import { useActiveOrganization } from "@/lib/auth-client";
import { BookTemplate, Plus, Trash2, Copy } from "lucide-react";
import { getTemplates, deleteTemplate, duplicateProject } from "@/server/projects";
import { RequirePermission } from "@/components/auth/require-permission";
import { CanDo } from "@/components/auth/permission-gate";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { TableSkeleton } from "@/components/ui/skeleton";
import { FadeIn } from "@/components/ui/motion";
import { cn, focusRing } from "@/lib/utils";

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
import { MobileCardList, type ColumnDef } from "@/components/ui/data-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const typeLabels: Record<string, string> = {
  DRY_HIRE: "Dry hire",
  WET_HIRE: "Wet hire",
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
  const [createFrom, setCreateFrom] = useState<any>(null);
  const [projectNumber, setProjectNumber] = useState("");
  const [projectName, setProjectName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: templates, isLoading, error, refetch: refetchTemplates } = useServerQuery({
    queryKey: ["templates", orgId],
    queryFn: getTemplates,
  });

  const deleteMut = useServerMutation({
    mutationFn: deleteTemplate,
    onSuccess: () => {
      refetchTemplates();
      toast.success("Template deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  const createMut = useServerMutation({
    mutationFn: () =>
      duplicateProject(createFrom.id, projectNumber, projectName),
    onSuccess: (result) => {
      toast.success("Project created from template");
      setCreateFrom(null);
      router.push(`/projects/${result.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  // Mobile card layout for the templates table (rendered below `md`).
  const cols: ColumnDef<any>[] = [
    {
      id: "name",
      header: "Name",
      mobile: "title",
      cell: (t) => (
        <Link href={`/projects/${t.id}`} className={cn("font-medium text-ink-2 hover:text-link hover:underline rounded-sm", focusRing)}>
          {t.name}
        </Link>
      ),
    },
    {
      id: "code",
      header: "Code",
      mobile: "subtitle",
      cell: (t) => (
        <Link
          href={`/projects/${t.id}`}
          className={cn("t-mono text-muted hover:text-link hover:underline rounded-sm", focusRing)}
        >
          {t.projectNumber}
        </Link>
      ),
    },
    {
      id: "type",
      header: "Type",
      mobile: "badge",
      cell: (t) => (
        <span className="inline-flex items-center rounded-full bg-paper-2 px-2 py-0.5 text-badge font-medium text-muted">
          {typeLabels[t.type] || t.type}
        </span>
      ),
    },
    {
      id: "client",
      header: "Client",
      mobile: "meta",
      cell: (t) => t.client?.name || "—",
    },
    {
      id: "items",
      header: "Items",
      mobile: "meta",
      cell: (t) => <span className="tabular-nums">{t._count?.lineItems ?? 0}</span>,
    },
    {
      id: "actions",
      header: "Actions",
      mobile: "actions",
      cell: (t) => (
        <div className="flex justify-end gap-1">
          <CanDo resource="project" action="create">
            <Button
              variant="line"
              size="sm"
              onClick={() => {
                setCreateFrom(t);
                setProjectNumber("");
                setProjectName(`${t.name}`);
              }}
            >
              <Copy className="h-3.5 w-3.5" />
              Use
            </Button>
          </CanDo>
          <CanDo resource="project" action="update">
            <Button
              variant="ghost"
              size="icon"
              className="touch-target size-8"
              title="Edit template"
              asChild
            >
              <Link href={`/projects/${t.id}/edit`}>
                <BookTemplate className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </CanDo>
          <CanDo resource="project" action="delete">
            <Button
              variant="ghost"
              size="icon"
              className="touch-target size-8 text-t-out"
              title="Delete template"
              onClick={() => setDeleteTarget({ id: t.id, name: t.name })}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </CanDo>
        </div>
      ),
    },
  ];

  return (
    <RequirePermission resource="project" action="read">
      <FadeIn>
      <div className="space-y-4">
        <PageHeader
          title="Templates"
          description="Reusable project templates with pre-configured line items."
          actions={
            <CanDo resource="project" action="create">
              <Button asChild>
                <Link href="/projects/templates/new">
                  <Plus className="h-4 w-4" />
                  New template
                </Link>
              </Button>
            </CanDo>
          }
        />

        {error && (
          <div className="flex items-center justify-between gap-4 rounded-[var(--r)] border border-line border-l-[3px] border-l-t-out bg-card p-3">
            <p className="text-ui-text text-t-out">Couldn&apos;t load templates. Check your connection and try again.</p>
            <Button variant="line" size="sm" onClick={() => refetchTemplates()}>
              Retry
            </Button>
          </div>
        )}

        <div className="hidden md:block rounded-[var(--r-lg)] border border-line bg-card shadow-[var(--sh-card)] overflow-hidden">
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
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={6} className="py-0">
                      <TableSkeleton rows={4} cols={6} />
                    </TableCell>
                  </TableRow>
                ) : !templates?.length ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={6} className="text-center py-10">
                      <BookTemplate className="mx-auto h-8 w-8 mb-2 text-muted" />
                      <p className="text-ui-text font-medium text-ink-2">No templates yet</p>
                      <p className="mt-1 text-caption text-muted">Save a project as a template, or build one from scratch.</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  templates.map((t: any) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <Link
                          href={`/projects/${t.id}`}
                          className={cn("t-mono text-muted hover:text-link hover:underline rounded-sm", focusRing)}
                        >
                          {t.projectNumber}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link href={`/projects/${t.id}`} className={cn("font-medium text-ink-2 hover:text-link hover:underline rounded-sm", focusRing)}>
                          {t.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center rounded-full bg-paper-2 px-2 py-0.5 text-badge font-medium text-muted">
                          {typeLabels[t.type] || t.type}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted">
                        {t.client?.name || "—"}
                      </TableCell>
                      <TableCell className="text-center text-muted tabular-nums">
                        {t._count?.lineItems ?? 0}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <CanDo resource="project" action="create">
                            <Button
                              variant="line"
                              size="sm"
                              onClick={() => {
                                setCreateFrom(t);
                                setProjectNumber("");
                                setProjectName(`${t.name}`);
                              }}
                            >
                              <Copy className="h-3.5 w-3.5" />
                              Use
                            </Button>
                          </CanDo>
                          <CanDo resource="project" action="update">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="touch-target size-8"
                              title="Edit template"
                              asChild
                            >
                              <Link href={`/projects/${t.id}/edit`}>
                                <BookTemplate className="h-3.5 w-3.5" />
                              </Link>
                            </Button>
                          </CanDo>
                          <CanDo resource="project" action="delete">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="touch-target size-8 text-t-out"
                              title="Delete template"
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
        {/* Mobile: loading / empty / cards. The desktop table's colSpan skeleton
            and empty row are md:block-hidden, so mirror those states here. */}
        <div className="md:hidden">
          {isLoading ? (
            <TableSkeleton rows={4} cols={1} />
          ) : !templates || templates.length === 0 ? (
            <p className="py-10 text-center text-ui-text font-medium text-ink-2">No templates yet</p>
          ) : (
            <MobileCardList data={templates} columns={cols} getRowId={(t: any) => t.id} />
          )}
        </div>
      </div>
      </FadeIn>

      {/* Create Project from Template */}
      <Dialog open={!!createFrom} onOpenChange={(open) => !open && setCreateFrom(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create project from template</DialogTitle>
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
                <Label htmlFor="tpl-number">Project code *</Label>
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
              <Button type="button" variant="line" onClick={() => setCreateFrom(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMut.isPending}>
                {createMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Create project
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
