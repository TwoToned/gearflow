"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, DollarSign, Upload } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import { BulkAssignChecksDialog, BulkRateUpdateDialog } from "@/components/assets/model-bulk-dialogs";
import { CSVImportDialog } from "@/components/assets/csv-import-dialog";
import { MediaThumbnail } from "@/components/media/media-thumbnail";
import { ListPage } from "@/components/ui/list-page";
import type { ListPrimary } from "@/components/ui/list-page-parts";
import { UrlSavedViewsMenu } from "@/components/ui/url-saved-views";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useCategoriesWithParent } from "@/hooks/use-categories";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useListUrlState } from "@/hooks/use-list-url-state";
import { useOrgTags } from "@/hooks/use-org-tags";
import { usePaginatedTableResult } from "@/hooks/use-paginated-table-result";
import { useStableNow } from "@/hooks/use-stable-now";
import { useActiveOrganization } from "@/lib/auth-client";
import {
  MODELS_SPEC,
  MODEL_COLUMNS,
  MODEL_ITEM_HEADER,
  MODEL_ITEM_SORT_KEY,
  modelFilters,
  modelRowOf,
  modelSegments,
  modelsQueryArgs,
  type ModelSource,
} from "@/lib/list-views/models";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import { buildModelActions, buildModelBulkActions } from "@/lib/row-actions/model";
import { showError } from "@/lib/show-error";
import { useCanDo } from "@/lib/use-permissions";
import { exportModelsCSV } from "@/server/csv";

type Dialog = "import" | "rates-import" | "edit-rates" | "assign-checks" | null;

function downloadCsv(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportModels() {
  try {
    downloadCsv(await exportModelsCSV(), "models.csv");
  } catch (e) {
    showError(e, { fallbackTitle: "Could not export" });
  }
}

/** Keyed by org: switching org remounts, so the selection and the bulk-dialog ids never leak across orgs. */
export function ModelsList() {
  const { data: activeOrg } = useActiveOrganization();
  return <ModelsListInner key={activeOrg?.id ?? "none"} orgId={activeOrg?.id} />;
}

function ModelsListInner({ orgId }: { orgId: string | undefined }) {
  const router = useRouter();
  const now = useStableNow();
  const { state, setState } = useListUrlState(MODELS_SPEC);
  const canCreate = useCanDo("model", "create");
  const canUpdate = useCanDo("model", "update");
  const canChecks = useCanDo("checkItem", "update");

  const page = useAuthedQuery(api.modelsList.listPage, orgId ? { orgId, ...modelsQueryArgs(state, now) } : "skip");
  const counts = useAuthedQuery(api.modelsList.segmentCounts, orgId ? { orgId, now } : "skip");
  const { data: items, total, isLoading } = usePaginatedTableResult(page as { items: ModelSource[]; total: number; totalPages: number } | undefined);
  const categories = useCategoriesWithParent(orgId);
  const tags = useOrgTags(orgId);

  const [dialog, setDialog] = React.useState<Dialog>(null);
  const [bulkIds, setBulkIds] = React.useState<Set<string>>(new Set());
  const photos = React.useMemo(() => new Map(items.map((m) => [m.id, m.media])), [items]);

  useKeyboardShortcut("n", () => canCreate && router.push("/assets/models/new"));

  const rows = items.map((m) =>
    modelRowOf(
      m,
      buildModelActions({
        onOpen: () => router.push(`/assets/models/${m.id}`),
        onEdit: canUpdate ? () => router.push(`/assets/models/${m.id}/edit`) : undefined,
      }),
    ),
  );

  const openBulk = (kind: "edit-rates" | "assign-checks", ids: string[]) => {
    setBulkIds(new Set(ids));
    setDialog(kind);
  };
  const primary: ListPrimary | undefined = canCreate ? { label: "New model", onSelect: () => router.push("/assets/models/new") } : undefined;
  const pageMenu: ActionMenuSpec = canCreate
    ? {
        items: [
          { key: "export", label: "Export CSV", group: "reporting", icon: Download, onSelect: () => void exportModels() },
          { key: "import", label: "Import CSV", group: "organise", icon: Upload, onSelect: () => setDialog("import") },
          ...(canUpdate ? [{ key: "import-rates", label: "Import rates…", group: "organise" as const, icon: DollarSign, onSelect: () => setDialog("rates-import") }] : []),
        ],
      }
    : { items: [] };

  return (
    <>
      <ListPage
        spec={MODELS_SPEC}
        title="Models"
        noun="models"
        bulkNoun="model"
        searchPlaceholder="Search name, maker, model number or SKU"
        segments={modelSegments(counts as Record<string, number> | undefined)}
        filters={modelFilters(
          (categories ?? []).map((c) => ({ id: c.id, name: c.name, parentName: c.parent?.name ?? null })),
          tags,
        )}
        columns={MODEL_COLUMNS}
        columnsKey="models"
        rows={rows}
        total={total}
        loading={isLoading}
        itemHeader={MODEL_ITEM_HEADER}
        itemSortKey={MODEL_ITEM_SORT_KEY}
        leading={(row) => <MediaThumbnail url={photos.get(row.id)?.url} thumbnailUrl={photos.get(row.id)?.thumbnailUrl} alt={row.title} size={32} />}
        primary={primary}
        pageMenu={pageMenu}
        bulk={(ids) =>
          buildModelBulkActions({
            onEditRates: canUpdate ? () => openBulk("edit-rates", ids) : undefined,
            onAssignChecks: canChecks ? () => openBulk("assign-checks", ids) : undefined,
          })
        }
        empty={{
          title: "No models yet",
          description: "A model is a type of gear: its rates, checks and accessories. Add one to start tracking units.",
          action: primary,
        }}
        toolbarExtra={<UrlSavedViewsMenu tableId="models" spec={MODELS_SPEC} state={state} setState={setState} />}
      />
      <CSVImportDialog type="models" open={dialog === "import"} onOpenChange={(o) => !o && setDialog(null)} />
      <CSVImportDialog type="rates" open={dialog === "rates-import"} onOpenChange={(o) => !o && setDialog(null)} />
      <BulkRateUpdateDialog open={dialog === "edit-rates"} onOpenChange={(o) => !o && setDialog(null)} selectedModelIds={bulkIds} onSuccess={() => setDialog(null)} />
      <BulkAssignChecksDialog open={dialog === "assign-checks"} onOpenChange={(o) => !o && setDialog(null)} selectedModelIds={bulkIds} onSuccess={() => setDialog(null)} />
    </>
  );
}
