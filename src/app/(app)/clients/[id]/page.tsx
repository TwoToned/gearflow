"use client";

import { use } from "react";
import Link from "next/link";
import { PageMeta } from "@/components/layout/page-meta";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Archive, Mail, Phone, MapPin, FileText } from "lucide-react";
import { AddressDisplay } from "@/components/ui/address-display";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { getClient, archiveClient, updateClientNotes } from "@/server/clients";
import { projectStatusLabels, formatLabel } from "@/lib/status-labels";
import { useActiveOrganization } from "@/lib/auth-client";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { NotesEditor } from "@/components/ui/notes-editor";
import { addClientMedia, removeClientMedia } from "@/server/client-media";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MediaUploader, type MediaItem } from "@/components/media/media-uploader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const typeLabels: Record<string, string> = {
  COMPANY: "Company",
  INDIVIDUAL: "Individual",
  VENUE: "Venue",
  PRODUCTION_COMPANY: "Production Co.",
};

const typeColors: Record<string, string> = {
  COMPANY: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  INDIVIDUAL: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  VENUE: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  PRODUCTION_COMPANY: "bg-green-500/10 text-green-500 border-green-500/20",
};

const projectStatusColors: Record<string, string> = {
  ENQUIRY: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  QUOTED: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  CONFIRMED: "bg-green-500/10 text-green-500 border-green-500/20",
  PREPPING: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  CHECKED_OUT: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  ON_SITE: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  RETURNED: "bg-teal-500/10 text-teal-500 border-teal-500/20",
  IN_PROGRESS: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  COMPLETED: "bg-green-500/10 text-green-500 border-green-500/20",
  CANCELLED: "bg-red-500/10 text-red-500 border-red-500/20",
  INVOICED: "bg-purple-500/10 text-purple-500 border-purple-500/20",
};

export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: client, isLoading } = useQuery({
    queryKey: ["client", orgId, id],
    queryFn: () => getClient(id),
  });

  const archiveMutation = useMutation({
    mutationFn: () => archiveClient(id),
    onSuccess: () => {
      toast.success("Client archived");
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      router.push("/clients");
    },
  });

  if (isLoading) {
    return <DetailPageSkeleton />;
  }

  if (!client) {
    return <div className="text-muted-foreground py-12 text-center">Client not found.</div>;
  }

  return (
    <RequirePermission resource="client" action="read">
    <PageMeta title={client?.name} />
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="t-title text-fg">{client.name}</h1>
            <Badge variant="outline" className={typeColors[client.type] || ""}>
              {typeLabels[client.type] || client.type}
            </Badge>
            {!client.isActive && <Badge variant="destructive">Archived</Badge>}
          </div>
          <p className="text-muted-foreground">
            {client.contactName || "No primary contact"}
            {client.contactEmail && <> &middot; {client.contactEmail}</>}
          </p>
        </div>
        <CanDo resource="client" action="update">
          <div className="flex gap-2">
            <Button variant="outline" render={<Link href={`/clients/${id}/edit`} />}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </Button>
            {client.isActive && (
              <Button
                variant="outline"
                className="text-destructive"
                onClick={() => { if (confirm("Archive this client?")) archiveMutation.mutate(); }}
              >
                <Archive className="mr-2 h-4 w-4" />
                Archive
              </Button>
            )}
          </div>
        </CanDo>
      </div>

      {/* Info Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Contact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {client.contactName && (
              <div className="flex items-center gap-2">
                <span className="font-medium">{client.contactName}</span>
              </div>
            )}
            {client.contactEmail && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Mail className="h-3.5 w-3.5" />
                <a href={`mailto:${client.contactEmail}`} className="hover:underline">{client.contactEmail}</a>
              </div>
            )}
            {client.contactPhone && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="h-3.5 w-3.5" />
                <a href={`tel:${client.contactPhone}`} className="hover:underline">{client.contactPhone}</a>
              </div>
            )}
            {!client.contactName && !client.contactEmail && !client.contactPhone && (
              <p className="text-muted-foreground">No contact info</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Billing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>ABN</span>
              <span className="font-medium">{client.taxId || "\u2014"}</span>
            </div>
            <div className="flex justify-between">
              <span>Payment Terms</span>
              <span className="font-medium">{client.paymentTerms || "\u2014"}</span>
            </div>
            <div className="flex justify-between">
              <span>Default Discount</span>
              <span className="font-medium">
                {client.defaultDiscount != null ? `${Number(client.defaultDiscount)}%` : "\u2014"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Addresses</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {client.billingAddress && (
              <div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                  <MapPin className="h-3 w-3" />
                  Billing
                </div>
                <AddressDisplay
                  address={client.billingAddress}
                  latitude={client.billingLatitude}
                  longitude={client.billingLongitude}
                  label={`${client.name} — Billing`}
                  compact
                />
              </div>
            )}
            {client.shippingAddress && (
              <div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                  <MapPin className="h-3 w-3" />
                  Shipping
                </div>
                <AddressDisplay
                  address={client.shippingAddress}
                  latitude={client.shippingLatitude}
                  longitude={client.shippingLongitude}
                  label={`${client.name} — Shipping`}
                  compact
                />
              </div>
            )}
            {!client.billingAddress && !client.shippingAddress && (
              <p className="text-muted-foreground">No addresses</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="projects">
        <TabsList>
          <TabsTrigger value="projects">
            Projects ({client.projects.length})
          </TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="files">
            Files ({client.media?.length || 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="projects" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Recent Projects
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {client.projects.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No projects yet.</p>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project #</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Line Items</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {client.projects.map((project) => (
                        <TableRow key={project.id}>
                          <TableCell>
                            <Link href={`/projects/${project.id}`} className="font-mono text-sm font-medium hover:underline">
                              {project.projectNumber}
                            </Link>
                          </TableCell>
                          <TableCell>{project.name}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={projectStatusColors[project.status] || ""}>
                              {projectStatusLabels[project.status] || formatLabel(project.status)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">{project._count.lineItems}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {new Date(project.createdAt).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notes" className="mt-4">
          <NotesEditor
            initialNotes={client.notes || ""}
            queryKey={["client", orgId, id]}
            onSave={(notes) => updateClientNotes(id, notes)}
            placeholder="Add notes about this client..."
          />
        </TabsContent>

        <TabsContent value="files" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Files</CardTitle>
            </CardHeader>
            <CardContent>
              <MediaUploader
                entityType="client"
                entityId={id}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,image/*"
                existingMedia={(client.media || []).map((m: MediaItem) => m)}
                queryKey={["client", orgId, id]}
                onUploadComplete={async (fileUpload) => {
                  await addClientMedia({
                    clientId: id,
                    fileId: fileUpload.id,
                  });
                }}
                onRemove={async (mediaId) => {
                  await removeClientMedia(mediaId);
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
    </RequirePermission>
  );
}
