"use client";

import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Link from "next/link";
import { lookupTestTagAsset, createTestTagAsset } from "@/server/test-tag-assets";
import { createTestTagRecord } from "@/server/test-tag-records";
import { getOrganization } from "@/server/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScanInput } from "@/components/ui/scan-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShieldCheck, ArrowLeft, Check, X, Volume2, Loader2 } from "lucide-react";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { useActiveOrganization } from "@/lib/auth-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionLogEntry {
  testTagId: string;
  description: string;
  result: "PASS" | "FAIL";
  testDate: Date;
}

interface TestTagItem {
  id: string;
  testTagId: string;
  description: string;
  equipmentClass: string;
  applianceType: string;
  status: string;
  testIntervalMonths: number;
  make?: string | null;
  modelName?: string | null;
  serialNumber?: string | null;
  location?: string | null;
  lastTestDate?: string | Date | null;
  nextDueDate?: string | Date | null;
  testRecords?: Array<{
    id: string;
    testDate: string | Date;
    result: string;
    testedBy?: { id: string; name: string } | null;
  }>;
  asset?: { id: string; assetTag: string; customName?: string | null } | null;
  bulkAsset?: { id: string; assetTag: string } | null;
}

// ---------------------------------------------------------------------------
// Audio feedback
// ---------------------------------------------------------------------------

function playBeep(success: boolean) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = success ? 800 : 300;
    gain.gain.value = 0.1;
    osc.start();
    osc.stop(ctx.currentTime + (success ? 0.15 : 0.4));
  } catch {
    /* ignore if audio not available */
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EQUIPMENT_CLASSES = [
  { value: "CLASS_I", label: "Class I" },
  { value: "CLASS_II", label: "Class II" },
  { value: "CLASS_II_DOUBLE_INSULATED", label: "Class II (Double Insulated)" },
  { value: "LEAD_CORD_ASSEMBLY", label: "Lead / Cord Assembly" },
];

const APPLIANCE_TYPES = [
  { value: "APPLIANCE", label: "Appliance" },
  { value: "CORD_SET", label: "Cord Set" },
  { value: "EXTENSION_LEAD", label: "Extension Lead" },
  { value: "POWER_BOARD", label: "Power Board" },
  { value: "RCD_PORTABLE", label: "RCD (Portable)" },
  { value: "RCD_FIXED", label: "RCD (Fixed)" },
  { value: "THREE_PHASE", label: "Three Phase" },
  { value: "OTHER", label: "Other" },
];

const FAILURE_ACTIONS = [
  { value: "NONE", label: "None" },
  { value: "REPAIRED", label: "Repaired" },
  { value: "REMOVED_FROM_SERVICE", label: "Removed from Service" },
  { value: "DISPOSED", label: "Disposed" },
  { value: "REFERRED_TO_ELECTRICIAN", label: "Referred to Electrician" },
];

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "Never";
  const date = new Date(d);
  return date.toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function isCordLikeType(type: string): boolean {
  return ["CORD_SET", "EXTENSION_LEAD", "POWER_BOARD"].includes(type);
}

function isRcdType(type: string): boolean {
  return ["RCD_PORTABLE", "RCD_FIXED"].includes(type);
}

// ---------------------------------------------------------------------------
// Inner page (needs useSearchParams)
// ---------------------------------------------------------------------------

function QuickTestInner() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const scanInputRef = useRef<HTMLInputElement>(null);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // Org settings for default tester name, etc.
  const orgQuery = useQuery({
    queryKey: ["organization", orgId],
    queryFn: () => getOrganization(),
    staleTime: 60_000,
  });

  const orgSettings = orgQuery.data?.settings;

  // ---- State ----
  const [scanInput, setScanInput] = useState("");
  const [currentItem, setCurrentItem] = useState<TestTagItem | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [sessionLog, setSessionLog] = useState<SessionLogEntry[]>([]);

  // New item form
  const [newDescription, setNewDescription] = useState("");
  const [newEquipmentClass, setNewEquipmentClass] = useState("CLASS_I");
  const [newApplianceType, setNewApplianceType] = useState("APPLIANCE");

  // Visual inspections
  const [visualCordCondition, setVisualCordCondition] = useState(false);
  const [visualPlugCondition, setVisualPlugCondition] = useState(false);
  const [visualHousingCondition, setVisualHousingCondition] = useState(false);
  const [visualSwitchCondition, setVisualSwitchCondition] = useState(false);
  const [visualVentsUnobstructed, setVisualVentsUnobstructed] = useState(false);
  const [visualCordGrip, setVisualCordGrip] = useState(false);
  const [visualEarthPin, setVisualEarthPin] = useState(false);
  const [visualMarkingsLegible, setVisualMarkingsLegible] = useState(false);
  const [visualNoModifications, setVisualNoModifications] = useState(false);

  // Electrical tests
  const [testMethod, setTestMethod] = useState<"INSULATION_RESISTANCE" | "LEAKAGE_CURRENT" | "BOTH">("INSULATION_RESISTANCE");
  const [earthContinuityReading, setEarthContinuityReading] = useState("");
  const [insulationReading, setInsulationReading] = useState("");
  const [leakageCurrentReading, setLeakageCurrentReading] = useState("");
  const [polarityPass, setPolarityPass] = useState(false);
  const [rcdTripTimeReading, setRcdTripTimeReading] = useState("");

  // Failure
  const [failureAction, setFailureAction] = useState("NONE");
  const [failureNotes, setFailureNotes] = useState("");

  // Tester name
  const [testerName, setTesterName] = useState("");

  // Set defaults from org settings
  useEffect(() => {
    if (orgSettings?.testTag) {
      if (orgSettings.testTag.defaultTesterName && !testerName) {
        setTesterName(orgSettings.testTag.defaultTesterName);
      }
      if (orgSettings.testTag.defaultTestMethod) {
        setTestMethod(orgSettings.testTag.defaultTestMethod);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSettings]);

  // ---- Derived values ----
  const equipmentClass = currentItem?.equipmentClass ?? "CLASS_I";
  const applianceType = currentItem?.applianceType ?? "APPLIANCE";
  const isLead = equipmentClass === "LEAD_CORD_ASSEMBLY";
  const isClassI = equipmentClass === "CLASS_I" || isLead;
  const showPolarity = isLead || (equipmentClass === "CLASS_I" && isCordLikeType(applianceType));
  const showRcd = isRcdType(applianceType);

  // Auto-calculate pass/fail for individual electrical tests
  const earthContinuityPass = earthContinuityReading !== ""
    ? parseFloat(earthContinuityReading) < 1.0
    : null;

  const insulationPass = insulationReading !== ""
    ? parseFloat(insulationReading) >= 1.0
    : null;

  const leakageLimit = isClassI ? 5.0 : 1.0;
  const leakagePass = leakageCurrentReading !== ""
    ? parseFloat(leakageCurrentReading) <= leakageLimit
    : null;

  const rcdTripTimePass = rcdTripTimeReading !== ""
    ? parseFloat(rcdTripTimeReading) <= 300
    : null;

  // Visual pass: all checked visuals pass
  const allVisualChecks = [
    visualCordCondition,
    visualPlugCondition,
    visualHousingCondition,
    visualSwitchCondition,
    visualVentsUnobstructed,
    visualCordGrip,
    ...(isClassI ? [visualEarthPin] : []),
    visualMarkingsLegible,
    visualNoModifications,
  ];
  const visualPass = allVisualChecks.every(Boolean);

  // Overall result
  const computeOverallResult = useCallback((): "PASS" | "FAIL" => {
    if (!visualPass) return "FAIL";

    // Earth continuity (Class I only)
    if (isClassI && earthContinuityReading !== "" && !earthContinuityPass) return "FAIL";

    // Insulation resistance
    if ((testMethod === "INSULATION_RESISTANCE" || testMethod === "BOTH") && insulationReading !== "" && !insulationPass) return "FAIL";

    // Leakage current
    if ((testMethod === "LEAKAGE_CURRENT" || testMethod === "BOTH") && leakageCurrentReading !== "" && !leakagePass) return "FAIL";

    // Polarity
    if (showPolarity && !polarityPass) return "FAIL";

    // RCD
    if (showRcd && rcdTripTimeReading !== "" && !rcdTripTimePass) return "FAIL";

    return "PASS";
  }, [
    visualPass, isClassI, earthContinuityReading, earthContinuityPass,
    testMethod, insulationReading, insulationPass,
    leakageCurrentReading, leakagePass, showPolarity, polarityPass,
    showRcd, rcdTripTimeReading, rcdTripTimePass,
  ]);

  const overallResult = currentItem ? computeOverallResult() : null;

  // ---- Reset form ----
  const resetForm = useCallback(() => {
    setCurrentItem(null);
    setIsCreatingNew(false);
    setScanInput("");
    setNewDescription("");
    setNewEquipmentClass("CLASS_I");
    setNewApplianceType("APPLIANCE");
    setVisualCordCondition(false);
    setVisualPlugCondition(false);
    setVisualHousingCondition(false);
    setVisualSwitchCondition(false);
    setVisualVentsUnobstructed(false);
    setVisualCordGrip(false);
    setVisualEarthPin(false);
    setVisualMarkingsLegible(false);
    setVisualNoModifications(false);
    setEarthContinuityReading("");
    setInsulationReading("");
    setLeakageCurrentReading("");
    setPolarityPass(false);
    setRcdTripTimeReading("");
    setFailureAction("NONE");
    setFailureNotes("");
    setTimeout(() => scanInputRef.current?.focus(), 50);
  }, []);

  // ---- Mutations ----
  const lookupMutation = useMutation({
    mutationFn: (tagId: string) => lookupTestTagAsset(tagId),
    onSuccess: (item) => {
      if (item) {
        setCurrentItem(item as unknown as TestTagItem);
        setIsCreatingNew(false);
        playBeep(true);
      } else {
        setIsCreatingNew(true);
        setCurrentItem(null);
        playBeep(false);
      }
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const createItemMutation = useMutation({
    mutationFn: () =>
      createTestTagAsset({
        testTagId: scanInput.trim(),
        description: newDescription,
        equipmentClass: newEquipmentClass,
        applianceType: newApplianceType,
      }),
    onSuccess: (item) => {
      const created = item as unknown as TestTagItem;
      setCurrentItem(created);
      setIsCreatingNew(false);
      toast.success(`Created ${created.testTagId}`);
      playBeep(true);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const saveRecordMutation = useMutation({
    mutationFn: (result: "PASS" | "FAIL") => {
      if (!currentItem) throw new Error("No item loaded");

      const testDate = new Date();
      const nextDueDate = addMonths(testDate, currentItem.testIntervalMonths || 3);

      const visualInspectionResult = visualPass ? "PASS" as const : "FAIL" as const;

      // Build electrical results
      let earthResult: "PASS" | "FAIL" | "NOT_APPLICABLE" = "NOT_APPLICABLE";
      let insulationResult: "PASS" | "FAIL" | "NOT_APPLICABLE" = "NOT_APPLICABLE";
      let leakageResult: "PASS" | "FAIL" | "NOT_APPLICABLE" = "NOT_APPLICABLE";
      let polarityResult: "PASS" | "FAIL" | "NOT_APPLICABLE" = "NOT_APPLICABLE";
      let rcdResult: "PASS" | "FAIL" | "NOT_APPLICABLE" = "NOT_APPLICABLE";

      if (isClassI && earthContinuityReading !== "") {
        earthResult = earthContinuityPass ? "PASS" : "FAIL";
      }
      if ((testMethod === "INSULATION_RESISTANCE" || testMethod === "BOTH") && insulationReading !== "") {
        insulationResult = insulationPass ? "PASS" : "FAIL";
      }
      if ((testMethod === "LEAKAGE_CURRENT" || testMethod === "BOTH") && leakageCurrentReading !== "") {
        leakageResult = leakagePass ? "PASS" : "FAIL";
      }
      if (showPolarity) {
        polarityResult = polarityPass ? "PASS" : "FAIL";
      }
      if (showRcd && rcdTripTimeReading !== "") {
        rcdResult = rcdTripTimePass ? "PASS" : "FAIL";
      }

      return createTestTagRecord({
        testTagAssetId: currentItem.id,
        testDate,
        testerName: testerName || "Unknown",
        result,
        visualInspectionResult,
        visualCordCondition,
        visualPlugCondition,
        visualHousingCondition,
        visualSwitchCondition,
        visualVentsUnobstructed,
        visualCordGrip,
        visualEarthPin: isClassI ? visualEarthPin : undefined,
        visualMarkingsLegible,
        visualNoModifications,
        equipmentClassTested: isLead ? "LEAD_CORD_ASSEMBLY" : isClassI ? "CLASS_I" : "CLASS_II",
        testMethod,
        earthContinuityResult: earthResult,
        earthContinuityReading: earthContinuityReading !== "" ? parseFloat(earthContinuityReading) : undefined,
        insulationResult,
        insulationReading: insulationReading !== "" ? parseFloat(insulationReading) : undefined,
        leakageCurrentResult: leakageResult,
        leakageCurrentReading: leakageCurrentReading !== "" ? parseFloat(leakageCurrentReading) : undefined,
        polarityResult,
        rcdTripTimeResult: rcdResult,
        rcdTripTimeReading: rcdTripTimeReading !== "" ? parseFloat(rcdTripTimeReading) : undefined,
        failureAction: result === "FAIL" ? (failureAction as "NONE" | "REPAIRED" | "REMOVED_FROM_SERVICE" | "DISPOSED" | "REFERRED_TO_ELECTRICIAN") : "NONE",
        failureNotes: result === "FAIL" ? failureNotes : undefined,
        nextDueDate: addMonths(testDate, currentItem.testIntervalMonths || 3),
      });
    },
    onSuccess: (_record, result) => {
      if (!currentItem) return;
      const testDate = new Date();
      const nextDueDate = addMonths(testDate, currentItem.testIntervalMonths || 3);

      setSessionLog((prev) => [
        {
          testTagId: currentItem.testTagId,
          description: currentItem.description,
          result,
          testDate,
        },
        ...prev,
      ]);

      playBeep(result === "PASS");
      toast.success(
        `${currentItem.testTagId} — ${result} — Next due ${formatDate(nextDueDate)}`
      );

      queryClient.invalidateQueries({ queryKey: ["testTagAssets"] });
      queryClient.invalidateQueries({ queryKey: ["testTagDashboard"] });
      resetForm();
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  // ---- Scan handler ----
  const handleScan = useCallback(() => {
    const tagId = scanInput.trim();
    if (!tagId) return;
    lookupMutation.mutate(tagId);
  }, [scanInput, lookupMutation]);

  // ---- Pass All Visual ----
  const passAllVisual = useCallback(() => {
    setVisualCordCondition(true);
    setVisualPlugCondition(true);
    setVisualHousingCondition(true);
    setVisualSwitchCondition(true);
    setVisualVentsUnobstructed(true);
    setVisualCordGrip(true);
    setVisualEarthPin(true);
    setVisualMarkingsLegible(true);
    setVisualNoModifications(true);
  }, []);

  // ---- Pre-load from URL param ----
  useEffect(() => {
    const idParam = searchParams.get("id");
    if (idParam) {
      setScanInput(idParam);
      lookupMutation.mutate(idParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Auto-focus scan input ----
  useEffect(() => {
    if (!currentItem && !isCreatingNew) {
      scanInputRef.current?.focus();
    }
  }, [currentItem, isCreatingNew]);

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ctrl+Shift+P: Pass All Visual
      if (e.ctrlKey && e.shiftKey && e.key === "P") {
        e.preventDefault();
        passAllVisual();
      }
      // Ctrl+Enter: Save & Next (pass)
      if (e.ctrlKey && e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (currentItem && !saveRecordMutation.isPending) {
          saveRecordMutation.mutate(computeOverallResult());
        }
      }
      // Ctrl+Shift+F: Save as Fail
      if (e.ctrlKey && e.shiftKey && e.key === "F") {
        e.preventDefault();
        if (currentItem && !saveRecordMutation.isPending) {
          saveRecordMutation.mutate("FAIL");
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentItem, saveRecordMutation, passAllVisual, computeOverallResult]);

  // ---- Render ----
  const isSaving = saveRecordMutation.isPending;

  return (
    <CanDo resource="testTag" action="create" fallback={<div className="p-8 text-center text-muted-foreground">You don&apos;t have permission to perform this action.</div>}>
    <div className="flex flex-col gap-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <ShieldCheck className="h-6 w-6 text-primary shrink-0" />
          <h1 className="text-xl sm:t-title text-fg truncate">QUICK TEST</h1>
        </div>
        <Button variant="outline" size="sm" render={<Link href="/test-and-tag" />}>
          <ArrowLeft className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">Exit Quick Test</span>
        </Button>
      </div>

      {/* Tester Name */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
        <Label htmlFor="testerName" className="whitespace-nowrap text-sm text-muted-foreground">
          Tester:
        </Label>
        <Input
          id="testerName"
          value={testerName}
          onChange={(e) => setTesterName(e.target.value)}
          placeholder="Tester name"
          className="sm:max-w-xs"
        />
      </div>

      {/* Scan Input */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-3">
            <ScanInput
              ref={scanInputRef}
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleScan();
                }
              }}
              onScan={(value) => lookupMutation.mutate(value)}
              scannerTitle="Scan test tag"
              continuous
              placeholder="Scan or enter test tag ID..."
              className="text-lg"
              autoFocus
              disabled={lookupMutation.isPending}
            />
            <Button onClick={handleScan} disabled={lookupMutation.isPending || !scanInput.trim()}>
              {lookupMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Lookup"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Item Not Found — Create New */}
      {isCreatingNew && !currentItem && (
        <Card className="border-yellow-600/50">
          <CardHeader>
            <CardTitle className="text-yellow-400">Item Not Found — Create New</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Test Tag ID</Label>
                <Input value={scanInput} disabled />
              </div>
              <div className="space-y-1.5">
                <Label>Description *</Label>
                <Input
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="e.g. Makita Drill"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label>Equipment Class</Label>
                <Select value={newEquipmentClass} onValueChange={(v) => v && setNewEquipmentClass(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EQUIPMENT_CLASSES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Appliance Type</Label>
                <Select value={newApplianceType} onValueChange={(v) => v && setNewApplianceType(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {APPLIANCE_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-3">
              <Button
                onClick={() => createItemMutation.mutate()}
                disabled={createItemMutation.isPending || !newDescription.trim()}
              >
                {createItemMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Create & Continue
              </Button>
              <Button variant="outline" onClick={resetForm}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Item Details */}
      {currentItem && (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-lg">{currentItem.testTagId}</span>
                  <Badge variant="outline">{currentItem.equipmentClass.replace(/_/g, " ")}</Badge>
                  <Badge variant="outline">{currentItem.applianceType.replace(/_/g, " ")}</Badge>
                </CardTitle>
                <StatusBadge status={currentItem.status} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Description</span>
                  <p className="font-medium">{currentItem.description}</p>
                </div>
                {currentItem.make && (
                  <div>
                    <span className="text-muted-foreground">Make</span>
                    <p className="font-medium">{currentItem.make}</p>
                  </div>
                )}
                {currentItem.modelName && (
                  <div>
                    <span className="text-muted-foreground">Model</span>
                    <p className="font-medium">{currentItem.modelName}</p>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Last Tested</span>
                  <p className="font-medium">{formatDate(currentItem.lastTestDate)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Next Due</span>
                  <p className="font-medium">{formatDate(currentItem.nextDueDate)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Visual Inspection */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Visual Inspection</CardTitle>
                <Button size="sm" variant="outline" onClick={passAllVisual}>
                  <Check className="h-3 w-3 mr-1" />
                  Pass All
                  <kbd className="ml-2 text-[10px] text-muted-foreground hidden sm:inline">Ctrl+Shift+P</kbd>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <VisualCheck label="Cord condition" checked={visualCordCondition} onChange={setVisualCordCondition} />
                <VisualCheck label="Plug condition" checked={visualPlugCondition} onChange={setVisualPlugCondition} />
                <VisualCheck label="Housing condition" checked={visualHousingCondition} onChange={setVisualHousingCondition} />
                <VisualCheck label="Switches/controls" checked={visualSwitchCondition} onChange={setVisualSwitchCondition} />
                <VisualCheck label="Vents unobstructed" checked={visualVentsUnobstructed} onChange={setVisualVentsUnobstructed} />
                <VisualCheck label="Cord grip" checked={visualCordGrip} onChange={setVisualCordGrip} />
                {isClassI && (
                  <VisualCheck label="Earth pin" checked={visualEarthPin} onChange={setVisualEarthPin} />
                )}
                <VisualCheck label="Markings legible" checked={visualMarkingsLegible} onChange={setVisualMarkingsLegible} />
                <VisualCheck label="No modifications" checked={visualNoModifications} onChange={setVisualNoModifications} />
              </div>
              <div className="mt-3">
                {visualPass ? (
                  <Badge className="bg-green-600/20 text-green-400 border-green-600/30">Visual: PASS</Badge>
                ) : (
                  <Badge className="bg-red-600/20 text-red-400 border-red-600/30">Visual: FAIL</Badge>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Electrical Tests */}
          <Card>
            <CardHeader>
              <CardTitle>Electrical Tests</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Test Method */}
              <div className="space-y-1.5">
                <Label>Test Method</Label>
                <Select value={testMethod} onValueChange={(v) => v && setTestMethod(v as typeof testMethod)}>
                  <SelectTrigger className="w-full sm:w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INSULATION_RESISTANCE">Insulation Resistance</SelectItem>
                    <SelectItem value="LEAKAGE_CURRENT">Leakage Current</SelectItem>
                    <SelectItem value="BOTH">Both</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Earth Continuity — Class I only */}
                {isClassI && (
                  <div className="space-y-1.5">
                    <Label>Earth Continuity</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        step="0.01"
                        value={earthContinuityReading}
                        onChange={(e) => setEarthContinuityReading(e.target.value)}
                        placeholder="Reading"
                        className="w-32"
                      />
                      <span className="text-sm text-muted-foreground whitespace-nowrap">
                        Pass: &lt; 1.0 &Omega;
                      </span>
                      {earthContinuityReading !== "" && (
                        earthContinuityPass ? (
                          <Check className="h-4 w-4 text-green-400" />
                        ) : (
                          <X className="h-4 w-4 text-red-400" />
                        )
                      )}
                    </div>
                  </div>
                )}

                {/* Insulation Resistance */}
                {(testMethod === "INSULATION_RESISTANCE" || testMethod === "BOTH") && (
                  <div className="space-y-1.5">
                    <Label>Insulation Resistance</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        step="0.1"
                        value={insulationReading}
                        onChange={(e) => setInsulationReading(e.target.value)}
                        placeholder="Reading"
                        className="w-32"
                      />
                      <span className="text-sm text-muted-foreground whitespace-nowrap">
                        Pass: &ge; 1.0 M&Omega;
                      </span>
                      {insulationReading !== "" && (
                        insulationPass ? (
                          <Check className="h-4 w-4 text-green-400" />
                        ) : (
                          <X className="h-4 w-4 text-red-400" />
                        )
                      )}
                    </div>
                  </div>
                )}

                {/* Leakage Current */}
                {(testMethod === "LEAKAGE_CURRENT" || testMethod === "BOTH") && (
                  <div className="space-y-1.5">
                    <Label>Leakage Current</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        step="0.01"
                        value={leakageCurrentReading}
                        onChange={(e) => setLeakageCurrentReading(e.target.value)}
                        placeholder="Reading"
                        className="w-32"
                      />
                      <span className="text-sm text-muted-foreground whitespace-nowrap">
                        Pass: &le; {leakageLimit} mA
                      </span>
                      {leakageCurrentReading !== "" && (
                        leakagePass ? (
                          <Check className="h-4 w-4 text-green-400" />
                        ) : (
                          <X className="h-4 w-4 text-red-400" />
                        )
                      )}
                    </div>
                  </div>
                )}

                {/* Polarity — Class I cord/lead/power board */}
                {showPolarity && (
                  <div className="space-y-1.5">
                    <Label>Polarity</Label>
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={polarityPass}
                        onCheckedChange={(checked) => setPolarityPass(!!checked)}
                      />
                      <span className="text-sm">{polarityPass ? "Pass" : "Fail"}</span>
                    </div>
                  </div>
                )}

                {/* RCD Trip Time */}
                {showRcd && (
                  <div className="space-y-1.5">
                    <Label>RCD Trip Time</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        step="1"
                        value={rcdTripTimeReading}
                        onChange={(e) => setRcdTripTimeReading(e.target.value)}
                        placeholder="Reading"
                        className="w-32"
                      />
                      <span className="text-sm text-muted-foreground whitespace-nowrap">
                        Pass: &le; 300 ms
                      </span>
                      {rcdTripTimeReading !== "" && (
                        rcdTripTimePass ? (
                          <Check className="h-4 w-4 text-green-400" />
                        ) : (
                          <X className="h-4 w-4 text-red-400" />
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Overall Result */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-muted-foreground">Overall:</span>
                  {overallResult === "PASS" ? (
                    <Badge className="bg-green-600/20 text-green-400 border-green-600/30 text-lg px-4 py-1">
                      PASS
                    </Badge>
                  ) : (
                    <Badge className="bg-red-600/20 text-red-400 border-red-600/30 text-lg px-4 py-1">
                      FAIL
                    </Badge>
                  )}
                </div>
                <div className="hidden sm:flex items-center gap-3">
                  <Volume2 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Audio feedback enabled</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Failure Fields */}
          {overallResult === "FAIL" && (
            <Card className="border-red-600/30">
              <CardHeader>
                <CardTitle className="text-red-400">Failure Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Failure Action</Label>
                  <Select value={failureAction} onValueChange={(v) => v && setFailureAction(v)}>
                    <SelectTrigger className="w-full sm:w-64">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FAILURE_ACTIONS.map((a) => (
                        <SelectItem key={a.value} value={a.value}>
                          {a.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Failure Notes</Label>
                  <Textarea
                    value={failureNotes}
                    onChange={(e) => setFailureNotes(e.target.value)}
                    placeholder="Describe the failure..."
                    rows={3}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => saveRecordMutation.mutate(computeOverallResult())}
              disabled={isSaving}
              className="flex-1 sm:flex-none"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
              Save & Next
              <kbd className="ml-2 text-[10px] opacity-60 hidden sm:inline">Ctrl+Enter</kbd>
            </Button>
            <Button
              variant="destructive"
              onClick={() => saveRecordMutation.mutate("FAIL")}
              disabled={isSaving}
            >
              <X className="h-4 w-4 mr-2" />
              Fail
              <kbd className="ml-2 text-[10px] opacity-60 hidden sm:inline">Ctrl+Shift+F</kbd>
            </Button>
            <Button variant="outline" onClick={resetForm} disabled={isSaving}>
              Skip
            </Button>
          </div>
        </>
      )}

      {/* Session Log */}
      {sessionLog.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Session Log ({sessionLog.length} items)</span>
              <div className="flex gap-2 text-sm font-normal">
                <Badge className="bg-green-600/20 text-green-400 border-green-600/30">
                  {sessionLog.filter((e) => e.result === "PASS").length} Pass
                </Badge>
                <Badge className="bg-red-600/20 text-red-400 border-red-600/30">
                  {sessionLog.filter((e) => e.result === "FAIL").length} Fail
                </Badge>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {sessionLog.map((entry, i) => (
                <div
                  key={`${entry.testTagId}-${i}`}
                  className="flex items-center justify-between gap-2 py-2 px-3 rounded-md bg-muted/50"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-sm shrink-0">{entry.testTagId}</span>
                    <span className="text-sm text-muted-foreground truncate hidden sm:inline">{entry.description}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground hidden sm:inline">
                      {entry.testDate.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {entry.result === "PASS" ? (
                      <Badge className="bg-green-600/20 text-green-400 border-green-600/30">PASS</Badge>
                    ) : (
                      <Badge className="bg-red-600/20 text-red-400 border-red-600/30">FAIL</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Keyboard shortcuts help — desktop only */}
      <div className="text-xs text-muted-foreground flex-wrap gap-4 hidden sm:flex">
        <span><kbd className="px-1.5 py-0.5 rounded bg-muted border text-[10px]">Ctrl+Shift+P</kbd> Pass All Visual</span>
        <span><kbd className="px-1.5 py-0.5 rounded bg-muted border text-[10px]">Ctrl+Enter</kbd> Save & Next</span>
        <span><kbd className="px-1.5 py-0.5 rounded bg-muted border text-[10px]">Ctrl+Shift+F</kbd> Save as Fail</span>
      </div>
    </div>
    </CanDo>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function VisualCheck({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer">
      <Checkbox checked={checked} onCheckedChange={(c) => onChange(!!c)} />
      <span className="text-sm">{label}</span>
      {checked ? (
        <Check className="h-3.5 w-3.5 text-green-400 ml-auto" />
      ) : (
        <X className="h-3.5 w-3.5 text-red-400/50 ml-auto" />
      )}
    </label>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "CURRENT":
      return <Badge className="bg-green-600/20 text-green-400 border-green-600/30">Current</Badge>;
    case "DUE_SOON":
      return <Badge className="bg-yellow-600/20 text-yellow-400 border-yellow-600/30">Due Soon</Badge>;
    case "OVERDUE":
      return <Badge className="bg-red-600/20 text-red-400 border-red-600/30">Overdue</Badge>;
    case "FAILED":
      return <Badge className="bg-red-600/20 text-red-400 border-red-600/30">Failed</Badge>;
    case "NOT_YET_TESTED":
      return <Badge className="bg-zinc-600/20 text-zinc-400 border-zinc-600/30">Not Yet Tested</Badge>;
    case "RETIRED":
      return <Badge className="bg-zinc-600/20 text-zinc-400 border-zinc-600/30">Retired</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

// ---------------------------------------------------------------------------
// Page export with Suspense boundary
// ---------------------------------------------------------------------------

export default function QuickTestPage() {
  return (
    <RequirePermission resource="testTag" action="create">
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <QuickTestInner />
    </Suspense>
    </RequirePermission>
  );
}
