import { cn } from "@/lib/utils";
import {
  Package, FolderOpen, Users, Wrench, Truck, FileText, BarChart3,
  Calendar, MapPin, Settings, Bell, Tag, Box, ClipboardList, UserCheck,
  Clock, type LucideIcon,
} from "lucide-react";
import { Button } from "./button";

// ─── Domain-specific presets ────────────────────────────────────

interface EmptyPreset {
  icon: LucideIcon;
  heading: string;
  description: string;
}

const presets: Record<string, EmptyPreset> = {
  assets: {
    icon: Package,
    heading: "No assets yet",
    description: "Add your first piece of gear to start tracking inventory.",
  },
  models: {
    icon: Box,
    heading: "No models defined",
    description: "Models group identical assets — create one to start adding individual units.",
  },
  projects: {
    icon: FolderOpen,
    heading: "No projects",
    description: "Projects track gigs, shows, and events. Create one to start quoting.",
  },
  clients: {
    icon: Users,
    heading: "No clients",
    description: "Add production companies, venues, and contacts you work with.",
  },
  maintenance: {
    icon: Wrench,
    heading: "No maintenance records",
    description: "Schedule repairs, test & tag, and inspections to keep gear in top shape.",
  },
  warehouse: {
    icon: Truck,
    heading: "Nothing to prep",
    description: "Confirmed projects with upcoming dates will appear here for checkout.",
  },
  documents: {
    icon: FileText,
    heading: "No documents",
    description: "Quotes, invoices, and pull sheets generated from projects appear here.",
  },
  reports: {
    icon: BarChart3,
    heading: "No data to report",
    description: "Reports will populate as you use the system — track projects and assets to see insights.",
  },
  calendar: {
    icon: Calendar,
    heading: "No bookings",
    description: "Confirmed projects and reservations will appear on the calendar.",
  },
  locations: {
    icon: MapPin,
    heading: "No locations",
    description: "Add warehouses, venues, and vehicles to track where gear lives.",
  },
  settings: {
    icon: Settings,
    heading: "Nothing configured",
    description: "Adjust this setting to customise how your organisation uses GearFlow.",
  },
  notifications: {
    icon: Bell,
    heading: "All caught up",
    description: "New notifications will appear here as they come in.",
  },
  categories: {
    icon: Tag,
    heading: "No categories",
    description: "Categories organise your gear — create groups like Audio, Lighting, Video.",
  },
  kits: {
    icon: ClipboardList,
    heading: "No kits",
    description: "Kits bundle assets that always go together — build one to speed up checkout.",
  },
  crew: {
    icon: UserCheck,
    heading: "No crew members",
    description: "Add freelancers, employees, and contractors who work your events.",
  },
  activity: {
    icon: Clock,
    heading: "No activity",
    description: "Actions taken by your team will be logged here for audit trailing.",
  },
  suppliers: {
    icon: Truck,
    heading: "No suppliers",
    description: "Add the vendors and suppliers you purchase or hire gear from.",
  },
  lineItems: {
    icon: ClipboardList,
    heading: "No line items",
    description: "Add assets and kits to this project to build the quote.",
  },
  history: {
    icon: Clock,
    heading: "No history",
    description: "Past checkout and return records will appear here.",
  },
  search: {
    icon: Package,
    heading: "No results",
    description: "Try adjusting your search or filters to find what you're looking for.",
  },
};

// ─── Component ──────────────────────────────────────────────────

interface EmptyStateProps {
  /** Use a preset domain context */
  preset?: keyof typeof presets;
  /** Custom icon (overrides preset) */
  icon?: LucideIcon;
  /** Custom heading (overrides preset) */
  heading?: string;
  /** Custom description (overrides preset) */
  description?: string;
  /** Optional CTA button */
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

/**
 * Empty state component per DESIGN.md:
 * - 44px icon container with teal border + teal-subtle background, rounded-[10px]
 * - Heading: 14px/700
 * - Description: 11px, fg-3
 * - Optional primary CTA button
 */
export function EmptyState({
  preset: presetKey,
  icon: customIcon,
  heading: customHeading,
  description: customDescription,
  action,
  className,
}: EmptyStateProps) {
  const preset = presetKey ? presets[presetKey] : undefined;
  const Icon = customIcon ?? preset?.icon ?? Package;
  const heading = customHeading ?? preset?.heading ?? "Nothing here yet";
  const description = customDescription ?? preset?.description ?? "Items will appear here once added.";

  return (
    <div className={cn("flex flex-col items-center py-12 text-center", className)}>
      <div className="mb-3 flex size-11 items-center justify-center rounded-[10px] border border-primary/20 bg-teal-subtle">
        <Icon className="size-5 text-primary" strokeWidth={1.75} />
      </div>
      <h3 className="t-heading text-fg">{heading}</h3>
      <p className="mt-1 max-w-[280px] text-[11px] leading-relaxed text-fg-3">
        {description}
      </p>
      {action && (
        <Button size="sm" className="mt-4" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
