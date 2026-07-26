"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Package,
  FolderOpen,
  Users,
  Boxes,
  Tag,
  Search,
  Loader2,
  Box,
  MapPin,
  Wrench,
  CornerDownRight,
  ChevronsUpDown,
  Layers,
  ChevronRight,
  X,
  LayoutDashboard,
  ListTodo,
  Warehouse,
  ShieldCheck,
  BarChart3,
  Settings,
  UserCircle,
  CalendarRange,
  Container,
  BookTemplate,
  AtSign,
  PackageCheck,
  PackageX,
  CreditCard,
  Palette,
  Truck,
  Slash,
  FileText,
  ClipboardList,
  Pencil,
  Copy,
  Upload,
  Download,
  QrCode,
  ScrollText,
  ScanBarcode,
  PackagePlus,
  LogOut,
  CheckCircle,
  CircleCheck,
  CircleX,
  StickyNote,
  Share2,
  HardHat,
  Briefcase,
  Clock,
  CalendarOff,
  ClipboardCheck,
  Bookmark,
  PackageOpen,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { type SearchResult, type SearchResultType } from "@/lib/search-types";
import { useGlobalSearch } from "@/hooks/use-global-search";
import { matchPageCommands, type PageCommand } from "@/lib/page-commands";
import { matchSlashCommands, extractEntityId, type SlashCommand } from "@/lib/slash-commands";
import { signOut } from "@/lib/auth-client";
import { useCurrentRole } from "@/lib/use-permissions";
import { useIsMobile } from "@/hooks/use-mobile";

// ─── Icon maps ─────────────────────────────────────────────────────

const typeIcons: Record<SearchResultType, React.ComponentType<{ className?: string }>> = {
  model: Package,
  kit: Box,
  asset: Tag,
  "bulk-asset": Boxes,
  project: FolderOpen,
  client: Users,
  location: MapPin,
  category: Layers,
  supplier: Truck,
  maintenance: Wrench,
  crew: HardHat,
  "check-item": ClipboardCheck,
  "group-template": Bookmark,
  "sub-hire": PackageOpen,
};

const typeLabels: Record<SearchResultType, string> = {
  model: "Model",
  kit: "Kit",
  asset: "Asset",
  "bulk-asset": "Bulk Asset",
  project: "Project",
  client: "Client",
  supplier: "Supplier",
  location: "Location",
  category: "Category",
  maintenance: "Maintenance",
  crew: "Crew",
  "check-item": "Check Item",
  "group-template": "Group Template",
  "sub-hire": "Sub-Hire",
};

const pageIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard, ListTodo, Package, Boxes, Box, CalendarRange, Container,
  FolderOpen, BookTemplate, Warehouse, Users, MapPin, Wrench,
  ShieldCheck, BarChart3, Settings, UserCircle, PackageCheck, PackageX,
  CreditCard, Palette, Truck, FileText, ClipboardList, Pencil, Copy,
  Upload, Download, QrCode, ScrollText, ScanBarcode, PackagePlus,
  LogOut, CheckCircle, CircleCheck, CircleX, StickyNote, Share2, HardHat,
  Briefcase, Clock, CalendarOff, ClipboardCheck, Bookmark, PackageOpen,
};

function normalize(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

/**
 * Try to parse a date from common formats.
 * Supports: DD/MM/YY, DD/MM/YYYY, DD-MM-YY, DD-MM-YYYY, YYYY-MM-DD, DD.MM.YY, DD.MM.YYYY
 * Returns a Date or null.
 */
function tryParseDate(input: string): Date | null {
  const s = input.trim();
  if (!s) return null;

  // YYYY-MM-DD (ISO)
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) {
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    if (!isNaN(d.getTime()) && d.getFullYear() === +m[1]) return d;
  }

  // DD/MM/YY or DD/MM/YYYY (with /, -, or .)
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    let year = +m[3];
    if (year < 100) year += 2000;
    const d = new Date(year, +m[2] - 1, +m[1]);
    if (!isNaN(d.getTime()) && d.getDate() === +m[1] && d.getMonth() === +m[2] - 1) return d;
  }

  return null;
}

// ─── Unified result type ───────────────────────────────────────────

interface DisplayItem {
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  isChild?: boolean;
  /** For section labels in normal search mode */
  typeLabel?: string;
  /** If this item has children (for Tab drill hint) */
  hasChildren?: boolean;
}

// ─── Design constants ────────────────────────────────────────────

const KB_HINT_FONT_SIZE = "10px";
const BREADCRUMB_MAX_WIDTH = "150px";

export function CommandSearch() {
  const isMobile = useIsMobile();
  const globalSearch = useGlobalSearch();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expanded, setExpanded] = useState(true);

  // Drill-down state
  const [drillParent, setDrillParent] = useState<DisplayItem | null>(null);
  const [drillChildren, setDrillChildren] = useState<DisplayItem[]>([]);
  const [drillQuery, setDrillQuery] = useState("");

  // @ command state: when query starts with @, we're in page nav mode
  // entitySearch: after picking a page with searchable, we search entities
  const [atEntityPage, setAtEntityPage] = useState<PageCommand | null>(null);
  const [atEntityResults, setAtEntityResults] = useState<SearchResult[]>([]);
  const [atEntityLoading, setAtEntityLoading] = useState(false);

  const router = useRouter();
  const pathname = usePathname();
  const { permissions } = useCurrentRole();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  const isDrilling = drillParent !== null;
  const isAtMode = query.startsWith("@");
  const isSlashMode = query.startsWith("/") && !isDrilling;
  const isAtEntityMode = atEntityPage !== null;

  // ─── / mode: slash commands ───────────────────────────────────

  const slashQuery = isSlashMode ? query.slice(1) : "";
  const slashMatches = useMemo(() => {
    if (!isSlashMode || isDrilling || isAtEntityMode) return [];
    return matchSlashCommands(slashQuery, pathname, permissions);
  }, [isSlashMode, slashQuery, pathname, permissions, isDrilling, isAtEntityMode]);

  const slashDisplayItems = useMemo((): DisplayItem[] => {
    if (!isSlashMode || isDrilling || isAtEntityMode) return [];

    // Group: page-specific commands first, then global
    const pageSpecific: DisplayItem[] = [];
    const global: DisplayItem[] = [];

    for (const match of slashMatches) {
      const cmd = match.command;
      const IconComp = pageIcons[cmd.icon] || Package;
      const item: DisplayItem = {
        id: `slash-${cmd.id}`,
        title: cmd.label,
        subtitle: cmd.description,
        href: "", // Slash commands use action execution, not direct navigation
        icon: IconComp,
        typeLabel: match.isPageSpecific ? undefined : "Global",
      };
      if (match.isPageSpecific) {
        pageSpecific.push(item);
      } else {
        global.push(item);
      }
    }

    return [...pageSpecific, ...global];
  }, [isSlashMode, slashMatches, isDrilling, isAtEntityMode]);

  const executeSlashCommand = useCallback((cmd: SlashCommand) => {
    const entityId = extractEntityId(pathname);
    setOpen(false);

    switch (cmd.action.type) {
      case "navigate": {
        const path = cmd.action.path.replace(":id", entityId || "");
        router.push(path);
        break;
      }
      case "navigate_section": {
        const el = document.getElementById(cmd.action.hash);
        if (el) {
          el.scrollIntoView({ behavior: "smooth" });
        }
        break;
      }
      case "open_dialog": {
        window.dispatchEvent(
          new CustomEvent("slash-command", { detail: { dialog: cmd.action.dialog } })
        );
        break;
      }
      case "generate_document": {
        if (entityId) {
          window.open(`/api/documents/${entityId}?type=${cmd.action.docType}`, "_blank");
        }
        break;
      }
      case "trigger": {
        // Handle logout specially — no need to dispatch an event
        if (cmd.action.event === "logout") {
          signOut();
          return;
        }
        window.dispatchEvent(
          new CustomEvent("slash-command", { detail: { event: cmd.action.event } })
        );
        break;
      }
    }
  }, [pathname, router]);

  // ─── @ mode: build page command results ──────────────────────

  const atQuery = isAtMode ? query.slice(1) : "";
  const atMatches = useMemo(() => {
    if (!isAtMode || isDrilling || isAtEntityMode) return [];
    return matchPageCommands(atQuery);
  }, [isAtMode, atQuery, isDrilling, isAtEntityMode]);

  // Determine the top searchable page match and any entity query text
  const atSearchInfo = useMemo(() => {
    if (!isAtMode || isDrilling || isAtEntityMode) return null;
    const topMatch = atMatches[0];
    if (!topMatch || topMatch.score < 60) return null;
    if (!topMatch.command.searchable) return null;
    return {
      command: topMatch.command,
      entityQuery: topMatch.entityQuery || "",
    };
  }, [isAtMode, atMatches, isDrilling, isAtEntityMode]);

  // Derived values for the effect to depend on (stable primitives, not object refs)
  const atSearchType = atSearchInfo?.command.searchType || null;
  const atSearchEntityQuery = atSearchInfo?.entityQuery || "";
  const atSearchStatusFilter = atSearchInfo?.command.searchStatusFilter || null;

  // Trigger entity search when we have a searchable page match with a query
  useEffect(() => {
    if (!atSearchType || !atSearchEntityQuery || atSearchEntityQuery.length < 2) {
      setAtEntityResults([]);
      return;
    }
    setAtEntityLoading(true);
    const typeMap: Record<string, SearchResultType[]> = {
      model: ["model"],
      asset: ["model", "asset", "bulk-asset", "kit"],
      kit: ["kit"],
      project: ["project"],
      client: ["client"],
      location: ["location"],
      maintenance: ["maintenance"],
      supplier: ["supplier"],
      crew: ["crew"],
      "check-item": ["check-item"],
      "group-template": ["group-template"],
      "sub-hire": ["sub-hire"],
    };
    const allowedTypes = typeMap[atSearchType] || [];
    const statusFilter = atSearchStatusFilter;
    let aborted = false;
    const timer = setTimeout(() => {
      globalSearch(atSearchEntityQuery).then((data) => {
        if (aborted) return;
        const filtered = (data.results as SearchResult[]).filter(
          (r) => allowedTypes.includes(r.type)
            && (!statusFilter || !r.status || statusFilter.includes(r.status))
        );
        setAtEntityResults(filtered);
        setSelectedIndex(0);
      }).catch(() => {
        if (!aborted) setAtEntityResults([]);
      }).finally(() => {
        if (!aborted) setAtEntityLoading(false);
      });
    }, 200);
    return () => { aborted = true; clearTimeout(timer); };
  }, [atSearchType, atSearchEntityQuery, atSearchStatusFilter, globalSearch]);

  // Get entity text from the top match (if any space-separated text exists)
  const atEntityText = useMemo(() => {
    if (!isAtMode || isDrilling || isAtEntityMode) return "";
    const topMatch = atMatches[0];
    if (!topMatch || topMatch.score < 60) return "";
    return topMatch.entityQuery || "";
  }, [isAtMode, atMatches, isDrilling, isAtEntityMode]);

  // Build display items for @ mode — pages + inline entity results
  const atDisplayItems = useMemo((): DisplayItem[] => {
    if (!isAtMode || isDrilling || isAtEntityMode) return [];

    const items: DisplayItem[] = [];
    const shown = new Set<string>();

    const topMatch = atMatches[0];
    const hasEntityQuery = atSearchInfo?.entityQuery && atSearchInfo.entityQuery.length >= 2;

    // When there's entity text, show: parent page, matching child pages, then entity results
    if (hasEntityQuery && topMatch && topMatch.score >= 60) {
      const cmd = topMatch.command;
      const IconComp = pageIcons[cmd.icon] || Package;

      // Parent page
      items.push({
        id: `page-${cmd.href}`,
        title: cmd.label,
        subtitle: cmd.description,
        href: cmd.href,
        icon: IconComp,
        hasChildren: !!cmd.children?.length || !!cmd.searchable,
      });

      // Child pages (always show — auto-select will pick the best match)
      if (cmd.children) {
        for (const child of cmd.children) {
          const ChildIcon = pageIcons[child.icon] || Package;
          items.push({
            id: `page-${child.href}`,
            title: child.label,
            subtitle: child.description,
            href: child.href,
            icon: ChildIcon,
            isChild: true,
          });
        }
      }

      // Entity results (from searchable pages)
      if (atSearchInfo) {
        const hrefPrefix = cmd.searchHrefPrefix;
        const hrefSuffix = cmd.searchHrefSuffix || "";
        for (const r of atEntityResults) {
          const baseHref = hrefPrefix ? `${hrefPrefix}/${r.id}` : r.href;
          items.push({
            id: `${r.type}-${r.id}`,
            title: r.title,
            subtitle: r.subtitle,
            href: `${baseHref}${hrefSuffix}`,
            icon: typeIcons[r.type] || Package,
            isChild: r.isChild,
            typeLabel: r.isChild ? undefined : typeLabels[r.type],
          });
        }
      }

      return items;
    }

    // No entity query — show page commands with their child pages
    for (const match of atMatches) {
      const cmd = match.command;
      if (shown.has(cmd.href)) continue;
      shown.add(cmd.href);

      const IconComp = pageIcons[cmd.icon] || Package;
      items.push({
        id: `page-${cmd.href}`,
        title: cmd.label,
        subtitle: cmd.description,
        href: cmd.href,
        icon: IconComp,
        hasChildren: !!cmd.children?.length || !!cmd.searchable,
      });

      // Show child pages of this command
      if (cmd.children) {
        for (const child of cmd.children) {
          if (shown.has(child.href)) continue;
          shown.add(child.href);
          const ChildIcon = pageIcons[child.icon] || Package;
          items.push({
            id: `page-${child.href}`,
            title: child.label,
            subtitle: child.description,
            href: child.href,
            icon: ChildIcon,
            isChild: true,
          });
        }
      }
    }

    return items;
  }, [isAtMode, atMatches, isDrilling, isAtEntityMode, atSearchInfo, atEntityResults]);

  // The parent page href that was matched by the command part (before the space)
  // This page should never be auto-selected — the user already typed it
  const atParentHref = useMemo(() => {
    if (!isAtMode || isDrilling || isAtEntityMode) return null;
    const topMatch = atMatches[0];
    if (!topMatch || topMatch.score < 60) return null;
    return topMatch.command.href;
  }, [isAtMode, atMatches, isDrilling, isAtEntityMode]);

  // Auto-select the best matching item when there's entity text after the command
  // e.g. "@tnt test" highlights "Quick Test", "@project template" highlights "Templates"
  useEffect(() => {
    if (!isAtMode || isDrilling || isAtEntityMode) return;
    if (!atEntityText || atEntityText.length < 1) return;
    if (atDisplayItems.length === 0) return;

    const nq = normalize(atEntityText);
    if (!nq) return;

    const nqWords = atEntityText.trim().toLowerCase().split(/\s+/).map(w => normalize(w)).filter(Boolean);

    let bestIdx = 0;
    let bestScore = -1;

    for (let i = 0; i < atDisplayItems.length; i++) {
      const item = atDisplayItems[i];

      // Skip the parent page — it was already matched by the command part
      if (item.id === `page-${atParentHref}`) continue;

      const nTitle = normalize(item.title);
      const nSub = normalize(item.subtitle || "");

      let score = 0;
      if (nTitle === nq) score = 100;
      else if (nTitle.startsWith(nq)) score = 80;
      else if (nTitle.includes(nq)) score = 60;
      else {
        // Check if all individual words match (any order)
        const allWordsMatch = nqWords.length > 1 && nqWords.every(w => nTitle.includes(w) || nSub.includes(w));
        if (allWordsMatch) score = 55;
        else if (nSub.includes(nq)) score = 40;
        else {
          // Single-word partial matches on title
          const anyWordInTitle = nqWords.some(w => nTitle.includes(w));
          if (anyWordInTitle) score = 35;
          else {
            // Subsequence match
            let ti = 0;
            for (let qi = 0; qi < nq.length && ti < nTitle.length; ti++) {
              if (nTitle[ti] === nq[qi]) qi++;
              if (qi === nq.length) { score = 20; break; }
            }
          }
        }
      }

      // Prefer entity results over child page links
      if (score > 0 && !item.id.startsWith("page-")) score += 2;

      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestScore > 0) {
      setSelectedIndex(bestIdx);
    }
  }, [atDisplayItems, atEntityText, atParentHref, isAtMode, isDrilling, isAtEntityMode]);

  // ─── @ entity drill mode (Tab on a page to search its entities) ──

  const atEntityDrillItems = useMemo((): DisplayItem[] => {
    if (!isAtEntityMode) return [];
    const items: DisplayItem[] = [];

    if (drillQuery.length < 2) return items;

    // We'll populate from atEntityResults which are set by the effect below
    const hrefPrefix = atEntityPage?.searchHrefPrefix;
    const hrefSuffix = atEntityPage?.searchHrefSuffix || "";
    for (const r of atEntityResults) {
      const baseHref = hrefPrefix ? `${hrefPrefix}/${r.id}` : r.href;
      items.push({
        id: `${r.type}-${r.id}`,
        title: r.title,
        subtitle: r.subtitle,
        href: `${baseHref}${hrefSuffix}`,
        icon: typeIcons[r.type] || Package,
        isChild: r.isChild,
      });
    }
    return items;
  }, [isAtEntityMode, atEntityResults, drillQuery, atEntityPage]);

  // Trigger search when in @ entity drill mode
  const atEntitySearchType = atEntityPage?.searchType || null;
  const atEntityStatusFilter = atEntityPage?.searchStatusFilter || null;
  useEffect(() => {
    if (!isAtEntityMode || !atEntitySearchType || drillQuery.length < 2) {
      if (isAtEntityMode) setAtEntityResults([]);
      return;
    }
    setAtEntityLoading(true);
    const typeMap: Record<string, SearchResultType[]> = {
      model: ["model"],
      asset: ["model", "asset", "bulk-asset", "kit"],
      kit: ["kit"],
      project: ["project"],
      client: ["client"],
      location: ["location"],
      maintenance: ["maintenance"],
      supplier: ["supplier"],
      crew: ["crew"],
      "check-item": ["check-item"],
      "group-template": ["group-template"],
      "sub-hire": ["sub-hire"],
    };
    const allowedTypes = typeMap[atEntitySearchType] || [];
    const statusFilter = atEntityStatusFilter;
    let aborted = false;
    const timer = setTimeout(() => {
      globalSearch(drillQuery).then((data) => {
        if (aborted) return;
        const filtered = (data.results as SearchResult[]).filter(
          (r) => allowedTypes.includes(r.type)
            && (!statusFilter || !r.status || statusFilter.includes(r.status))
        );
        setAtEntityResults(filtered);
        setSelectedIndex(0);
      }).catch(() => {
        if (!aborted) setAtEntityResults([]);
      }).finally(() => {
        if (!aborted) setAtEntityLoading(false);
      });
    }, 200);
    return () => { aborted = true; clearTimeout(timer); };
  }, [isAtEntityMode, drillQuery, atEntitySearchType, atEntityStatusFilter, globalSearch]);

  // ─── Normal search: filter drill children ────────────────────

  const filteredDrillChildren = useMemo(() => {
    if (!isDrilling || isAtEntityMode) return [];
    if (!drillQuery) return drillChildren;
    const nq = normalize(drillQuery);
    if (!nq) return drillChildren;

    const scored = drillChildren.map((child) => {
      const nTitle = normalize(child.title);
      const nSub = normalize(child.subtitle || "");
      let score = 0;
      if (nTitle === nq) score = 100;
      else if (nTitle.startsWith(nq)) score = 80;
      else if (nTitle.includes(nq)) score = 60;
      else if (nSub.includes(nq)) score = 40;
      else {
        let ti = 0;
        for (let qi = 0; qi < nq.length && ti < nTitle.length; ti++) {
          if (nTitle[ti] === nq[qi]) qi++;
          if (qi === nq.length) { score = 20; break; }
        }
      }
      return { child, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((s) => s.child);
  }, [isDrilling, isAtEntityMode, drillChildren, drillQuery]);

  // ─── Date detection for availability shortcut ──────────────
  // Works in both normal mode ("11/05/26") and @ mode ("@26/01/2026 drum shield")
  const dateInfo = useMemo(() => {
    if (isDrilling || isAtEntityMode) return null;

    const raw = isAtMode ? atQuery : query;
    const spaceIdx = raw.indexOf(" ");
    const datePart = spaceIdx >= 0 ? raw.slice(0, spaceIdx) : raw;
    const searchPart = spaceIdx >= 0 ? raw.slice(spaceIdx + 1).trim() : "";

    const parsed = tryParseDate(datePart);
    if (!parsed) return null;

    // Format as local YYYY-MM-DD (avoid toISOString which converts to UTC)
    const iso = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
    const formatted = parsed.toLocaleDateString("en-AU", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });

    return { date: parsed, iso, formatted, searchPart };
  }, [query, atQuery, isAtMode, isDrilling, isAtEntityMode]);

  // When date + search text, fetch matching entities
  const [dateSearchResults, setDateSearchResults] = useState<SearchResult[]>([]);
  const [dateSearchLoading, setDateSearchLoading] = useState(false);
  const dateSearchQuery = dateInfo?.searchPart || "";

  useEffect(() => {
    if (!dateInfo || !dateSearchQuery || dateSearchQuery.length < 2) {
      setDateSearchResults([]);
      return;
    }
    setDateSearchLoading(true);
    let aborted = false;
    const timer = setTimeout(() => {
      globalSearch(dateSearchQuery).then((data) => {
        if (aborted) return;
        // Only show models, assets, bulk-assets, kits
        const filtered = (data.results as SearchResult[]).filter(
          (r) => ["model", "asset", "bulk-asset", "kit"].includes(r.type)
        );
        setDateSearchResults(filtered);
        // Auto-select first entity (index 1, after the date header)
        if (filtered.length > 0) setSelectedIndex(1);
      }).catch(() => {
        if (!aborted) setDateSearchResults([]);
      }).finally(() => {
        if (!aborted) setDateSearchLoading(false);
      });
    }, 200);
    return () => { aborted = true; clearTimeout(timer); };
  }, [dateInfo, dateSearchQuery, globalSearch]);

  // Build the date availability item + entity results
  const dateItem = useMemo((): DisplayItem | null => {
    if (!dateInfo) return null;
    return {
      id: `date-${dateInfo.iso}`,
      title: `Availability for ${dateInfo.formatted}`,
      subtitle: dateInfo.searchPart
        ? `Showing results for "${dateInfo.searchPart}"`
        : "View asset availability calendar",
      href: `/availability?date=${dateInfo.iso}`,
      icon: CalendarRange,
    };
  }, [dateInfo]);

  const dateEntityItems = useMemo((): DisplayItem[] => {
    if (!dateInfo || !dateSearchResults.length) return [];
    return dateSearchResults.map((r) => ({
      id: `date-entity-${r.type}-${r.id}`,
      title: r.title,
      subtitle: r.subtitle,
      // Navigate to the entity's own page with the date param
      href: `${r.href}?date=${dateInfo.iso}`,
      icon: typeIcons[r.type] || Package,
      isChild: r.isChild,
      typeLabel: r.isChild ? undefined : typeLabels[r.type],
    }));
  }, [dateInfo, dateSearchResults]);

  // ─── Build visible items based on current mode ───────────────

  const visibleItems = useMemo((): DisplayItem[] => {
    // / slash command mode
    if (isSlashMode && !isDrilling && !isAtEntityMode) {
      return slashDisplayItems;
    }

    // @ entity drill mode (Tab on a page)
    if (isAtEntityMode) {
      return atEntityDrillItems;
    }

    // Drill-down mode (Tab on a search result)
    if (isDrilling) {
      return filteredDrillChildren;
    }

    // @ mode — if date detected, show date + entity results; otherwise page commands
    if (isAtMode) {
      if (dateItem) {
        // Date with search: show date header + matching entities
        if (dateEntityItems.length > 0) {
          return [dateItem, ...dateEntityItems];
        }
        // Date only: just the availability link
        return [dateItem, ...atDisplayItems];
      }
      return atDisplayItems;
    }

    // Normal search mode
    const items: DisplayItem[] = [];

    // Date shortcut at the top
    if (dateItem) {
      items.push(dateItem);
      // If date + search text, show matching entities below
      if (dateEntityItems.length > 0) {
        items.push(...dateEntityItems);
      }
    }

    const normalResults = expanded
      ? results
      : results.filter((r) => !r.isChild);

    for (const r of normalResults) {
      const fullIdx = results.indexOf(r);
      const hasKids = !r.isChild && fullIdx >= 0 && fullIdx + 1 < results.length && results[fullIdx + 1]?.isChild;

      items.push({
        id: `${r.type}-${r.id}`,
        title: r.title,
        subtitle: r.subtitle,
        href: r.href,
        icon: (r.isChild ? CornerDownRight : typeIcons[r.type]) || Package,
        isChild: r.isChild,
        typeLabel: r.isChild ? undefined : typeLabels[r.type],
        hasChildren: hasKids,
      });
    }

    return items;
  }, [isSlashMode, slashDisplayItems, isAtEntityMode, atEntityDrillItems, isDrilling, filteredDrillChildren,
      isAtMode, atDisplayItems, expanded, results, dateItem, dateEntityItems]);

  // ─── Lifecycle ───────────────────────────────────────────────

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
        return;
      }

      // `/` opens the palette pre-filled for slash commands — but only when
      // it wouldn't steal focus from a real input. Pages that have their own
      // search box opt out by rendering a `[data-search-input]` element.
      if (e.key === "/" && !(e.metaKey || e.ctrlKey)) {
        const active = document.activeElement;
        const tag = active?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || (active as HTMLElement)?.isContentEditable) {
          return;
        }
        if (document.querySelector("[data-search-input]")) {
          // Let the page's own search input handle the keystroke.
          return;
        }
        e.preventDefault();
        setOpen(true);
        setQuery("/");
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
      exitDrill();
      exitAtEntity();
    }
  }, [open]);

  useEffect(() => {
    const el = itemRefs.current.get(selectedIndex);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // ─── Search ──────────────────────────────────────────────────

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await globalSearch(q);
      setResults(data.results as SearchResult[]);
      setSelectedIndex(0);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [globalSearch]);

  const handleQueryChange = (value: string) => {
    if (isAtEntityMode) {
      setDrillQuery(value);
      setSelectedIndex(0);
      return;
    }
    if (isDrilling) {
      setDrillQuery(value);
      setSelectedIndex(0);
      return;
    }
    setQuery(value);
    setSelectedIndex(0);
    // Only do server search for non-@ non-/ queries that aren't dates
    if (!value.startsWith("@") && !value.startsWith("/") && !tryParseDate(value.trim())) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => doSearch(value), 250);
    }
  };

  const navigateTo = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  // ─── Drill-down ──────────────────────────────────────────────

  const enterDrill = (idx: number) => {
    const item = visibleItems[idx];
    if (!item) return;

    // @ mode: drill into a page's entities
    if (isAtMode && !isDrilling && !isAtEntityMode) {
      // Find the page command
      const match = atMatches.find((m) => `page-${m.command.href}` === item.id);
      const cmd = match?.command;
      if (cmd?.searchable) {
        setAtEntityPage(cmd);
        setDrillQuery("");
        setAtEntityResults([]);
        setSelectedIndex(0);
        return;
      }
      // If it has children, drill into those
      if (cmd?.children?.length) {
        const childItems: DisplayItem[] = cmd.children.map((c) => ({
          id: `page-${c.href}`,
          title: c.label,
          subtitle: c.description,
          href: c.href,
          icon: pageIcons[c.icon] || Package,
        }));
        setDrillParent(item);
        setDrillChildren(childItems);
        setDrillQuery("");
        setSelectedIndex(0);
        return;
      }
      return;
    }

    // Normal search: drill into children
    if (item.isChild) return;
    const fullIdx = results.findIndex((r) => `${r.type}-${r.id}` === item.id);
    if (fullIdx === -1) return;

    const children: DisplayItem[] = [];
    for (let i = fullIdx + 1; i < results.length; i++) {
      const r = results[i];
      if (!r.isChild) break;
      children.push({
        id: `${r.type}-${r.id}`,
        title: r.title,
        subtitle: r.subtitle,
        href: r.href,
        icon: typeIcons[r.type] || Package,
      });
    }
    if (children.length === 0) return;

    setDrillParent(item);
    setDrillChildren(children);
    setDrillQuery("");
    setSelectedIndex(0);
  };

  const exitDrill = () => {
    setDrillParent(null);
    setDrillChildren([]);
    setDrillQuery("");
  };

  const exitAtEntity = () => {
    setAtEntityPage(null);
    setAtEntityResults([]);
    setDrillQuery("");
  };

  // ─── Keyboard ────────────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Escape: exit drill/entity mode first, then close dialog
    if (e.key === "Escape") {
      if (isAtEntityMode) {
        e.preventDefault();
        e.stopPropagation();
        exitAtEntity();
        return;
      }
      if (isDrilling) {
        e.preventDefault();
        e.stopPropagation();
        exitDrill();
        return;
      }
      return; // Let dialog handle close
    }

    // Backspace on empty: exit drill/entity mode
    if (e.key === "Backspace") {
      if (isAtEntityMode && drillQuery === "") {
        e.preventDefault();
        exitAtEntity();
        return;
      }
      if (isDrilling && drillQuery === "") {
        e.preventDefault();
        exitDrill();
        return;
      }
    }

    // Tab: drill into selected item
    if (e.key === "Tab") {
      e.preventDefault();
      if (isAtEntityMode || isDrilling) {
        // In drill mode, Tab navigates to selected
        if (visibleItems[selectedIndex]) {
          navigateTo(visibleItems[selectedIndex].href);
        }
      } else {
        enterDrill(selectedIndex);
      }
      return;
    }

    // Cmd+L: toggle expand/collapse (normal mode only)
    if (e.key === "l" && (e.metaKey || e.ctrlKey) && !isDrilling && !isAtEntityMode && !isAtMode) {
      e.preventDefault();
      setExpanded((prev) => !prev);
      setSelectedIndex(0);
      return;
    }

    // Shift+Right: expand
    if (e.key === "ArrowRight" && e.shiftKey && !isDrilling && !isAtEntityMode && !isAtMode) {
      e.preventDefault();
      if (!expanded) { setExpanded(true); setSelectedIndex(0); }
      return;
    }

    // Shift+Left: collapse
    if (e.key === "ArrowLeft" && e.shiftKey && !isDrilling && !isAtEntityMode && !isAtMode) {
      e.preventDefault();
      if (expanded) { setExpanded(false); setSelectedIndex(0); }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (e.shiftKey && !isDrilling && !isAtEntityMode) {
        let next = selectedIndex + 1;
        while (next < visibleItems.length && visibleItems[next].isChild) next++;
        setSelectedIndex(Math.min(next, visibleItems.length - 1));
      } else {
        setSelectedIndex((i) => Math.min(i + 1, visibleItems.length - 1));
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (e.shiftKey && !isDrilling && !isAtEntityMode) {
        let prev = selectedIndex - 1;
        while (prev > 0 && visibleItems[prev].isChild) prev--;
        setSelectedIndex(Math.max(prev, 0));
      } else {
        setSelectedIndex((i) => Math.max(i - 1, 0));
      }
    } else if (e.key === "Enter" && visibleItems[selectedIndex]) {
      e.preventDefault();
      const item = visibleItems[selectedIndex];
      // Slash command mode: execute the command action
      if (isSlashMode && item.id.startsWith("slash-")) {
        const match = slashMatches.find((m) => `slash-${m.command.id}` === item.id);
        if (match) executeSlashCommand(match.command);
        return;
      }
      // On mobile, Enter drills into items with children instead of navigating
      if (isMobile && item.hasChildren && !isDrilling && !isAtEntityMode) {
        enterDrill(selectedIndex);
      } else {
        navigateTo(item.href);
      }
    }
  };

  // ─── Section labels ──────────────────────────────────────────

  const getSectionLabel = (idx: number): string | null => {
    if (isDrilling || isAtEntityMode || isAtMode) return null;

    // Slash mode: show "Page Actions" / "Global" section headers
    if (isSlashMode) {
      const item = visibleItems[idx];
      const label = item.typeLabel === "Global" ? "Global" : "Page Actions";
      if (idx === 0) return label;
      const prev = visibleItems[idx - 1];
      const prevLabel = prev.typeLabel === "Global" ? "Global" : "Page Actions";
      return prevLabel !== label ? label : null;
    }

    const item = visibleItems[idx];
    if (item.isChild || !item.typeLabel) return null;
    for (let i = idx - 1; i >= 0; i--) {
      if (!visibleItems[i].isChild) {
        return visibleItems[i].typeLabel === item.typeLabel ? null : (item.typeLabel + "s");
      }
    }
    return item.typeLabel + "s";
  };

  const hasChildren = results.some((r) => r.isChild);
  const showExpandToggle = hasChildren && !isDrilling && !isAtEntityMode && !isAtMode;
  const selectedItem = visibleItems[selectedIndex];
  const selectedHasChildren = selectedItem?.hasChildren && !isDrilling && !isAtEntityMode;

  // Determine breadcrumb
  const breadcrumb = isAtEntityMode && atEntityPage
    ? { label: atEntityPage.label, icon: pageIcons[atEntityPage.icon] || Package }
    : isDrilling && drillParent
      ? { label: drillParent.title, icon: drillParent.icon }
      : null;

  const isLoading = loading || atEntityLoading || dateSearchLoading;
  const showEmptySearch = !isAtMode && !isSlashMode && !isDrilling && !isAtEntityMode && query.length >= 2 && visibleItems.length === 0 && !isLoading;
  const showTyping = !isAtMode && !isSlashMode && !isDrilling && !isAtEntityMode && query.length < 2;
  const showAtHint = isAtMode && !isDrilling && !isAtEntityMode && atQuery === "" && visibleItems.length > 0;
  const showSlashHint = isSlashMode && slashQuery === "" && visibleItems.length > 0;

  return (
    <>
      {/* Desktop search trigger */}
      <button
        onClick={() => setOpen(true)}
        className="hidden md:flex items-center gap-2 text-fg-3 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
      >
        <Search className="h-4 w-4" />
        <span>Search...</span>
        <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border bg-bg-inset px-1.5 font-mono font-medium text-fg-3 sm:flex" style={{ fontSize: KB_HINT_FONT_SIZE }}>
          <span className="text-xs">&#8984;</span>K
        </kbd>
      </button>
      {/* Mobile search trigger */}
      <button
        onClick={() => setOpen(true)}
        className="md:hidden flex items-center justify-center h-11 w-11 rounded-md text-fg-3 hover:bg-accent hover:text-accent-foreground transition-colors"
        aria-label="Search"
      >
        <Search className="h-5 w-5" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={`p-0 gap-0 overflow-hidden [&>[data-radix-dialog-close]]:hidden [&>button:last-child]:hidden ${isMobile ? "h-[100dvh] max-h-[100dvh] w-full max-w-full rounded-none border-0" : "sm:max-w-lg"}`} style={isMobile ? { paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" } : undefined}>
          {/* Search input bar */}
          <div className="flex items-center border-b px-3 gap-1">
            {isSlashMode ? (
              <Slash className="h-4 w-4 shrink-0 text-primary" />
            ) : isAtMode && !breadcrumb ? (
              <AtSign className="h-4 w-4 shrink-0 text-primary" />
            ) : (
              <Search className="h-4 w-4 shrink-0 text-fg-3" />
            )}
            {breadcrumb && (
              <button
                onClick={() => { if (isAtEntityMode) exitAtEntity(); else exitDrill(); }}
                className="shrink-0 flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground hover:bg-accent/80 transition-colors"
              >
                <breadcrumb.icon className="h-3 w-3" />
                <span className="truncate" style={{ maxWidth: BREADCRUMB_MAX_WIDTH }}>{breadcrumb.label}</span>
                <ChevronRight className="h-3 w-3 text-fg-3" />
                <X className="h-3 w-3 text-fg-3/60 hover:text-fg" />
              </button>
            )}
            <Input
              ref={inputRef}
              value={isDrilling || isAtEntityMode ? drillQuery : query}
              onChange={(e) => handleQueryChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isAtEntityMode
                  ? `Search ${atEntityPage?.label}...`
                  : isDrilling
                    ? `Filter ${drillParent?.title}...`
                    : "Search... (@ pages, / actions)"
              }
              className="h-11 border-0 shadow-none focus-visible:ring-0 px-2"
            />
            {isLoading && <Loader2 className="h-4 w-4 animate-spin text-fg-3" />}
            {/* @ and / buttons — especially useful on mobile where these are hard to type */}
            {!isAtMode && !isSlashMode && !isDrilling && !isAtEntityMode && (
              <>
                <button
                  onClick={() => { setQuery("/"); inputRef.current?.focus(); }}
                  className="shrink-0 h-8 w-8 flex items-center justify-center rounded-md hover:bg-accent text-fg-3 hover:text-primary transition-colors font-semibold text-sm"
                  title="Page actions (/)"
                >
                  /
                </button>
                <button
                  onClick={() => { setQuery("@"); inputRef.current?.focus(); }}
                  className="shrink-0 h-8 w-8 flex items-center justify-center rounded-md hover:bg-accent text-fg-3 hover:text-primary transition-colors font-semibold text-sm"
                  title="Navigate to page (@)"
                >
                  @
                </button>
              </>
            )}
            {showExpandToggle && (
              <button
                onClick={() => { setExpanded((prev) => !prev); setSelectedIndex(0); }}
                className="shrink-0 p-1 rounded hover:bg-accent text-fg-3 hover:text-fg transition-colors"
                title={expanded ? "Collapse children (⌘L)" : "Expand children (⌘L)"}
              >
                <ChevronsUpDown className="h-4 w-4" />
              </button>
            )}
            {/* Mobile close button */}
            {isMobile && (
              <button
                onClick={() => setOpen(false)}
                className="shrink-0 h-8 w-8 flex items-center justify-center rounded-md hover:bg-accent text-fg-3 hover:text-fg transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Results */}
          <div className={`overflow-y-auto ${isMobile ? "flex-1" : "max-h-[60vh]"}`}>
            {showEmptySearch && (
              <div className="py-6 text-center text-sm text-fg-3">No results found.</div>
            )}
            {isAtEntityMode && drillQuery.length >= 2 && visibleItems.length === 0 && !isLoading && (
              <div className="py-6 text-center text-sm text-fg-3">No results found.</div>
            )}
            {isDrilling && !isAtEntityMode && drillQuery && filteredDrillChildren.length === 0 && (
              <div className="py-6 text-center text-sm text-fg-3">No matching children.</div>
            )}
            {visibleItems.length > 0 && (
              <div className="p-1">
                {showAtHint && (
                  <div className="px-3 pt-1 pb-2 text-xs text-fg-3">
                    Type a page name to navigate · Add a space to search entities (e.g. <span className="font-medium text-primary">@project drum hire</span>)
                  </div>
                )}
                {showSlashHint && (
                  <div className="px-3 pt-1 pb-2 text-xs text-fg-3">
                    Type a command name to filter (e.g. <span className="font-medium text-primary">/quote</span>)
                  </div>
                )}
                {visibleItems.map((item, idx) => {
                  const sectionLabel = getSectionLabel(idx);
                  const isChild = item.isChild && !isDrilling && !isAtEntityMode;

                  return (
                    <div key={`${item.id}-${idx}`}>
                      {sectionLabel && (
                        <div className="px-3 pt-2 pb-1 text-xs font-semibold text-fg-3 uppercase tracking-wider">
                          {sectionLabel}
                        </div>
                      )}
                      <button
                        ref={(el) => {
                          if (el) itemRefs.current.set(idx, el);
                          else itemRefs.current.delete(idx);
                        }}
                        onClick={() => {
                          // Slash command: execute the action
                          if (isSlashMode && item.id.startsWith("slash-")) {
                            const match = slashMatches.find((m) => `slash-${m.command.id}` === item.id);
                            if (match) executeSlashCommand(match.command);
                            return;
                          }
                          // On mobile, tapping a result with children drills in instead of navigating
                          if (isMobile && item.hasChildren && !isDrilling && !isAtEntityMode) {
                            setSelectedIndex(idx);
                            enterDrill(idx);
                          } else {
                            navigateTo(item.href);
                          }
                        }}
                        onMouseEnter={() => !isMobile && setSelectedIndex(idx)}
                        className={`flex w-full items-center gap-3 rounded-md text-left text-sm transition-colors ${
                          isMobile ? "py-3" : "py-1.5"
                        } ${
                          isChild ? "pl-9 pr-3" : "px-3"
                        } ${
                          idx === selectedIndex
                            ? "bg-accent text-accent-foreground"
                            : "text-fg hover:bg-accent/50"
                        }`}
                      >
                        <item.icon className={`h-3.5 w-3.5 shrink-0 ${
                          isChild ? "text-fg-3/50" : "text-fg-3"
                        }`} />
                        <div className="flex-1 min-w-0">
                          <div className={`truncate ${isChild ? "text-xs" : "text-sm font-medium"}`}>
                            {item.title}
                          </div>
                          {item.subtitle && (
                            <div className="truncate text-xs text-fg-3">
                              {item.subtitle}
                            </div>
                          )}
                        </div>
                        {isSlashMode && item.id.startsWith("slash-") && (
                          <span className="shrink-0 rounded border bg-bg-inset px-1.5 py-0.5 font-mono text-fg-3" style={{ fontSize: KB_HINT_FONT_SIZE }}>
                            /{slashMatches.find((m) => `slash-${m.command.id}` === item.id)?.command.command}
                          </span>
                        )}
                        {!isChild && item.typeLabel && !isAtMode && !isSlashMode && (
                          <span className="shrink-0 text-xs text-fg-3/60">
                            {item.typeLabel}
                          </span>
                        )}
                        {item.hasChildren && idx === selectedIndex && !isMobile && (
                          <kbd className="shrink-0 rounded border bg-bg-inset px-1 font-mono text-fg-3" style={{ fontSize: KB_HINT_FONT_SIZE }}>
                            Tab →
                          </kbd>
                        )}
                        {item.hasChildren && isMobile && (
                          <ChevronRight className="h-4 w-4 shrink-0 text-fg-3/60" />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {showTyping && (
              <div className="py-6 text-center text-sm text-fg-3">
                Type to search... <span className="font-medium text-primary">@</span> pages · <span className="font-medium text-primary">/</span> actions
              </div>
            )}
            {isAtEntityMode && drillQuery.length < 2 && (
              <div className="py-6 text-center text-sm text-fg-3">
                Type to search {atEntityPage?.label}...
              </div>
            )}
          </div>

          {/* Footer hints */}
          {(visibleItems.length > 0 || isDrilling || isAtEntityMode) && (
            <div className={`border-t px-3 py-1.5 flex items-center gap-3 text-xs text-fg-3 flex-wrap ${isMobile ? "pb-[calc(0.375rem+env(safe-area-inset-bottom))]" : ""}`}>
              {isMobile ? (
                <>
                  <span>Tap to open</span>
                  {(isDrilling || isAtEntityMode) && (
                    <span>Swipe back to exit</span>
                  )}
                </>
              ) : (
                <>
                  <span className="flex items-center gap-1">
                    <kbd className="rounded border bg-bg-inset px-1 font-mono" style={{ fontSize: KB_HINT_FONT_SIZE }}>↑↓</kbd>
                    navigate
                  </span>
                  {!isDrilling && !isAtEntityMode && !isAtMode && (
                    <span className="flex items-center gap-1">
                      <kbd className="rounded border bg-bg-inset px-1 font-mono" style={{ fontSize: KB_HINT_FONT_SIZE }}>⇧↑↓</kbd>
                      skip
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <kbd className="rounded border bg-bg-inset px-1 font-mono" style={{ fontSize: KB_HINT_FONT_SIZE }}>⏎</kbd>
                    open
                  </span>
                  {selectedHasChildren && (
                    <span className="flex items-center gap-1">
                      <kbd className="rounded border bg-bg-inset px-1 font-mono" style={{ fontSize: KB_HINT_FONT_SIZE }}>Tab</kbd>
                      drill in
                    </span>
                  )}
                  {(isDrilling || isAtEntityMode) && (
                    <span className="flex items-center gap-1">
                      <kbd className="rounded border bg-bg-inset px-1 font-mono" style={{ fontSize: KB_HINT_FONT_SIZE }}>Esc</kbd>
                      back
                    </span>
                  )}
                  {showExpandToggle && (
                    <span className="flex items-center gap-1">
                      <kbd className="rounded border bg-bg-inset px-1 font-mono" style={{ fontSize: KB_HINT_FONT_SIZE }}>⇧←→</kbd>
                      {expanded ? "collapse" : "expand"}
                    </span>
                  )}
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
