"use client";

import { useState, useRef } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { Upload, CheckCircle2, AlertTriangle, FileText } from "lucide-react";
import { toast } from "sonner";

import { cn, focusRing } from "@/lib/utils";
import { importModelsCSV, importAssetsCSV, importModelRatesCSV } from "@/server/csv";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

interface CSVImportDialogProps {
  type: "models" | "assets" | "rates";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CSVImportDialog({ type, open, onOpenChange }: CSVImportDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{
    created: number;
    updated: number;
    errors: { row: number; message: string }[];
  } | null>(null);

  const mutation = useServerMutation({
    mutationFn: async (csvContent: string) => {
      if (type === "models") {
        return importModelsCSV(csvContent);
      } else if (type === "rates") {
        return importModelRatesCSV(csvContent);
      } else {
        return importAssetsCSV(csvContent);
      }
    },
    onSuccess: (data) => {
      setResult(data);
      if (data.errors.length === 0) {
        if (type === "rates") {
          toast.success(`Updated rates on ${data.updated} model(s)`);
        } else {
          toast.success(`Imported ${data.created} new, updated ${data.updated} existing`);
        }
      } else {
        toast.warning(`Import completed with ${data.errors.length} errors`);
      }
      // All imports refresh their reactive tables (useModels / useAssets /
      // useBulkAssets) via the server action's dual-write — no cache to invalidate.
    },
    onError: (e) => toast.error(e.message),
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setResult(null);
    }
  }

  async function handleImport() {
    if (!file) return;
    const text = await file.text();
    mutation.mutate(text);
  }

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) {
      setFile(null);
      setResult(null);
      mutation.reset();
    }
    onOpenChange(nextOpen);
  }

  const label = type === "models" ? "Models" : type === "rates" ? "Rates" : "Assets";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import {label} from CSV</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <button
            type="button"
            className={cn("flex w-full flex-col items-center justify-center gap-2 rounded-[var(--r)] border-2 border-dashed border-line-2 p-6 cursor-pointer motion-safe:transition-colors hover:border-muted", focusRing)}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="hidden"
            />
            {file ? (
              <>
                <FileText className="h-8 w-8 text-muted" />
                <p className="text-ui-text font-medium text-ink">{file.name}</p>
                <p className="text-caption text-muted">
                  <span className="tabular-nums">{(file.size / 1024).toFixed(1)}</span> KB — click to change
                </p>
              </>
            ) : (
              <>
                <Upload className="h-8 w-8 text-muted" />
                <p className="text-ui-text text-muted">
                  Click to select a CSV file
                </p>
              </>
            )}
          </button>

          <div className="text-caption text-muted space-y-1">
            {type === "models" ? (
              <>
                <p className="font-medium">Expected columns:</p>
                <p>name (required), manufacturer, modelNumber, sku, category, assetType, description, defaultRentalPrice, dailyRate, weeklyRate, monthlyRate, defaultPurchasePrice, replacementCost, weight</p>
                <p>Existing models (matched by name + manufacturer + model number) will be updated.</p>
              </>
            ) : type === "rates" ? (
              <>
                <p className="font-medium">Expected columns:</p>
                <p>An identifier — name, modelNumber, sku, or id — plus any of dailyRate, weeklyRate, monthlyRate.</p>
                <p>Models are matched and updated, never created. Blank rate cells are left unchanged. Tip: use Export to grab a ready-to-edit sheet of your models.</p>
              </>
            ) : (
              <>
                <p className="font-medium">Expected columns:</p>
                <p>modelName (required), assetTag (auto-generated if empty), serialNumber, customName, status, condition, locationName, purchaseDate, purchasePrice, supplierName, notes</p>
                <p>Existing assets (matched by asset tag) will be updated.</p>
              </>
            )}
          </div>

          {result && (
            <div
              className={cn(
                "rounded-[var(--r)] border-l-[3px] bg-card p-3 space-y-2",
                result.errors.length === 0 ? "border-l-ok" : "border-l-t-out",
              )}
            >
              <div className="flex items-center gap-4 text-ui-text text-ink">
                {result.errors.length === 0 ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-t-out" />
                )}
                <span>
                  {type !== "rates" && (
                    <>
                      <strong className="tabular-nums">{result.created}</strong> created,{" "}
                    </>
                  )}
                  <strong className="tabular-nums">{result.updated}</strong> updated
                  {result.errors.length > 0 && (
                    <>, <strong className="tabular-nums text-t-out">{result.errors.length}</strong> errors</>
                  )}
                </span>
              </div>
              {result.errors.length > 0 && (
                <div className="max-h-32 overflow-y-auto text-caption space-y-1">
                  {result.errors.map((err, idx) => (
                    <p key={idx} className="text-t-out">
                      Row <span className="tabular-nums">{err.row}</span>: {err.message}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="line">Close</Button>
          </DialogClose>
          {!result && (
            <Button
              onClick={handleImport}
              disabled={!file}
              loading={mutation.isPending}
            >
              {mutation.isPending ? (
                "Importing..."
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Import
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
