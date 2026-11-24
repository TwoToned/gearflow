import { createElement } from "react";
import {
  Package, FolderOpen, Users, Boxes, Tag, Box, MapPin, Wrench, Layers, ChevronRight, LayoutDashboard, ListTodo,
  Warehouse, ShieldCheck, BarChart3, Settings, UserCircle, CalendarRange, Container, BookTemplate, PackageCheck,
  PackageX, CreditCard, Palette, Truck, FileText, ClipboardList, Pencil, Copy, Upload, Download, QrCode, ScrollText,
  ScanBarcode, PackagePlus, LogOut, CheckCircle, CircleCheck, CircleX, StickyNote, Share2, HardHat, Briefcase, Clock,
  CalendarOff, ClipboardCheck, Bookmark, PackageOpen, Sun, CornerDownRight,
} from "lucide-react";
import { NAV_ICONS } from "@/components/layout/nav-icons";
import type { SearchResultType } from "@/lib/search-types";

type Icon = React.ComponentType<{ className?: string }>;

/** A record's icon, by result type. */
const TYPE_ICONS: Record<SearchResultType, Icon> = {
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

/** Icons named by the page / slash command registries (`icon: "FolderOpen"`). */
const NAMED_ICONS: Record<string, Icon> = {
  LayoutDashboard, ListTodo, Package, Boxes, Box, CalendarRange, Container, FolderOpen, BookTemplate, Warehouse, Users,
  MapPin, Wrench, ShieldCheck, BarChart3, Settings, UserCircle, PackageCheck, PackageX, CreditCard, Palette, Truck,
  FileText, ClipboardList, Pencil, Copy, Upload, Download, QrCode, ScrollText, ScanBarcode, PackagePlus, LogOut,
  CheckCircle, CircleCheck, CircleX, StickyNote, Share2, HardHat, Briefcase, Clock, CalendarOff, ClipboardCheck,
  Bookmark, PackageOpen, Sun, ChevronRight, CornerDownRight, Tag, Layers,
};

/**
 * A `PaletteRow.icon` key as a component: `type:<SearchResultType>` for a
 * record, else a registry icon name, else a NAV icon key, else Package.
 */
function paletteIcon(key: string): Icon {
  if (key.startsWith("type:")) return TYPE_ICONS[key.slice(5) as SearchResultType] ?? Package;
  return NAMED_ICONS[key] ?? (NAV_ICONS as Record<string, Icon>)[key] ?? Package;
}

/** A row's icon by key. The lookup is a static table, so nothing is created per render. */
export function PaletteIcon({ icon, className }: { icon: string; className?: string }) {
  return createElement(paletteIcon(icon), { className, "aria-hidden": true } as { className?: string });
}
