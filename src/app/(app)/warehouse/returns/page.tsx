"use client";
// use-client: session-local scan/return state + a one-shot (not live) board fetch
// (R-8.1.1). See useReturnsBoard's doc comment for why this is deliberately NOT a
// whole-org reactive subscription.
//
// ⚠️ Route collision note (issue #944 WS5): this is a STATIC segment
// (`/warehouse/returns`), and `/warehouse/[projectId]` is a DYNAMIC segment one
// level up. Next.js's router always prefers a static route over a dynamic sibling
// at the same depth, so `/warehouse/returns` never falls into
// `[projectId]="returns"` — but if an org ever imports/creates a project whose
// CUID happens to render as the literal string "returns" (vanishingly unlikely —
// project ids are cuid2, not human-chosen slugs), that project's own detail page
// becomes permanently unreachable at this path. Flagged here rather than fixed:
// project ids are never user-chosen, so there's no real path to this colliding in
// practice, and "reserve one more cuid-shaped word forever" isn't worth doing for
// a theoretical collision. If it ever needs fixing, the answer is namespacing new
// static warehouse routes under something no cuid can produce.

import { useCallback, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  RefreshCw,
  ScanBarcode,
  Undo2,
  AlertTriangle,
  Wrench,
  ChevronDown,
  CheckSquare,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import { useActiveOrganization } from "@/lib/auth-client";
import { useReturnsBoard, useReturnsWrites, useResolveScan, useLineUnits } from "@/hooks/use-returns";
import { useWarehouseWrites } from "@/hooks/use-warehouse-writes";
import { useCanDo } from "@/lib/use-permissions";
import { useScanFeedback } from "@/hooks/use-scan-feedback";
import { ScanAudioToggle } from "@/components/scan-audio-toggle";
import { AssetTagInput } from "@/components/ui/asset-tag-input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RequirePermission } from "@/components/auth/require-permission";
import { focusRing } from "@/lib/utils";

type ReturnCondition = "GOOD" | "DAMAGED" | "MISSING";

type SessionRow = {
  key: string;
  lineItemId: string;
  assetId?: string;
  bulkAssetId?: string;
  unitId?: string;
  tag: string;
  label: string;
  projectId: string;
  projectName: string;
  projectNumber: string;
  condition: ReturnCondition;
  notes?: string;
};

type ExceptionRow = {
  key: string;
  tag: string;
  reason: string;
  detail?: string;
};

type AssetDeployment = { lineItemId: string; unitId: string; projectId: string; projectName: string; projectNumber: string };
type BulkDeployment = { projectId: string; projectName: string; projectNumber: string; outstanding: number };
type KitDeployment = { lineItemId: string; projectId: string; projectName: string; projectNumber: string };

type Disambiguation =
  | { kind: "asset"; assetId: string; assetTag: string; assetName: string; deployments: AssetDeployment[] }
  | { kind: "bulk"; bulkAssetId: string; assetTag: string; assetName: string; deployments: BulkDeployment[] }
  | { kind: "kit"; kitId: string; assetTag: string; assetName: string; deployments: KitDeployment[] };

function urgencyBadge(urgency: string): React.ReactNode {
  if (urgency === "overdue") return <Badge status="overbooked">Overdue</Badge>;
  if (urgency === "today") return <Badge status="warn">Today / tomorrow</Badge>;
  return null;
}

export default function ReturnsStationPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: board, isLoading, refetch } = useReturnsBoard(orgId);
  const writes = useReturnsWrites();
  const kitWrites = useWarehouseWrites();
  const resolveScan = useResolveScan();
  const fetchUnits = useLineUnits();
  const canRaiseRepair = useCanDo("maintenance", "create");
  const scanFeedback = useScanFeedback();

  const [scanValue, setScanValue] = useState("");
  const [scanning, setScanning] = useState(false);
  const [sessionRows, setSessionRows] = useState<SessionRow[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [disambiguation, setDisambiguation] = useState<Disambiguation | null>(null);
  const [bulkQty, setBulkQty] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedLine, setExpandedLine] = useState<string | null>(null);
  const [lineUnits, setLineUnits] = useState<Record<string, Array<{ unitId: string; assetTag: string | null; outstanding: number }>>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const pushException = useCallback((tag: string, reason: string, detail?: string) => {
    setExceptions((prev) => [{ key: `${tag}-${Date.now()}`, tag, reason, detail }, ...prev]);
    scanFeedback.play("exception");
  }, [scanFeedback]);

  const recordReturn = useCallback((row: Omit<SessionRow, "key">) => {
    setSessionRows((prev) => [{ ...row, key: `${row.lineItemId}-${Date.now()}` }, ...prev]);
    scanFeedback.play("success");
  }, [scanFeedback]);

  const handleScan = useCallback(
    async (rawValue: string) => {
      const value = rawValue.trim();
      if (!value || !orgId || scanning) return;
      setScanning(true);
      try {
        const res = await resolveScan(orgId, value);
        switch (res.kind) {
          case "not_found":
            pushException(value, "Unknown tag — not found in this organisation");
            break;
          case "guard_kit_member":
            pushException(res.assetTag, "Part of a kit — scan the kit instead", res.kitAssetTag ? `Kit ${res.kitAssetTag}` : undefined);
            break;
          case "guard_accessory_child":
            pushException(res.assetTag, "Permanent accessory — returns with its parent", res.parentAssetTag ? `Parent ${res.parentAssetTag}` : undefined);
            break;
          case "exception":
            pushException(
              res.assetTag,
              res.reason === "retired" ? "Retired — not returnable" : res.reason === "no_active_deployment" ? "Not currently checked out anywhere" : "No active deployment",
            );
            break;
          case "asset": {
            await writes.returnScan({ lineItemId: res.lineItemId, assetId: res.assetId });
            recordReturn({
              lineItemId: res.lineItemId, assetId: res.assetId, unitId: res.unitId, tag: res.assetTag, label: res.assetName,
              projectId: res.projectId, projectName: res.projectName, projectNumber: res.projectNumber, condition: "GOOD",
            });
            void refetch();
            break;
          }
          case "bulk": {
            // Single project — return the full outstanding quantity directly.
            await writes.returnBulk({ bulkAssetId: res.bulkAssetId, projectId: res.projectId, quantity: res.outstanding });
            recordReturn({
              lineItemId: res.bulkAssetId, bulkAssetId: res.bulkAssetId, tag: res.assetTag, label: res.assetName,
              projectId: res.projectId, projectName: res.projectName, projectNumber: res.projectNumber, condition: "GOOD",
            });
            void refetch();
            break;
          }
          case "kit": {
            await kitWrites.checkInKit(res.projectId, res.kitId, "GOOD");
            recordReturn({
              lineItemId: res.lineItemId, tag: res.assetTag, label: res.assetName,
              projectId: res.projectId, projectName: res.projectName, projectNumber: res.projectNumber, condition: "GOOD",
            });
            void refetch();
            break;
          }
          case "asset_multi":
            setDisambiguation({ kind: "asset", assetId: res.assetId, assetTag: res.assetTag, assetName: res.assetName, deployments: res.deployments });
            break;
          case "bulk_multi": {
            const initial: Record<string, number> = {};
            for (const d of res.deployments) initial[d.projectId] = d.outstanding;
            setBulkQty(initial);
            setDisambiguation({ kind: "bulk", bulkAssetId: res.bulkAssetId, assetTag: res.assetTag, assetName: res.assetName, deployments: res.deployments });
            break;
          }
          case "kit_multi":
            setDisambiguation({ kind: "kit", kitId: res.kitId, assetTag: res.assetTag, assetName: res.assetName, deployments: res.deployments });
            break;
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Scan failed");
        scanFeedback.play("error");
      } finally {
        setScanning(false);
        setScanValue("");
        inputRef.current?.focus();
      }
    },
    [orgId, scanning, resolveScan, writes, kitWrites, pushException, recordReturn, refetch, scanFeedback],
  );

  // ── Disambiguation resolution ──────────────────────────────────────────
  const resolveAssetDeployment = useCallback(
    async (d: Extract<Disambiguation, { kind: "asset" }>, dep: AssetDeployment) => {
      try {
        await writes.returnScan({ lineItemId: dep.lineItemId, assetId: d.assetId });
        recordReturn({ lineItemId: dep.lineItemId, assetId: d.assetId, unitId: dep.unitId, tag: d.assetTag, label: d.assetName, projectId: dep.projectId, projectName: dep.projectName, projectNumber: dep.projectNumber, condition: "GOOD" });
        void refetch();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Return failed");
      } finally {
        setDisambiguation(null);
      }
    },
    [writes, recordReturn, refetch],
  );

  const resolveKitDeployment = useCallback(
    async (d: Extract<Disambiguation, { kind: "kit" }>, dep: KitDeployment) => {
      try {
        await kitWrites.checkInKit(dep.projectId, d.kitId, "GOOD");
        recordReturn({ lineItemId: dep.lineItemId, tag: d.assetTag, label: d.assetName, projectId: dep.projectId, projectName: dep.projectName, projectNumber: dep.projectNumber, condition: "GOOD" });
        void refetch();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Return failed");
      } finally {
        setDisambiguation(null);
      }
    },
    [kitWrites, recordReturn, refetch],
  );

  // ── Board scan/select actions ──────────────────────────────────────────
  const toggleExpand = useCallback(
    async (lineItemId: string) => {
      if (expandedLine === lineItemId) {
        setExpandedLine(null);
        return;
      }
      setExpandedLine(lineItemId);
      if (!orgId || lineUnits[lineItemId]) return;
      const units = await fetchUnits(orgId, lineItemId);
      setLineUnits((prev) => ({ ...prev, [lineItemId]: units }));
    },
    [expandedLine, orgId, lineUnits, fetchUnits],
  );

  const toggleSelected = useCallback((lineItemId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(lineItemId)) next.delete(lineItemId);
      else next.add(lineItemId);
      return next;
    });
  }, []);

  const returnLine = useCallback(
    async (lineItemId: string, tag: string, label: string, projectId: string, projectName: string, projectNumber: string) => {
      try {
        await writes.returnScan({ lineItemId });
        recordReturn({ lineItemId, tag, label, projectId, projectName, projectNumber, condition: "GOOD" });
        void refetch();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Return failed");
      }
    },
    [writes, recordReturn, refetch],
  );

  const returnSelectedBatch = useCallback(async () => {
    if (selected.size === 0 || !board) return;
    const items = board.projects.flatMap((p) => p.lines.filter((l) => selected.has(l.lineItemId) && l.scannable).map((l) => ({ lineItemId: l.lineItemId, tag: l.lineItemId, label: l.description, projectId: p.projectId, projectName: p.projectName, projectNumber: p.projectNumber })));
    if (items.length === 0) return;
    try {
      const results = await writes.returnBatch(items.map((i) => ({ lineItemId: i.lineItemId })));
      for (const r of results) {
        const src = items.find((i) => i.lineItemId === r.lineItemId);
        if (!src) continue;
        if (r.success) {
          recordReturn({ lineItemId: r.lineItemId, tag: src.tag, label: src.label, projectId: src.projectId, projectName: src.projectName, projectNumber: src.projectNumber, condition: "GOOD" });
        } else {
          pushException(src.tag, r.error ?? "Return failed");
        }
      }
      setSelected(new Set());
      void refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Batch return failed");
    }
  }, [selected, board, writes, recordReturn, pushException, refetch]);

  // ── Post-hoc condition correction ──────────────────────────────────────
  const markCondition = useCallback(
    async (row: SessionRow, condition: ReturnCondition) => {
      try {
        await writes.correctCondition({ lineItemId: row.lineItemId, assetId: row.assetId, unitId: row.unitId, returnCondition: condition });
        setSessionRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, condition } : r)));
        toast.success(`Marked ${condition.toLowerCase()}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not update condition");
      }
    },
    [writes],
  );

  const raiseRepair = useCallback(
    async (row: SessionRow) => {
      if (!row.assetId) {
        toast.error("Raise repair needs a specific serialised asset");
        return;
      }
      try {
        await writes.raiseRepair({ assetId: row.assetId, projectId: row.projectId, modelName: row.label, assetTag: row.tag, returnNotes: row.notes });
        toast.success("Repair raised");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not raise repair");
      }
    },
    [writes],
  );

  const totalOutstanding = useMemo(
    () => (board?.projects.reduce((sum, p) => sum + p.lines.reduce((s, l) => s + l.outstanding, 0), 0) ?? 0),
    [board],
  );

  return (
    <RequirePermission resource="warehouse" action="read">
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-teal-soft px-2.5 py-1 text-[11px] font-semibold tracking-[0.02em] text-teal">
              <Undo2 className="h-3.5 w-3.5" />
              Warehouse
            </span>
            <h1 className="t-title text-ink">Returns</h1>
            <p className="t-body text-muted">
              Everything out, org-wide — scan a tag to return it. No project to pick first.
            </p>
          </div>
          <ScanAudioToggle enabled={scanFeedback.enabled} onToggle={scanFeedback.toggle} />
        </div>

        {/* ── Scan bar ─────────────────────────────────────────────────── */}
        <div className="rounded-[var(--r-lg)] border border-line bg-card p-3 shadow-[var(--sh-card)] sm:p-4">
          <div className="relative">
            <ScanBarcode className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-teal" />
            <AssetTagInput
              ref={inputRef}
              placeholder="Scan any asset, bulk, or kit tag…"
              value={scanValue}
              onChange={(e) => setScanValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleScan(scanValue);
              }}
              disabled={scanning}
              className="h-12 rounded-[var(--r)] border-line-2 bg-paper-2 pl-12 pr-24 text-[14px] text-ink placeholder:text-faint"
              autoFocus
            />
            {scanning && (
              <Loader2 className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-faint" />
            )}
          </div>
        </div>

        {/* ── Exceptions — session-local, never blocks the dock ───────────── */}
        {exceptions.length > 0 && (
          <div className="rounded-[var(--r-lg)] border border-line bg-card shadow-[var(--sh-card)]">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
              <AlertTriangle className="h-4 w-4 text-warn" />
              <h2 className="t-heading text-ink">Exceptions ({exceptions.length})</h2>
            </div>
            <ul className="divide-y divide-line">
              {exceptions.map((x) => (
                <li key={x.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div>
                    <p className="t-body font-medium text-ink">{x.tag}</p>
                    <p className="t-micro text-muted">{x.reason}{x.detail ? ` — ${x.detail}` : ""}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Session list — items returned this session ──────────────────── */}
        {sessionRows.length > 0 && (
          <div className="rounded-[var(--r-lg)] border border-line bg-card shadow-[var(--sh-card)]">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
              <CheckSquare className="h-4 w-4 text-ok" />
              <h2 className="t-heading text-ink">Returned this session ({sessionRows.length})</h2>
            </div>
            <ul className="divide-y divide-line">
              {sessionRows.map((row) => (
                <li key={row.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                  <div>
                    <p className="t-body font-medium text-ink">{row.label} <span className="t-mono text-muted">{row.tag}</span></p>
                    <p className="t-micro text-muted">{row.projectName} ({row.projectNumber})</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge status={row.condition === "GOOD" ? "ok" : row.condition === "DAMAGED" ? "repair" : "overbooked"}>
                      {row.condition}
                    </Badge>
                    {row.condition === "GOOD" && (
                      <>
                        <Button size="sm" variant="line" onClick={() => void markCondition(row, "DAMAGED")}>Mark damaged</Button>
                        <Button size="sm" variant="line" onClick={() => void markCondition(row, "MISSING")}>Mark missing</Button>
                      </>
                    )}
                    {row.condition === "DAMAGED" && canRaiseRepair && (
                      <Button size="sm" variant="line" onClick={() => void raiseRepair(row)}>
                        <Wrench className="mr-1 h-3.5 w-3.5" />
                        Raise repair
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Board ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <h2 className="t-heading text-ink">Everything out {totalOutstanding > 0 ? `(${totalOutstanding})` : ""}</h2>
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <Button size="sm" onClick={() => void returnSelectedBatch()}>
                Return {selected.size} selected
              </Button>
            )}
            <Button size="sm" variant="line" onClick={() => void refetch()} aria-label="Refresh">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {!isLoading && board && board.projects.length === 0 && (
          <EmptyState title="Nothing out" description="Every job is back on the shelf." />
        )}

        {!isLoading && board && board.projects.length > 0 && (
          <div className="space-y-4">
            {board.truncated && (
              <p className="t-micro text-warn">Showing a capped subset of the org&apos;s outstanding gear — refine or return some before loading the rest.</p>
            )}
            {board.projects.map((project) => (
              <div key={project.projectId} className="rounded-[var(--r-lg)] border border-line bg-card shadow-[var(--sh-card)]">
                <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <p className="t-heading text-ink">{project.projectName}</p>
                    <span className="t-micro text-muted">{project.projectNumber}</span>
                  </div>
                  {urgencyBadge(project.urgency)}
                </div>
                <ul className="divide-y divide-line">
                  {project.lines.map((line) => (
                    <li key={line.lineItemId}>
                      <div className="flex items-center gap-3 px-4 py-2.5">
                        {line.scannable ? (
                          <Checkbox checked={selected.has(line.lineItemId)} onCheckedChange={() => toggleSelected(line.lineItemId)} aria-label={`Select ${line.description}`} />
                        ) : (
                          <span className="w-5" />
                        )}
                        <button
                          type="button"
                          className={`flex flex-1 items-center justify-between gap-2 text-left ${focusRing}`}
                          onClick={() => void toggleExpand(line.lineItemId)}
                        >
                          <div>
                            <p className="t-body font-medium text-ink">{line.description}</p>
                            <p className="t-micro text-muted">
                              {line.kind === "generic" ? `${line.outstanding} deployed — no serials recorded` : `${line.outstanding} outstanding`}
                              {line.kitAssetTag ? ` — kit ${line.kitAssetTag}` : ""}
                            </p>
                          </div>
                          <ChevronDown className={`h-4 w-4 text-faint transition-transform ${expandedLine === line.lineItemId ? "rotate-180" : ""}`} />
                        </button>
                        {line.scannable && (
                          <Button
                            size="sm"
                            variant="line"
                            onClick={() =>
                              void returnLine(line.lineItemId, line.lineItemId, line.description, project.projectId, project.projectName, project.projectNumber)
                            }
                          >
                            Return
                          </Button>
                        )}
                        {line.kind === "kit" && line.kitId && (
                          <Button
                            size="sm"
                            variant="line"
                            onClick={async () => {
                              try {
                                await kitWrites.checkInKit(project.projectId, line.kitId!, "GOOD");
                                recordReturn({ lineItemId: line.lineItemId, tag: line.kitAssetTag ?? line.kitId!, label: line.description, projectId: project.projectId, projectName: project.projectName, projectNumber: project.projectNumber, condition: "GOOD" });
                                void refetch();
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : "Return failed");
                              }
                            }}
                          >
                            Return kit
                          </Button>
                        )}
                      </div>
                      {expandedLine === line.lineItemId && (
                        <div className="border-t border-line bg-paper-2 px-4 py-2">
                          {line.accessories.length > 0 && (
                            <div className="mb-2 flex flex-wrap gap-1.5">
                              {line.accessories.map((acc) => (
                                <span key={acc.lineItemId} className="rounded-full bg-paper px-2 py-0.5 text-[11px] text-muted">
                                  {acc.description} ({acc.outstanding})
                                </span>
                              ))}
                            </div>
                          )}
                          {!lineUnits[line.lineItemId] ? (
                            <Skeleton className="h-6 w-32" />
                          ) : lineUnits[line.lineItemId].length === 0 ? (
                            <p className="t-micro text-faint">No serials recorded for this line.</p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {lineUnits[line.lineItemId].map((u) => (
                                <span key={u.unitId} className="t-mono rounded-full border border-line-2 px-2 py-0.5 text-[11px] text-ink-2">
                                  {u.assetTag ?? u.unitId}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {/* ── Disambiguation dialog — never auto-pick ─────────────────────── */}
        <Dialog open={!!disambiguation} onOpenChange={(open) => !open && setDisambiguation(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Which project?</DialogTitle>
              <DialogDescription>
                {disambiguation?.assetTag} is checked out on more than one project — pick which one this return is for.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              {disambiguation?.kind === "asset" &&
                disambiguation.deployments.map((dep) => (
                  <button
                    key={dep.lineItemId}
                    type="button"
                    className={`flex w-full items-center justify-between rounded-[var(--r)] border border-line-2 px-3 py-2 text-left hover:bg-paper-2 ${focusRing}`}
                    onClick={() => void resolveAssetDeployment(disambiguation, dep)}
                  >
                    <span>{dep.projectName} ({dep.projectNumber})</span>
                    <ArrowRight className="h-4 w-4 text-faint" />
                  </button>
                ))}
              {disambiguation?.kind === "kit" &&
                disambiguation.deployments.map((dep) => (
                  <button
                    key={dep.lineItemId}
                    type="button"
                    className={`flex w-full items-center justify-between rounded-[var(--r)] border border-line-2 px-3 py-2 text-left hover:bg-paper-2 ${focusRing}`}
                    onClick={() => void resolveKitDeployment(disambiguation, dep)}
                  >
                    <span>{dep.projectName} ({dep.projectNumber})</span>
                    <ArrowRight className="h-4 w-4 text-faint" />
                  </button>
                ))}
              {disambiguation?.kind === "bulk" &&
                disambiguation.deployments.map((dep) => (
                  <div key={dep.projectId} className="flex items-center justify-between gap-2 rounded-[var(--r)] border border-line-2 px-3 py-2">
                    <div>
                      <p className="t-body text-ink">{dep.projectName} ({dep.projectNumber})</p>
                      <p className="t-micro text-muted">{dep.outstanding} outstanding</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        max={dep.outstanding}
                        value={bulkQty[dep.projectId] ?? dep.outstanding}
                        onChange={(e) => setBulkQty((prev) => ({ ...prev, [dep.projectId]: Number(e.target.value) }))}
                        className="w-16 rounded-[var(--r)] border border-line-2 bg-paper-2 px-2 py-1 text-right"
                      />
                      <Button
                        size="sm"
                        onClick={async () => {
                          const qty = bulkQty[dep.projectId] ?? dep.outstanding;
                          try {
                            await writes.returnBulk({ bulkAssetId: disambiguation.bulkAssetId, projectId: dep.projectId, quantity: qty });
                            recordReturn({ lineItemId: disambiguation.bulkAssetId, bulkAssetId: disambiguation.bulkAssetId, tag: disambiguation.assetTag, label: disambiguation.assetName, projectId: dep.projectId, projectName: dep.projectName, projectNumber: dep.projectNumber, condition: "GOOD" });
                            void refetch();
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Return failed");
                          } finally {
                            setDisambiguation(null);
                          }
                        }}
                      >
                        Return
                      </Button>
                    </div>
                  </div>
                ))}
            </div>
            <DialogFooter>
              <Button variant="line" onClick={() => setDisambiguation(null)}>Cancel</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </RequirePermission>
  );
}
