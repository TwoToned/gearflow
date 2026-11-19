import {
  LayoutDashboard, FolderOpen, Landmark, CalendarRange, HardHat, Package, Warehouse,
  ShieldCheck, Wrench, Users, Truck, MapPin, ScrollText, Settings, BookTemplate,
  AlertTriangle, Clock, Boxes, Tags, Container, TrendingUp, PackagePlus, Undo2,
  BarChart3, Zap, MoreHorizontal, type LucideIcon,
} from "lucide-react";
import type { NavHue, NavIconKey } from "@/lib/nav";

/** Icon per NAV key — kept out of `nav.ts` so that stays pure data. */
export const NAV_ICONS: Record<NavIconKey, LucideIcon> = {
  home: LayoutDashboard,
  jobs: FolderOpen,
  finance: Landmark,
  schedule: CalendarRange,
  crew: HardHat,
  assets: Package,
  warehouse: Warehouse,
  testTag: ShieldCheck,
  maintenance: Wrench,
  clients: Users,
  suppliers: Truck,
  locations: MapPin,
  activity: ScrollText,
  settings: Settings,
  templates: BookTemplate,
  overbookings: AlertTriangle,
  planner: CalendarRange,
  timesheets: Clock,
  models: Boxes,
  categories: Tags,
  kits: Container,
  roi: TrendingUp,
  salesStock: PackagePlus,
  returns: Undo2,
  registry: Package,
  quickTest: Zap,
  reports: BarChart3,
  more: MoreHorizontal,
};

// Literal hue → class maps (Tailwind can't see dynamic `text-${hue}`).
export const hueText: Record<NavHue, string> = {
  blue: "text-blue", amber: "text-amber", green: "text-green",
  purple: "text-purple", coral: "text-coral", teal: "text-teal",
};
export const hueSoftBg: Record<NavHue, string> = {
  blue: "bg-blue-soft", amber: "bg-amber-soft", green: "bg-green-soft",
  purple: "bg-purple-soft", coral: "bg-coral-soft", teal: "bg-teal-soft",
};
export const hueHoverText: Record<NavHue, string> = {
  blue: "hover:text-blue", amber: "hover:text-amber", green: "hover:text-green",
  purple: "hover:text-purple", coral: "hover:text-coral", teal: "hover:text-teal",
};
export const hueHoverBg: Record<NavHue, string> = {
  blue: "hover:bg-blue-soft", amber: "hover:bg-amber-soft", green: "hover:bg-green-soft",
  purple: "hover:bg-purple-soft", coral: "hover:bg-coral-soft", teal: "hover:bg-teal-soft",
};
