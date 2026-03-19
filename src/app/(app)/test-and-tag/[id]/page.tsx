"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Zap, Pencil, ArchiveX, Trash2, Loader2 } from "lucide-react";

import { getTestTagAsset, retireTestTagAsset, deleteTestTagAsset } from "@/server/test-tag-assets";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { useActiveOrganization } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    CURRENT: { label: "Current", className: "bg-green-500/15 text-green-600 border-green-500/30" },
    DUE_SOON: { label: "Due Soon", className: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
    OVERDUE: { label: "Overdue", className: "bg-red-500/15 text-red-600 border-red-500/30" },
    FAILED: { label: "Failed", className: "bg-red-500/15 text-red-600 border-red-500/30 border-dashed" },
    NOT_YET_TESTED: { label: "Not Tested", className: "bg-muted text-muted-foreground" },
    RETIRED: { label: "Retired", className: "bg-muted text-muted-foreground opacity-60" },
  };
  const { label, className } = map[status] || { label: status, className: "" };
  return <Badge variant="outline" className={className}>{label}</Badge>;
}

const equipmentClassLabels: Record<string, string> = {
  CLASS_I: "Class I",
  CLASS_II: "Class II",
  CLASS_II_DOUBLE_INSULATED: "Class II (Double Insulated)",
  LEAD_CORD_ASSEMBLY: "Lead / Cord Assembly",
};

const applianceTypeLabels: Record<string, string> = {
  APPLIANCE: "Appliance",
  CORD_SET: "Cord Set",
  EXTENSION_LEAD: "Extension Lead",
  POWER_BOARD: "Power Board",
  RCD_PORTABLE: "RCD (Portable)",
  RCD_FIXED: "RCD (Fixed)",
  THREE_PHASE: "Three Phase",
  OTHER: "Other",
};

function formatDate(date: Date | string | null | undefined) {
  if (!date) return "\u2014";
  return new Date(date).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function resultBadge(result: string) {
  if (result === "PASS") return <Badge className="bg-green-600/20 text-green-400 border-green-600/30">Pass</Badge>;
  if (result === "FAIL") return <Badge variant="destructive">Fail</Badge>;
  if (result === "NOT_APPLICABLE") return <span className="text-muted-foreground text-xs">N/A</span>;
  return <span className="text-muted-foreground text-xs">{result}</span>;
}

export default function TestTagDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: item, isLoading, error } = useQuery({
    queryKey: ["test-tag-asset", orgId, id],
    queryFn: () => getTestTagAsset(id),
  });

  const retireMutation = useMutation({
    mutationFn: () => retireTestTagAsset(id),
    onSuccess: () => {
      toast.success("Test tag asset retired");
      queryClient.invalidateQueries({ queryKey: ["test-tag-asset", id] });
      queryClient.invalidateQueries({ queryKey: ["test-tag-assets"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTestTagAsset(id),
    onSuccess: () => {
      toast.success("Test tag asset deleted");
      queryClient.invalidateQueries({ queryKey: ["test-tag-assets"] });
      router.push("/test-and-tag/registry");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        {error ? error.message : "Test tag asset not found"}
      </div>
    );
  }

  return (
    <RequirePermission resource="testTag" action="read">
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="t-title text-fg">{item.testTagId}</h1>
            <StatusBadge status={item.status} />
          </div>
          <p className="text-muted-foreground">{item.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <CanDo resource="testTag" action="update">
            <Button
              render={<Link href={`/test-and-tag/quick-test?id=${item.testTagId}`} />}
            >
              <Zap className="mr-2 h-4 w-4" />
              Record Test
            </Button>
            <Button variant="outline" disabled>
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </Button>
            {item.status !== "RETIRED" && (
              <Button
                variant="outline"
                onClick={() => {
                  if (confirm("Are you sure you want to retire this test tag asset?")) {
                    retireMutation.mutate();
                  }
                }}
                disabled={retireMutation.isPending}
              >
                <ArchiveX className="mr-2 h-4 w-4" />
                {retireMutation.isPending ? "Retiring..." : "Retire"}
              </Button>
            )}
            {item.status === "RETIRED" && (
              <Button
                variant="destructive"
                onClick={() => {
                  if (confirm("Permanently delete this test tag asset and all its test records? This cannot be undone.")) {
                    deleteMutation.mutate();
                  }
                }}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </Button>
            )}
          </CanDo>
        </div>
      </div>

      {/* Details Card */}
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-sm text-muted-foreground">Equipment Class</dt>
              <dd className="font-medium">{equipmentClassLabels[item.equipmentClass] || item.equipmentClass}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Appliance Type</dt>
              <dd className="font-medium">{applianceTypeLabels[item.applianceType] || item.applianceType}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Make</dt>
              <dd className="font-medium">{item.make || "\u2014"}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Model</dt>
              <dd className="font-medium">{item.modelName || "\u2014"}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Serial Number</dt>
              <dd className="font-medium">{item.serialNumber || "\u2014"}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Location</dt>
              <dd className="font-medium">{item.location || "\u2014"}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Test Interval</dt>
              <dd className="font-medium">{item.testIntervalMonths} months</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Next Due Date</dt>
              <dd className="font-medium">{formatDate(item.nextDueDate)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Last Tested</dt>
              <dd className="font-medium">{formatDate(item.lastTestDate)}</dd>
            </div>
            {item.asset && (
              <div>
                <dt className="text-sm text-muted-foreground">Linked Asset</dt>
                <dd>
                  <Link
                    href={`/assets/registry/${item.asset.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {item.asset.assetTag}
                    {item.asset.customName ? ` - ${item.asset.customName}` : ""}
                  </Link>
                </dd>
              </div>
            )}
            {item.bulkAsset && (
              <div>
                <dt className="text-sm text-muted-foreground">Linked Bulk Asset</dt>
                <dd>
                  <Link
                    href={`/assets/registry/${item.bulkAsset.id}?type=bulk`}
                    className="font-medium text-primary hover:underline"
                  >
                    {item.bulkAsset.assetTag}
                  </Link>
                </dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* Test History */}
      <Card>
        <CardHeader>
          <CardTitle>Test History ({item._count.testRecords})</CardTitle>
        </CardHeader>
        <CardContent>
          {item.testRecords.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No test records yet. Record the first test to get started.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Test Date</TableHead>
                    <TableHead>Tester</TableHead>
                    <TableHead>Visual</TableHead>
                    <TableHead>Earth Cont.</TableHead>
                    <TableHead>Insulation</TableHead>
                    <TableHead>Leakage</TableHead>
                    <TableHead>Overall Result</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {item.testRecords.map((record: {
                    id: string;
                    testDate: string | Date;
                    testerName: string;
                    testedBy?: { id: string; name: string } | null;
                    visualInspectionResult: string;
                    earthContinuityResult: string;
                    insulationResult: string;
                    leakageCurrentResult: string;
                    result: string;
                    failureNotes?: string | null;
                    functionalTestNotes?: string | null;
                    visualNotes?: string | null;
                  }) => (
                    <TableRow key={record.id}>
                      <TableCell>{formatDate(record.testDate)}</TableCell>
                      <TableCell>{record.testedBy?.name || record.testerName}</TableCell>
                      <TableCell>{resultBadge(record.visualInspectionResult)}</TableCell>
                      <TableCell>{resultBadge(record.earthContinuityResult)}</TableCell>
                      <TableCell>{resultBadge(record.insulationResult)}</TableCell>
                      <TableCell>{resultBadge(record.leakageCurrentResult)}</TableCell>
                      <TableCell>{resultBadge(record.result)}</TableCell>
                      <TableCell className="max-w-48 truncate text-xs text-muted-foreground">
                        {record.failureNotes || record.functionalTestNotes || record.visualNotes || "\u2014"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
    </RequirePermission>
  );
}
