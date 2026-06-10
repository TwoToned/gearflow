"use client";

import { use } from "react";
import Link from "next/link";
import { useServerQuery } from "@/hooks/use-server-query";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  Boxes,
  Container,
  FolderOpen,
  ArrowLeft,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

import { getCategory } from "@/server/categories";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusIndicator } from "@/components/ui/status-indicator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MediaThumbnail } from "@/components/media/media-thumbnail";
import { resolveModelPhotoUrl } from "@/lib/media-utils";
import { useActiveOrganization } from "@/lib/auth-client";
import { SectionHeader } from "@/components/layout/page-layouts";
import { FadeIn, StaggerList, StaggerItem } from "@/components/ui/motion";

import { kitStatusLabels, formatLabel } from "@/lib/status-labels";

export default function CategoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: category, isLoading } = useServerQuery({
    queryKey: ["category", orgId, id],
    queryFn: () => getCategory(id),
  });

  if (isLoading) {
    return <DetailPageSkeleton />;
  }

  if (!category) {
    return <div className="text-fg-3 py-12 text-center">Category not found.</div>;
  }

  const parentHref = category.parent
    ? `/assets/categories/${category.parent.id}`
    : "/assets/categories";

  return (
    <div className="space-y-8">
      {/* Header */}
      <FadeIn>
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push(parentHref)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-sm text-fg-3 mb-1">
              <Link href="/assets/categories" className="hover:text-fg transition-colors">
                Categories
              </Link>
              {category.parent && (
                <>
                  <ChevronRight className="h-3 w-3" />
                  <Link
                    href={`/assets/categories/${category.parent.id}`}
                    className="hover:text-fg transition-colors"
                  >
                    {category.parent.name}
                  </Link>
                </>
              )}
              <ChevronRight className="h-3 w-3" />
              <span className="text-fg">{category.name}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-2xl">{category.icon || "\uD83D\uDCC1"}</span>
              <h1 className="t-title text-fg">{category.name}</h1>
            </div>
            {category.description && (
              <p className="text-fg-3 mt-1">{category.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {category._count.models > 0 && (
              <Badge variant="secondary" className="gap-1">
                <Boxes className="h-3 w-3" />
                {category._count.models} model{category._count.models !== 1 ? "s" : ""}
              </Badge>
            )}
            {category._count.kits > 0 && (
              <Badge variant="secondary" className="gap-1">
                <Container className="h-3 w-3" />
                {category._count.kits} kit{category._count.kits !== 1 ? "s" : ""}
              </Badge>
            )}
            {category._count.children > 0 && (
              <Badge variant="outline" className="gap-1">
                <FolderOpen className="h-3 w-3" />
                {category._count.children} subcategori{category._count.children !== 1 ? "es" : "y"}
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
                  className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors group"
                >
                  <span className="text-lg">{child.icon || "\uD83D\uDCC2"}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium group-hover:text-primary transition-colors">
                      {child.name}
                    </span>
                    <div className="flex items-center gap-2 mt-0.5">
                      {child._count.models > 0 && (
                        <span className="text-xs text-fg-3">{child._count.models} models</span>
                      )}
                      {child._count.kits > 0 && (
                        <span className="text-xs text-fg-3">{child._count.kits} kits</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-fg-3" />
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
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12"></TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead className="hidden sm:table-cell">Manufacturer</TableHead>
                      <TableHead className="hidden md:table-cell">Model Number</TableHead>
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
                              className="font-medium hover:text-primary transition-colors"
                            >
                              {model.name}
                            </Link>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-fg-3">
                            {model.manufacturer || "\u2014"}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-fg-3">
                            {model.modelNumber || "\u2014"}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant="secondary">{model._count.assets}</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </>
            ) : (
              <EmptyState
                preset="models"
                heading="No models in this category"
                description="Models group identical assets — create one to start adding units."
                action={{ label: "Add Model", onClick: () => window.location.href = "/assets/models/new" }}
              />
            )}
          </TabsContent>

          <TabsContent value="kits">
            {category.kits && category.kits.length > 0 ? (
              <>
                <SectionHeader label="Kits" className="mb-3" />
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kit</TableHead>
                      <TableHead className="hidden sm:table-cell">Asset Tag</TableHead>
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
                              className="font-medium hover:text-primary transition-colors"
                            >
                              {kit.name}
                            </Link>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-fg-3">
                            {kit.assetTag || "\u2014"}
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            {kit.status && (
                              <StatusIndicator category="kit" value={kit.status} label={kitStatusLabels[kit.status] || formatLabel(kit.status)} variant="pill" />
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant="secondary">{itemCount}</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </>
            ) : (
              <EmptyState
                preset="kits"
                heading="No kits in this category"
                description="Kits bundle assets that always go together — build one to speed up checkout."
                action={{ label: "Add Kit", onClick: () => window.location.href = "/kits/new" }}
              />
            )}
          </TabsContent>
        </Tabs>
      </FadeIn>
    </div>
  );
}
