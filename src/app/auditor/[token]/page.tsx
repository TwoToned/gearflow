"use client";
// use-client: interactive — React state/effects (client-only) (R-8.1.1)

import { use, useState, useMemo, useEffect } from "react";
import { useServerQuery } from "@/hooks/use-server-query";
import { Shield, Search, ArrowUpDown, Sun, Moon, Lock } from "lucide-react";
import { formatDate } from "@/lib/formatters";
import { MobileCardList, type ColumnDef } from "@/components/ui/data-table";

const STATUS_LABELS: Record<string, string> = {
  CURRENT: "Current",
  DUE_SOON: "Due Soon",
  OVERDUE: "Overdue",
  FAILED: "Failed",
  NOT_YET_TESTED: "Not Tested",
  RETIRED: "Retired",
};

const STATUS_COLORS_LIGHT: Record<string, string> = {
  CURRENT: "bg-teal-100 text-teal-800",
  DUE_SOON: "bg-amber-100 text-amber-800",
  OVERDUE: "bg-red-100 text-red-800",
  FAILED: "bg-red-100 text-red-800",
  NOT_YET_TESTED: "bg-gray-100 text-gray-600",
};

const STATUS_COLORS_DARK: Record<string, string> = {
  CURRENT: "bg-teal-900/50 text-teal-300",
  DUE_SOON: "bg-amber-900/50 text-amber-300",
  OVERDUE: "bg-red-900/50 text-red-300",
  FAILED: "bg-red-900/50 text-red-300",
  NOT_YET_TESTED: "bg-gray-800 text-gray-400",
};

const CLASS_LABELS: Record<string, string> = {
  CLASS_I: "Class I",
  CLASS_II: "Class II",
  CLASS_II_DOUBLE_INSULATED: "Class II (DI)",
  LEAD_CORD_ASSEMBLY: "Lead/Cord",
};

interface AuditorAsset {
  id: string;
  testTagId: string;
  description: string;
  equipmentClass: string;
  applianceType: string;
  make: string;
  modelName: string;
  serialNumber: string | null;
  location: string | null;
  status: string;
  lastTestDate: string | null;
  nextDueDate: string | null;
  testIntervalMonths: number;
}

interface AuditorData {
  orgName: string;
  tokenName: string;
  assets: AuditorAsset[];
  summary: {
    total: number;
    current: number;
    dueSoon: number;
    overdue: number;
    failed: number;
    notTested: number;
    complianceRate: number;
  };
  scopeDescription: string | null;
  generatedAt: string;
}

export default function AuditorPortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<string>("testTagId");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [dark, setDark] = useState(false);

  // Detect system preference on mount
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setDark(true);
    }
  }, []);

  const { data, isLoading, error } = useServerQuery<AuditorData>({
    queryKey: ["auditor", token],
    queryFn: async () => {
      const res = await fetch(`/api/auditor/${token}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to load auditor data");
      }
      return res.json();
    },
  });

  const filteredAssets = useMemo(() => {
    if (!data) return [];
    let assets = data.assets;

    if (statusFilter !== "all") {
      assets = assets.filter((a) => a.status === statusFilter);
    }

    if (search) {
      const q = search.toLowerCase();
      assets = assets.filter(
        (a) =>
          a.testTagId.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q) ||
          (a.location && a.location.toLowerCase().includes(q)) ||
          (a.serialNumber && a.serialNumber.toLowerCase().includes(q)) ||
          (a.make && a.make.toLowerCase().includes(q))
      );
    }

    assets = [...assets].sort((a, b) => {
      const aVal = (a as unknown as Record<string, unknown>)[sortField] ?? "";
      const bVal = (b as unknown as Record<string, unknown>)[sortField] ?? "";
      const cmp = String(aVal).localeCompare(String(bVal));
      return sortDir === "asc" ? cmp : -cmp;
    });

    return assets;
  }, [data, search, statusFilter, sortField, sortDir]);

  const toggleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const statusColors = dark ? STATUS_COLORS_DARK : STATUS_COLORS_LIGHT;

  // Mobile card layout (rendered below `md`; cards can't column-sort, so they
  // just render the already-sorted `filteredAssets` array in its current order).
  // Every `cell` is pure/presentational and mirrors the desktop <td> content.
  const cardColumns: ColumnDef<AuditorAsset>[] = [
    {
      id: "testTagId",
      header: "Tag ID",
      mobile: "title",
      cell: (asset) => <span className="font-mono font-medium">{asset.testTagId}</span>,
    },
    {
      id: "description",
      header: "Description",
      mobile: "subtitle",
      cell: (asset) => <span>{asset.description}</span>,
    },
    {
      id: "equipmentClass",
      header: "Class",
      mobile: "meta",
      cell: (asset) => <span>{CLASS_LABELS[asset.equipmentClass] || asset.equipmentClass}</span>,
    },
    {
      id: "location",
      header: "Location",
      mobile: "meta",
      cell: (asset) => <span>{asset.location || "-"}</span>,
    },
    {
      id: "lastTestDate",
      header: "Last Test",
      mobile: "meta",
      cell: (asset) => <span>{formatDate(asset.lastTestDate)}</span>,
    },
    {
      id: "nextDueDate",
      header: "Next Due",
      mobile: "meta",
      cell: (asset) => <span>{formatDate(asset.nextDueDate)}</span>,
    },
    {
      id: "status",
      header: "Status",
      mobile: "badge",
      cell: (asset) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[asset.status] || (dark ? "bg-gray-800 text-gray-400" : "bg-gray-100 text-gray-600")}`}>
          {STATUS_LABELS[asset.status] || asset.status}
        </span>
      ),
    },
  ];

  // Theme classes
  const bg = dark ? "bg-gray-950" : "bg-gray-50";
  const headerBg = dark ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200";
  const textPrimary = dark ? "text-gray-100" : "text-gray-900";
  const textSecondary = dark ? "text-gray-400" : "text-gray-500";
  const textMuted = dark ? "text-gray-500" : "text-gray-400";
  const inputBg = dark ? "bg-gray-800 border-gray-700 text-gray-100 placeholder:text-gray-500" : "bg-white border-gray-300 text-gray-900 placeholder:text-gray-400";
  const tableBg = dark ? "bg-gray-900" : "bg-white";
  const tableHeaderBg = dark ? "bg-gray-800/50" : "bg-gray-50";
  const tableHover = dark ? "hover:bg-gray-800/50" : "hover:bg-gray-50";
  const tableBorder = dark ? "divide-gray-800" : "divide-gray-200";
  const tableFooterBg = dark ? "bg-gray-800/50 border-gray-800" : "bg-gray-50 border-gray-200";
  const selectBg = dark ? "bg-gray-800 border-gray-700 text-gray-100" : "bg-white border-gray-300 text-gray-900";

  if (isLoading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${bg}`}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${bg}`}>
        <div className="text-center max-w-md mx-auto p-8">
          <Shield className={`h-12 w-12 mx-auto mb-4 ${textMuted}`} />
          <h1 className={`text-xl font-semibold mb-2 ${textPrimary}`}>Link Not Found</h1>
          <p className={textSecondary}>
            This auditor link is invalid, expired, or has been revoked.
            Please contact the organisation for a new link.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${bg} transition-colors duration-200`}>
      {/* Header */}
      <div className={`${headerBg} border-b shadow-sm transition-colors duration-200`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Shield className="h-5 w-5 text-teal-500" />
                <span className="text-sm font-medium text-teal-500">Auditor Portal</span>
                {data.scopeDescription && (
                  <span className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 ${dark ? "bg-gray-800 text-gray-400" : "bg-gray-100 text-gray-500"}`}>
                    <Lock className="h-3 w-3" />
                    {data.scopeDescription}
                  </span>
                )}
              </div>
              <h1 className={`text-xl font-semibold ${textPrimary}`}>{data.orgName}</h1>
              <p className={`text-sm ${textSecondary}`}>{data.tokenName} · Generated {formatDate(data.generatedAt)}</p>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setDark(!dark)}
                className={`p-2 rounded-lg transition-colors ${dark ? "hover:bg-gray-800 text-gray-400" : "hover:bg-gray-100 text-gray-500"}`}
                title={dark ? "Switch to light mode" : "Switch to dark mode"}
              >
                {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </button>
              <div className="text-right">
                <div className="text-3xl font-bold text-teal-500">{data.summary.complianceRate}%</div>
                <div className={`text-sm ${textSecondary}`}>Compliance Rate</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          {[
            { label: "Total", value: data.summary.total, color: textPrimary, cardBgColor: dark ? "bg-gray-900" : "bg-white" },
            { label: "Current", value: data.summary.current, color: "text-teal-500", cardBgColor: dark ? "bg-teal-950/30" : "bg-teal-50" },
            { label: "Due Soon", value: data.summary.dueSoon, color: dark ? "text-amber-400" : "text-amber-600", cardBgColor: dark ? "bg-amber-950/30" : "bg-amber-50" },
            { label: "Overdue", value: data.summary.overdue, color: dark ? "text-red-400" : "text-red-600", cardBgColor: dark ? "bg-red-950/30" : "bg-red-50" },
            { label: "Failed", value: data.summary.failed, color: dark ? "text-red-400" : "text-red-600", cardBgColor: dark ? "bg-red-950/30" : "bg-red-50" },
            { label: "Not Tested", value: data.summary.notTested, color: textSecondary, cardBgColor: dark ? "bg-gray-800" : "bg-gray-50" },
          ].map((card) => (
            <div key={card.label} className={`${card.cardBgColor} rounded-lg p-3 border ${dark ? "border-gray-800" : "border-gray-200"} transition-colors duration-200`}>
              <div className={`text-2xl font-bold ${card.color}`}>{card.value}</div>
              <div className={`text-xs ${textSecondary}`}>{card.label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${textMuted}`} />
            <input
              placeholder="Search by tag, description, location, serial, make..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`w-full rounded-md border px-3 py-2 pl-9 text-sm ${inputBg} focus:outline-none focus:ring-2 focus:ring-teal-500 transition-colors`}
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={`rounded-md border px-3 py-2 text-sm ${selectBg} transition-colors`}
          >
            <option value="all">All Statuses</option>
            <option value="CURRENT">Current</option>
            <option value="DUE_SOON">Due Soon</option>
            <option value="OVERDUE">Overdue</option>
            <option value="FAILED">Failed</option>
            <option value="NOT_YET_TESTED">Not Tested</option>
          </select>
        </div>

        {/* Table */}
        <div className={`${tableBg} rounded-lg border shadow-sm overflow-hidden ${dark ? "border-gray-800" : "border-gray-200"} transition-colors duration-200`}>
          <div className="hidden md:block overflow-x-auto">
            <table className={`min-w-full divide-y ${tableBorder}`}>
              <thead className={tableHeaderBg}>
                <tr>
                  {[
                    { key: "testTagId", label: "Tag ID" },
                    { key: "description", label: "Description" },
                    { key: "equipmentClass", label: "Class" },
                    { key: "location", label: "Location" },
                    { key: "lastTestDate", label: "Last Test" },
                    { key: "nextDueDate", label: "Next Due" },
                    { key: "status", label: "Status" },
                  ].map((col) => (
                    <th
                      key={col.key}
                      className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider cursor-pointer select-none transition-colors ${dark ? "text-gray-400 hover:bg-gray-700/50" : "text-gray-500 hover:bg-gray-100"}`}
                      onClick={() => toggleSort(col.key)}
                    >
                      <div className="flex items-center gap-1">
                        {col.label}
                        <ArrowUpDown className="h-3 w-3" />
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className={`divide-y ${tableBorder}`}>
                {filteredAssets.map((asset) => (
                  <tr key={asset.id} className={`${tableHover} transition-colors`}>
                    <td className={`px-4 py-3 text-sm font-mono font-medium ${textPrimary}`}>{asset.testTagId}</td>
                    <td className={`px-4 py-3 text-sm ${textSecondary}`}>{asset.description}</td>
                    <td className={`px-4 py-3 text-sm ${textSecondary}`}>{CLASS_LABELS[asset.equipmentClass] || asset.equipmentClass}</td>
                    <td className={`px-4 py-3 text-sm ${textSecondary}`}>{asset.location || "-"}</td>
                    <td className={`px-4 py-3 text-sm ${textSecondary}`}>{formatDate(asset.lastTestDate)}</td>
                    <td className={`px-4 py-3 text-sm ${textSecondary}`}>{formatDate(asset.nextDueDate)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[asset.status] || (dark ? "bg-gray-800 text-gray-400" : "bg-gray-100 text-gray-600")}`}>
                        {STATUS_LABELS[asset.status] || asset.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {filteredAssets.length === 0 && (
                  <tr>
                    <td colSpan={7} className={`px-4 py-8 text-center text-sm ${textSecondary}`}>
                      No items match your filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {/* Mobile card list (below `md`). Cards render the already-sorted
              `filteredAssets` in order — no column-sort UI on mobile. */}
          {filteredAssets.length === 0 ? (
            <div className={`md:hidden px-4 py-8 text-center text-sm ${textSecondary}`}>
              No items match your filters.
            </div>
          ) : (
            <MobileCardList
              className="md:hidden p-4"
              data={filteredAssets}
              columns={cardColumns}
              getRowId={(asset) => asset.id}
            />
          )}
          <div className={`px-4 py-3 border-t text-xs ${tableFooterBg} ${textSecondary} transition-colors`}>
            Showing {filteredAssets.length} of {data.assets.length} items
          </div>
        </div>

        {/* Footer */}
        <div className={`mt-6 text-center text-xs ${textMuted}`}>
          <p>This is a read-only compliance view. Data shown is live from {data.orgName}.</p>
          <p className="mt-1">Powered by RVLT Flow</p>
        </div>
      </div>
    </div>
  );
}
