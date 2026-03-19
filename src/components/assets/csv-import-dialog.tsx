"use client";

import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, Loader2, CheckCircle2, AlertTriangle, FileText } from "lucide-react";
import { toast } from "sonner";

import { importModelsCSV, importAssetsCSV } from "@/server/csv";
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
  type: "models" | "assets";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CSVImportDialog({ type, open, onOpenChange }: CSVImportDialogProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{
    created: number;
    updated: number;
    errors: { row: number; message: string }[];
  } | null>(null);

  const mutation = useMutation({
    mutationFn: async (csvContent: string) => {
      if (type === "models") {
        return importModelsCSV(csvContent);
      } else {
        return importAssetsCSV(csvContent);
      }
    },
    onSuccess: (data) => {
      setResult(data);
      if (data.errors.length === 0) {
        toast.success(`Imported ${data.created} new, updated ${data.updated} existing`);
      } else {
        toast.warning(`Import completed with ${data.errors.length} errors`);
      }
      queryClient.invalidateQueries({ queryKey: type === "models" ? ["models"] : ["assets"] });
      if (type === "assets") {
        queryClient.invalidateQueries({ queryKey: ["bulkAssets"] });
      }
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

  const label = type === "models" ? "Models" : "Assets";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import {label} from CSV</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div
            className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/25 p-6 cursor-pointer hover:border-muted-foreground/50 transition-colors"
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
                <FileText className="h-8 w-8 text-fg-3" />
                <p className="text-sm font-medium">{file.name}</p>
                <p className="text-xs text-fg-3">
                  {(file.size / 1024).toFixed(1)} KB - Click to change
                </p>
              </>
            ) : (
              <>
                <Upload className="h-8 w-8 text-fg-3" />
                <p className="text-sm text-fg-3">
                  Click to select a CSV file
                </p>
              </>
            )}
          </div>

          <div className="text-xs text-fg-3 space-y-1">
            {type === "models" ? (
              <>
                <p className="font-medium">Expected columns:</p>
                <p>name (required), manufacturer, modelNumber, category, assetType, description, defaultRentalPrice, defaultPurchasePrice, replacementCost, weight</p>
                <p>Existing models (matched by name + manufacturer + model number) will be updated.</p>
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
            <div className="rounded-md border p-3 space-y-2">
              <div className="flex items-center gap-4 text-sm">
                {result.errors.length === 0 ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                )}
                <span>
                  <strong>{result.created}</strong> created,{" "}
                  <strong>{result.updated}</strong> updated
                  {result.errors.length > 0 && (
                    <>, <strong className="text-red-500">{result.errors.length}</strong> errors</>
                  )}
                </span>
              </div>
              {result.errors.length > 0 && (
                <div className="max-h-32 overflow-y-auto text-xs space-y-1">
                  {result.errors.map((err, idx) => (
                    <p key={idx} className="text-red-500">
                      Row {err.row}: {err.message}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
          {!result && (
            <Button
              onClick={handleImport}
              disabled={!file || mutation.isPending}
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importing...
                </>
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
