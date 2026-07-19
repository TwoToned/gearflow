"use client";
// use-client: live Convex data via client subscription (useQuery) (R-8.1.1)

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { PageMeta } from "@/components/layout/page-meta";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import {
  Pencil,
  Trash2,
  MapPin,
  Star,
  Package,
  Boxes,
  Container,
  FolderOpen,
  ChevronRight,
  Briefcase,
  Warehouse,
  Building2,
  Truck,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { AddressDisplay } from "@/components/ui/address-display";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useConvex, useConvexAuth } from "convex/react";
import { useLocationWrites } from "@/hooks/use-location-writes";
import { api } from "../../../../../convex/_generated/api";
import { assetStatusLabels, bulkAssetStatusLabels, kitStatusLabels, projectStatusLabels, locationTypeLabels, formatLabel } from "@/lib/status-labels";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { cn, focusRing } from "@/lib/utils";
import { useActiveOrganization } from "@/lib/auth-client";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { useMediaWrites } from "@/hooks/use-media-writes";
import { NotesEditor } from "@/components/ui/notes-editor";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { Badge } from "@/components/ui/badge";
import { FadeIn } from "@/components/ui/motion";
import { DetailLayout, DetailMain, DetailSidebar, SidebarSection } from "@/components/layout/page-layouts";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MediaUploader, type MediaItem } from "@/components/media/media-uploader";
import { MobileCardList, type ColumnDef } from "@/components/ui/data-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** Type → icon for the location hero chip / meta. */
const locationTypeIcons: Record<string, typeof MapPin> = {
  WAREHOUSE: Warehouse,
  VENUE: Building2,
  VEHICLE: Truck,
  OFFSITE: MapPin,
};

export default function LocationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <RequirePermission resource="location" action="read">
      <LocationDetailContent params={params} />
    </RequirePermission>
  );
}

function LocationDetailContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const locWrites = useLocationWrites();
  const media = useMediaWrites("location");

  const { data: location, isLoading, refetch } = useServerQuery({
    queryKey: ["location", orgId, id],
    queryFn: () => convex.query(api.locations.detail, { id, orgId: orgId as string }),
    enabled: !!orgId && isAuthenticated,
  });

  const deleteMutation = useServerMutation({
    mutationFn: () => locWrites.remove(id),
    onSuccess: () => {
      toast.success("Location deleted");
      router.push("/locations");
    },
    onError: (e) => toast.error(e.message),
  });

  const [deleteOpen, setDeleteOpen] = useState(false);

  // ── "What's here" — derived client-side from data already loaded ──────
  // Stored-here counts (serialised / bulk / kits) + how many of those units
  // are currently out on a project (status CHECKED_OUT). All from getLocation.
  const here = useMemo(() => {
    const assets = location?.assets ?? [];
    const bulk = location?.bulkAssets ?? [];
    const kits = location?.kits ?? [];
    const isOut = (s: string) => s === "CHECKED_OUT";
    const deployedAssets = assets.filter((a: { status: string }) => isOut(a.status)).length;
    const deployedBulk = bulk.filter((b: { status: string }) => isOut(b.status)).length;
    const deployedKits = kits.filter((k: { status: string }) => isOut(k.status)).length;
    const stored =
      (location?._count?.assets ?? 0) +
      (location?._count?.bulkAssets ?? 0) +
      (location?._count?.kits ?? 0);
    return {
      serialised: location?._count?.assets ?? 0,
      bulk: location?._count?.bulkAssets ?? 0,
      kits: location?._count?.kits ?? 0,
      stored,
      deployed: deployedAssets + deployedBulk + deployedKits,
      projects: location?._count?.projects ?? 0,
    };
  }, [location]);

  if (isLoading) {
    return <DetailPageSkeleton />;
  }

  if (!location) {
    return (
      <div className="mx-auto max-w-3xl rounded-[var(--r-lg)] border border-line border-l-2 border-l-t-out bg-card p-6 text-center">
        <p className="text-ui-text text-ink-2">Location not found.</p>
        <p className="mt-1 text-caption text-muted">It may have been deleted, or you don&apos;t have access to it.</p>
        <Button variant="line" size="sm" className="mt-4" asChild>
          <Link href="/locations">Back to locations</Link>
        </Button>
      </div>
    );
  }

  const assetCount = (location._count?.assets || 0) + (location._count?.bulkAssets || 0) + (location._count?.kits || 0);
  const TypeIcon = locationTypeIcons[location.type] ?? MapPin;
  const hasMap = location.latitude != null && location.longitude != null;
  const mapsHref = location.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.address)}`
    : hasMap
      ? `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`
      : null;

  // ── "Stored here" — merge serialised / bulk / kit rows into one list so the
  // mobile card layout mirrors the single desktop table. `kind` discriminates
  // the per-type link target, badge, and status category.
  type StoredRow =
    | { kind: "asset"; id: string; assetTag: string; model?: { name?: string } | null; status: string }
    | { kind: "bulk"; id: string; assetTag: string; model?: { name?: string } | null; status: string }
    | { kind: "kit"; id: string; assetTag: string; name: string; status: string };

  const storedRows: StoredRow[] = [
    ...(location.assets ?? []).map((a: { id: string; assetTag: string; model?: { name?: string } | null; status: string }) => ({ kind: "asset" as const, ...a })),
    ...(location.bulkAssets ?? []).map((b: { id: string; assetTag: string; model?: { name?: string } | null; status: string }) => ({ kind: "bulk" as const, ...b })),
    ...(location.kits ?? []).map((k: { id: string; assetTag: string; name: string; status: string }) => ({ kind: "kit" as const, ...k })),
  ];

  const storedColumns: ColumnDef<StoredRow>[] = [
    {
      id: "assetTag",
      header: "Asset tag",
      mobile: "title",
      cell: (row) => (
        <Link
          href={row.kind === "kit" ? `/kits/${row.id}` : `/assets/registry/${row.id}`}
          className={cn("rounded-sm t-mono font-medium text-ink hover:underline", focusRing)}
        >
          {row.assetTag}
        </Link>
      ),
    },
    {
      id: "name",
      header: "Name / model",
      mobile: "subtitle",
      cell: (row) => (row.kind === "kit" ? row.name : row.model?.name || "—"),
    },
    {
      id: "type",
      header: "Type",
      mobile: "badge",
      cell: (row) => (
        <Badge status="neutral">
          {row.kind === "asset" ? "Serialised" : row.kind === "bulk" ? "Bulk" : "Kit"}
        </Badge>
      ),
    },
    {
      id: "status",
      header: "Status",
      mobile: "badge",
      cell: (row) => {
        if (row.kind === "asset") {
          return <StatusIndicator category="asset" value={row.status} label={assetStatusLabels[row.status] || formatLabel(row.status)} variant="pill" />;
        }
        if (row.kind === "bulk") {
          return <StatusIndicator category="bulkAsset" value={row.status} label={bulkAssetStatusLabels[row.status] || formatLabel(row.status)} variant="pill" />;
        }
        return <StatusIndicator category="kit" value={row.status} label={kitStatusLabels[row.status] || formatLabel(row.status)} variant="pill" />;
      },
    },
  ];

  // Mobile card layout for the projects sub-table (rendered below `md`).
  type ProjectRow = { id: string; projectNumber: string; name: string; status: string; client?: { name?: string } | null; createdAt: string | Date };
  const projectColumns: ColumnDef<ProjectRow>[] = [
    {
      id: "projectNumber",
      header: "Project #",
      mobile: "title",
      cell: (p) => (
        <Link href={`/projects/${p.id}`} className={cn("rounded-sm t-mono font-medium text-ink hover:underline", focusRing)}>
          {p.projectNumber}
        </Link>
      ),
    },
    {
      id: "name",
      header: "Name",
      mobile: "subtitle",
      cell: (p) => p.name,
    },
    {
      id: "client",
      header: "Client",
      mobile: "meta",
      cell: (p) => p.client?.name || "—",
    },
    {
      id: "status",
      header: "Status",
      mobile: "badge",
      cell: (p) => (
        <StatusIndicator category="project" value={p.status} label={projectStatusLabels[p.status] || formatLabel(p.status)} variant="pill" />
      ),
    },
    {
      id: "created",
      header: "Created",
      mobile: "meta",
      cell: (p) => new Date(p.createdAt).toLocaleDateString(),
    },
  ];

  return (
    <>
      <PageMeta title={location.name} />
      <FadeIn>
        <div className="space-y-6">
          {/* ── Hero card (breadcrumb + identity + actions) ──────────── */}
          <div className="rounded-[var(--r-lg)] border-2 border-line bg-card p-4 shadow-[var(--sh-card)] space-y-4 sm:p-5">
            {/* Breadcrumb */}
            <nav className="flex items-center gap-1 text-caption text-muted">
              <Link href="/locations" className={cn("rounded-sm transition-colors hover:text-ink", focusRing)}>
                Locations
              </Link>
              {location.parent && (
                <>
                  <ChevronRight className="h-3 w-3" />
                  <Link href={`/locations/${location.parent.id}`} className={cn("rounded-sm transition-colors hover:text-ink", focusRing)}>
                    {location.parent.name}
                  </Link>
                </>
              )}
              <ChevronRight className="h-3 w-3" />
              <span className="truncate text-ink-2">{location.name}</span>
            </nav>

            {/* Identity + actions */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-display text-page-title font-extrabold text-ink truncate">{location.name}</h1>
                  <StatusIndicator category="locationType" value={location.type} label={locationTypeLabels[location.type] || location.type} />
                  {location.isDefault && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2.5 py-1 text-badge font-bold text-warn">
                      <Star className="h-3 w-3 fill-warn" />
                      Default
                    </span>
                  )}
                </div>
                {/* Meta line: type · address · parent */}
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted">
                  <span className="inline-flex items-center gap-1">
                    <TypeIcon className="h-3.5 w-3.5" aria-hidden />
                    {locationTypeLabels[location.type] || location.type}
                  </span>
                  {location.address && (
                    <>
                      <span aria-hidden>&middot;</span>
                      {mapsHref ? (
                        <a
                          href={mapsHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn("inline-flex items-center gap-1 rounded-sm hover:text-ink-2 hover:underline", focusRing)}
                        >
                          <MapPin className="h-3.5 w-3.5" aria-hidden />
                          {location.address}
                        </a>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" aria-hidden />
                          {location.address}
                        </span>
                      )}
                    </>
                  )}
                  {location.parent && (
                    <>
                      <span aria-hidden>&middot;</span>
                      <span>
                        Sub-location of{" "}
                        <Link
                          href={`/locations/${location.parent.id}`}
                          className={cn("rounded-sm hover:text-ink-2 hover:underline", focusRing)}
                        >
                          {location.parent.name}
                        </Link>
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Action buttons (compact) */}
              <div className="flex flex-wrap items-center gap-2">
                <CanDo resource="location" action="update">
                  <Button variant="line" size="sm" asChild>
                    <Link href={`/locations/${id}/edit`}>
                      <Pencil className="h-4 w-4" />
                      <span className="hidden sm:inline">Edit</span>
                    </Link>
                  </Button>
                </CanDo>
                <CanDo resource="location" action="delete">
                  <Button
                    variant="line"
                    size="sm"
                    className="text-t-out hover:border-red hover:bg-red hover:text-white"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="hidden sm:inline">Delete</span>
                  </Button>
                </CanDo>
              </div>
            </div>

            {/* "What's here" count strip — single surface, vertical dividers */}
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--r)] border border-line bg-line sm:grid-cols-4">
              <HereStat icon={Boxes} label="Stored here" figure={here.stored} bright />
              <HereStat icon={Briefcase} label="Out on a project" figure={here.deployed} accent={here.deployed > 0} />
              <HereStat icon={FolderOpen} label="Projects using" figure={here.projects} />
              <HereStat icon={MapPin} label="Sub-locations" figure={location.children?.length ?? 0} />
            </div>
          </div>

          {/* ── 2-Column Layout ────────────────────────────────────── */}
          <DetailLayout>
            {/* Main content — emphasises what's physically here */}
            <DetailMain>
              <Tabs defaultValue="assets">
                <TabsList>
                  <TabsTrigger value="assets">
                    Stored here ({assetCount})
                  </TabsTrigger>
                  <TabsTrigger value="projects">
                    Projects ({location._count?.projects || 0})
                  </TabsTrigger>
                  <TabsTrigger value="notes">Notes</TabsTrigger>
                  <TabsTrigger value="files">
                    Files ({location.media?.length || 0})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="assets" className="mt-4">
                  {(location.assets?.length || 0) === 0 && (location.bulkAssets?.length || 0) === 0 && (location.kits?.length || 0) === 0 ? (
                    <EmptyState
                      title="Nothing stored here yet"
                      description="Assets, bulk stock, and kits checked in to this location will appear here — including anything currently out on a job."
                    />
                  ) : (
                    <>
                    <div className="hidden rounded-[var(--r)] border border-line md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Asset tag</TableHead>
                            <TableHead>Name / model</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {location.assets?.map((asset: { id: string; assetTag: string; model?: { name?: string } | null; status: string }) => (
                            <TableRow key={asset.id}>
                              <TableCell>
                                <Link href={`/assets/registry/${asset.id}`} className={cn("rounded-sm t-mono font-medium text-ink hover:underline", focusRing)}>
                                  {asset.assetTag}
                                </Link>
                              </TableCell>
                              <TableCell>{asset.model?.name || "—"}</TableCell>
                              <TableCell>
                                <Badge status="neutral">Serialised</Badge>
                              </TableCell>
                              <TableCell>
                                <StatusIndicator category="asset" value={asset.status} label={assetStatusLabels[asset.status] || formatLabel(asset.status)} variant="pill" />
                              </TableCell>
                            </TableRow>
                          ))}
                          {location.bulkAssets?.map((bulk: { id: string; assetTag: string; model?: { name?: string } | null; status: string }) => (
                            <TableRow key={bulk.id}>
                              <TableCell>
                                <Link href={`/assets/registry/${bulk.id}`} className={cn("rounded-sm t-mono font-medium text-ink hover:underline", focusRing)}>
                                  {bulk.assetTag}
                                </Link>
                              </TableCell>
                              <TableCell>{bulk.model?.name || "—"}</TableCell>
                              <TableCell>
                                <Badge status="neutral">Bulk</Badge>
                              </TableCell>
                              <TableCell>
                                <StatusIndicator category="bulkAsset" value={bulk.status} label={bulkAssetStatusLabels[bulk.status] || formatLabel(bulk.status)} variant="pill" />
                              </TableCell>
                            </TableRow>
                          ))}
                          {location.kits?.map((kit: { id: string; assetTag: string; name: string; status: string }) => (
                            <TableRow key={kit.id}>
                              <TableCell>
                                <Link href={`/kits/${kit.id}`} className={cn("rounded-sm t-mono font-medium text-ink hover:underline", focusRing)}>
                                  {kit.assetTag}
                                </Link>
                              </TableCell>
                              <TableCell>{kit.name}</TableCell>
                              <TableCell>
                                <Badge status="neutral">Kit</Badge>
                              </TableCell>
                              <TableCell>
                                <StatusIndicator category="kit" value={kit.status} label={kitStatusLabels[kit.status] || formatLabel(kit.status)} variant="pill" />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    {storedRows.length > 0 && (
                      <MobileCardList
                        className="md:hidden"
                        data={storedRows}
                        columns={storedColumns}
                        getRowId={(r) => r.id}
                      />
                    )}
                    </>
                  )}
                </TabsContent>

                <TabsContent value="projects" className="mt-4">
                  {(location.projects?.length || 0) === 0 ? (
                    <EmptyState title="No projects here" description="Projects using this as a venue or delivery address will appear here." />
                  ) : (
                    <>
                    <div className="hidden rounded-[var(--r)] border border-line md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Project #</TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>Client</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Created</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {location.projects?.map((project: { id: string; projectNumber: string; name: string; status: string; client?: { name?: string } | null; createdAt: string | Date }) => (
                            <TableRow key={project.id}>
                              <TableCell>
                                <Link href={`/projects/${project.id}`} className={cn("rounded-sm t-mono font-medium text-ink hover:underline", focusRing)}>
                                  {project.projectNumber}
                                </Link>
                              </TableCell>
                              <TableCell>{project.name}</TableCell>
                              <TableCell className="text-muted">{project.client?.name || "—"}</TableCell>
                              <TableCell>
                                <StatusIndicator category="project" value={project.status} label={projectStatusLabels[project.status] || formatLabel(project.status)} variant="pill" />
                              </TableCell>
                              <TableCell className="text-muted">
                                {new Date(project.createdAt).toLocaleDateString()}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    {(location.projects?.length || 0) > 0 && (
                      <MobileCardList
                        className="md:hidden"
                        data={location.projects ?? []}
                        columns={projectColumns}
                        getRowId={(p) => p.id}
                      />
                    )}
                    </>
                  )}
                </TabsContent>

                <TabsContent value="notes" className="mt-4">
                  <NotesEditor
                    initialNotes={location.notes || ""}
                    onChanged={refetch}
                    onSave={(notes) => locWrites.updateNotes(id, notes)}
                    placeholder="Add notes about this location..."
                  />
                </TabsContent>

                <TabsContent value="files" className="mt-4">
                  <MediaUploader
                    entityType="location"
                    entityId={id}
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,image/*"
                    existingMedia={(location.media || []).filter((m) => m.file).map((m) => m as MediaItem)}
                    onChanged={refetch}
                    onUploadComplete={async (fileUpload) => {
                      await media.add({ parentId: id, fileId: fileUpload.id, type: "DOCUMENT" });
                    }}
                    onRemove={async (mediaId) => {
                      await media.remove(mediaId);
                    }}
                  />
                </TabsContent>
              </Tabs>
            </DetailMain>

            {/* ── Sidebar (lean: Place · Inventory · Sub-locations · Activity) ─ */}
            <DetailSidebar>
                {/* Place — map + address + directions */}
                <SidebarSection title="Place">
                  {hasMap || location.address || location.parent?.address ? (
                    <div className="space-y-2">
                      <AddressDisplay
                        address={location.address || location.parent?.address}
                        latitude={location.latitude ?? location.parent?.latitude}
                        longitude={location.longitude ?? location.parent?.longitude}
                        label={location.name}
                        compact
                      />
                      {location.address && (
                        <p className="text-table-cell text-ink-2">{location.address}</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-table-cell text-faint">No address set</p>
                  )}
                </SidebarSection>

                {/* Inventory — what lives here, by kind */}
                <SidebarSection title="Inventory">
                  <div className="space-y-1.5 text-ui-text">
                    <div className="flex justify-between">
                      <div className="flex items-center gap-2 text-muted">
                        <Package className="h-3.5 w-3.5" />
                        <span>Serialised</span>
                      </div>
                      <span className="t-data font-medium text-ink tabular-nums">{location._count?.assets || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <div className="flex items-center gap-2 text-muted">
                        <Boxes className="h-3.5 w-3.5" />
                        <span>Bulk</span>
                      </div>
                      <span className="t-data font-medium text-ink tabular-nums">{location._count?.bulkAssets || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <div className="flex items-center gap-2 text-muted">
                        <Container className="h-3.5 w-3.5" />
                        <span>Kits</span>
                      </div>
                      <span className="t-data font-medium text-ink tabular-nums">{location._count?.kits || 0}</span>
                    </div>
                    {here.deployed > 0 && (
                      <div className="flex justify-between border-t border-line pt-1.5">
                        <div className="flex items-center gap-2 text-muted">
                          <Briefcase className="h-3.5 w-3.5" />
                          <span>Out on a project</span>
                        </div>
                        <span className="t-data font-medium text-red tabular-nums">{here.deployed}</span>
                      </div>
                    )}
                  </div>
                </SidebarSection>

                {/* Sub-locations */}
                {location.children && location.children.length > 0 && (
                  <SidebarSection title={`Sub-locations (${location.children.length})`}>
                    <div className="space-y-1">
                      {location.children.map((child: { id: string; name: string; _count?: { assets?: number; bulkAssets?: number } }) => (
                        <Link
                          key={child.id}
                          href={`/locations/${child.id}`}
                          className={cn("flex items-center justify-between rounded-[var(--r)] px-2 py-1.5 text-ui-text transition-colors hover:bg-elev", focusRing)}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <MapPin className="h-3.5 w-3.5 shrink-0 text-muted" />
                            <span className="truncate text-ink">{child.name}</span>
                          </div>
                          <span className="shrink-0 text-caption text-muted tabular-nums">
                            {(child._count?.assets || 0) + (child._count?.bulkAssets || 0)} assets
                          </span>
                        </Link>
                      ))}
                    </div>
                  </SidebarSection>
                )}

                {/* Activity Timeline */}
                <SidebarSection title="Activity" divider={false}>
                  <ActivityTimeline entityType="location" entityId={id} />
                </SidebarSection>
            </DetailSidebar>
          </DetailLayout>
        </div>
      </FadeIn>
      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete location?"
        description="This permanently removes the location. Assets, kits, and projects referencing it will be unlinked. This cannot be undone."
        confirmLabel="Delete location"
        onConfirm={() => {
          deleteMutation.mutate();
          setDeleteOpen(false);
        }}
        pending={deleteMutation.isPending}
      />
    </>
  );
}

/** One cell of the hero "what's here" count strip — calm-by-default. */
function HereStat({
  icon: Icon,
  label,
  figure,
  bright = false,
  accent = false,
}: {
  icon: typeof Boxes;
  label: string;
  figure: number;
  bright?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 bg-card p-3">
      <div className="flex items-center gap-1.5 text-muted">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="text-caption">{label}</span>
      </div>
      <span
        className={cn(
          "font-display font-extrabold leading-none tracking-tight tabular-nums",
          bright ? "text-[24px] text-ink" : "text-[20px]",
          accent ? "text-red" : bright ? "text-ink" : "text-ink-2",
        )}
      >
        {figure}
      </span>
    </div>
  );
}
