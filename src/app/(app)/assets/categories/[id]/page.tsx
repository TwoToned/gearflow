"use client";

import { use } from "react";
import Link from "next/link";
import { useServerQuery } from "@/hooks/use-server-query";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  Boxes,
  Container,
  Folder,
  FolderOpen,
  FolderTree,
  ArrowLeft,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

import { useConvex, useConvexAuth } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RequirePermission } from "@/components/auth/require-permission";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { cn, focusRing } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MobileCardList, type ColumnDef } from "@/components/ui/data-table";
import { MediaThumbnail } from "@/components/media/media-thumbnail";
import { resolveModelPhotoUrl } from "@/lib/media-utils";
import { useActiveOrganization } from "@/lib/auth-client";
import { SectionHeader } from "@/components/layout/page-layouts";
import { FadeIn, StaggerList, StaggerItem } from "@/components/ui/motion";

import { kitStatusLabels, formatLabel } from "@/lib/status-labels";

export default function CategoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <RequirePermission resource="model" action="read">
      <CategoryDetailContent params={params} />
    </RequirePermission>
  );
}

function CategoryDetailContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();

  const { data: category, isLoading, error, refetch } = useServerQuery({
    queryKey: ["category", orgId, id],
    queryFn: () => convex.query(api.categories.detail, { id, orgId: orgId as string }),
    enabled: !!orgId && isAuthenticated,
  });

  if (isLoading) {
    return <DetailPageSkeleton />;
  }

  if (error) {
    return (
      <div className="rounded-[var(--r-lg)] border-l-2 border-l-t-out border border-line bg-card p-6 text-center">
        <p className="text-ui-text text-ink-2">Couldn&apos;t load this category.</p>
        <p className="mt-1 text-caption text-muted">{error.message}</p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button variant="line" size="sm" asChild>
            <Link href="/assets/categories">Back to categories</Link>
          </Button>
          <Button variant="primary" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!category) {
    return (
      <div className="rounded-[var(--r-lg)] border-l-2 border-l-t-out border border-line bg-card p-6 text-center">
        <p className="text-ui-text text-ink-2">Category not found.</p>
        <p className="mt-1 text-caption text-muted">It may have been deleted, or you don&apos;t have access to it.</p>
        <Button variant="line" size="sm" className="mt-4" asChild>
          <Link href="/assets/categories">Back to categories</Link>
        </Button>
      </div>
    );
  }

  const parentHref = category.parent
    ? `/assets/categories/${category.parent.id}`
    : "/assets/categories";

  // Mobile card layout for the Models sub-table (rendered below `md`).
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const modelColumns: ColumnDef<any>[] = [
    {
      id: "thumb",
      header: "",
      mobile: "hidden",
      cell: (model) => (
        <MediaThumbnail
          url={resolveModelPhotoUrl(model, true)}
          alt={model.name}
          size={32}
        />
      ),
    },
    {
      id: "name",
      header: "Model",
      mobile: "title",
      cell: (model) => (
        <Link
          href={`/assets/models/${model.id}`}
          className={cn("font-medium text-ink hover:text-red transition-colors rounded-sm", focusRing)}
        >
          {model.name}
        </Link>
      ),
    },
    {
      id: "manufacturer",
      header: "Manufacturer",
      mobile: "subtitle",
      cell: (model) => <span className="text-muted">{model.manufacturer || "—"}</span>,
    },
    {
      id: "modelNumber",
      header: "Model number",
      mobile: "meta",
      cell: (model) => <span className="t-mono text-muted">{model.modelNumber || "—"}</span>,
    },
    {
      id: "assets",
      header: "Assets",
      mobile: "meta",
      cell: (model) => <Badge status="neutral">{model._count.assets}</Badge>,
    },
  ];

  // Mobile card layout for the Kits sub-table (rendered below `md`).
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const kitColumns: ColumnDef<any>[] = [
    {
      id: "name",
      header: "Kit",
      mobile: "title",
      cell: (kit) => (
        <Link
          href={`/kits/${kit.id}`}
          className={cn("font-medium text-ink hover:text-red transition-colors rounded-sm", focusRing)}
        >
          {kit.name}
        </Link>
      ),
    },
    {
      id: "assetTag",
      header: "Asset tag",
      mobile: "subtitle",
      cell: (kit) => <span className="t-mono text-muted">{kit.assetTag || "—"}</span>,
    },
    {
      id: "status",
      header: "Status",
      mobile: "badge",
      cell: (kit) =>
        kit.status ? (
          <StatusIndicator category="kit" value={kit.status} label={kitStatusLabels[kit.status] || formatLabel(kit.status)} variant="pill" />
        ) : null,
    },
    {
      id: "items",
      header: "Items",
      mobile: "meta",
      cell: (kit) => (
        <Badge status="neutral">{(kit._count?.serializedItems || 0) + (kit._count?.bulkItems || 0)}</Badge>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <FadeIn>
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push(parentHref)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <nav className="flex items-center gap-1 text-caption text-muted mb-1">
              <Link href="/assets/categories" className={cn("hover:text-ink transition-colors rounded-sm", focusRing)}>
                Categories
              </Link>
              {category.parent && (
                <>
                  <ChevronRight className="h-3 w-3" />
                  <Link
                    href={`/assets/categories/${category.parent.id}`}
                    className={cn("hover:text-ink transition-colors rounded-sm", focusRing)}
                  >
                    {category.parent.name}
                  </Link>
                </>
              )}
              <ChevronRight className="h-3 w-3" />
              <span className="text-ink-2">{category.name}</span>
            </nav>
            <div className="flex items-center gap-3">
              {category.icon ? (
                <span className="text-2xl">{category.icon}</span>
              ) : (
                <Folder className="h-6 w-6 text-muted" />
              )}
              <h1 className="t-title text-ink">{category.name}</h1>
            </div>
            {category.description && (
              <p className="text-caption text-muted mt-1">{category.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {category._count.models > 0 && (
              <Badge status="neutral" className="gap-1">
                <Boxes className="h-3 w-3" />
                {category._count.models} model{category._count.models !== 1 ? "s" : ""}
              </Badge>
            )}
            {category._count.kits > 0 && (
              <Badge status="neutral" className="gap-1">
                <Container className="h-3 w-3" />
                {category._count.kits} kit{category._count.kits !== 1 ? "s" : ""}
              </Badge>
            )}
            {category._count.children > 0 && (
              <Badge status="neutral" className="gap-1">
                <FolderOpen className="h-3 w-3" />
                {category._count.children} subcategor{category._count.children !== 1 ? "ies" : "y"}
              </Badge>
            )}
          </div>
        </div>
      </FadeIn>

      {/* Subcategories */}
      {category.children && category.children.length > 0 && (
        <FadeIn delay={0.05}>
          <SectionHeader label="Subcategories" />
          <StaggerList className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 mt-4" delay={0.08}>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {category.children.map((child: any) => (
              <StaggerItem key={child.id}>
                <Link
                  href={`/assets/categories/${child.id}`}
                  className={cn("flex items-center gap-3 rounded-[var(--r)] border border-line bg-card p-3 shadow-[var(--sh-card)] hover:border-line-2 hover:bg-paper-2 transition-colors group", focusRing)}
                >
                  {child.icon ? (
                    <span className="text-lg">{child.icon}</span>
                  ) : (
                    <FolderTree className="h-5 w-5 text-muted" />
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="text-table-cell font-medium text-ink group-hover:text-red transition-colors">
                      {child.name}
                    </span>
                    <div className="flex items-center gap-2 mt-0.5">
                      {child._count.models > 0 && (
                        <span className="text-caption text-muted t-data">{child._count.models} models</span>
                      )}
                      {child._count.kits > 0 && (
                        <span className="text-caption text-muted t-data">{child._count.kits} kits</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted" />
                </Link>
              </StaggerItem>
            ))}
          </StaggerList>
        </FadeIn>
      )}

      {/* Models & Kits tabs */}
      <FadeIn delay={0.1}>
        <Tabs defaultValue="models">
          <TabsList>
            <TabsTrigger value="models">
              Models ({category._count.models})
            </TabsTrigger>
            <TabsTrigger value="kits">
              Kits ({category._count.kits})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="models">
            {category.models && category.models.length > 0 ? (
              <>
                <SectionHeader label="Models" className="mb-3" />
                <div className="hidden rounded-[var(--r)] border border-line overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12"></TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead className="hidden sm:table-cell">Manufacturer</TableHead>
                      <TableHead className="hidden md:table-cell">Model number</TableHead>
                      <TableHead className="text-right">Assets</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {category.models.map((model: any) => {
                      const photoUrl = resolveModelPhotoUrl(model, true);
                      return (
                        <TableRow key={model.id}>
                          <TableCell>
                            <MediaThumbnail
                              url={photoUrl}
                              alt={model.name}
                              size={32}
                            />
                          </TableCell>
                          <TableCell>
                            <Link
                              href={`/assets/models/${model.id}`}
                              className={cn("font-medium text-ink hover:text-red transition-colors rounded-sm", focusRing)}
                            >
                              {model.name}
                            </Link>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-muted">
                            {model.manufacturer || "\u2014"}
                          </TableCell>
                          <TableCell className="hidden md:table-cell t-mono text-muted">
                            {model.modelNumber || "\u2014"}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge status="neutral">{model._count.assets}</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                </div>
                {category.models.length > 0 && (
                  <MobileCardList
                    className="md:hidden"
                    data={category.models}
                    columns={modelColumns}
                    getRowId={(m) => m.id}
                  />
                )}
              </>
            ) : (
              <EmptyState
                title="No models in this category"
                description="Models group identical assets — create one to start adding units."
                action={
                  <Button size="sm" asChild>
                    <Link href="/assets/models/new">Add model</Link>
                  </Button>
                }
              />
            )}
          </TabsContent>

          <TabsContent value="kits">
            {category.kits && category.kits.length > 0 ? (
              <>
                <SectionHeader label="Kits" className="mb-3" />
                <div className="hidden rounded-[var(--r)] border border-line overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kit</TableHead>
                      <TableHead className="hidden sm:table-cell">Asset tag</TableHead>
                      <TableHead className="hidden md:table-cell">Status</TableHead>
                      <TableHead className="text-right">Items</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {category.kits.map((kit: any) => {
                      const itemCount = (kit._count?.serializedItems || 0) + (kit._count?.bulkItems || 0);
                      return (
                        <TableRow key={kit.id}>
                          <TableCell>
                            <Link
                              href={`/kits/${kit.id}`}
                              className={cn("font-medium text-ink hover:text-red transition-colors rounded-sm", focusRing)}
                            >
                              {kit.name}
                            </Link>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell t-mono text-muted">
                            {kit.assetTag || "\u2014"}
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            {kit.status && (
                              <StatusIndicator category="kit" value={kit.status} label={kitStatusLabels[kit.status] || formatLabel(kit.status)} variant="pill" />
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge status="neutral">{itemCount}</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                </div>
                {category.kits.length > 0 && (
                  <MobileCardList
                    className="md:hidden"
                    data={category.kits}
                    columns={kitColumns}
                    getRowId={(k) => k.id}
                  />
                )}
              </>
            ) : (
              <EmptyState
                title="No kits in this category"
                description="Kits bundle assets that always go together — build one to speed up checkout."
                action={
                  <Button size="sm" asChild>
                    <Link href="/kits/new">Add kit</Link>
                  </Button>
                }
              />
            )}
          </TabsContent>
        </Tabs>
      </FadeIn>
    </div>
  );
}
