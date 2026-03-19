import { cn } from "@/lib/utils";
import {
  Package, FolderOpen, Users, Wrench, Truck, FileText, BarChart3,
  Calendar, MapPin, Settings, Bell, Tag, Box, ClipboardList, UserCheck,
  Clock, type LucideIcon,
} from "lucide-react";
import { type ComponentType, type SVGProps } from "react";
import { Button } from "./button";
import { FadeIn } from "./motion";
import {
  SpotAssets, SpotProjects, SpotCrew, SpotMaintenance,
  SpotCalendar, SpotDocuments, SpotClients, SpotKits,
  SpotLocations, SpotNotifications,
} from "./spot-illustrations";

// ─── Domain-specific presets ────────────────────────────────────

type SpotIllustration = ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;

interface EmptyPreset {
  icon: LucideIcon;
  heading: string;
  description: string;
  spotIllustration?: SpotIllustration | null;
}

const presets: Record<string, EmptyPreset> = {
  assets: {
    icon: Package,
    heading: "No assets yet",
    description: "Add your first piece of gear to start tracking inventory.",
    spotIllustration: SpotAssets,
  },
  models: {
    icon: Box,
    heading: "No models defined",
    description: "Models group identical assets — create one to start adding individual units.",
    spotIllustration: SpotAssets,
  },
  projects: {
    icon: FolderOpen,
    heading: "No projects",
    description: "Projects track gigs, shows, and events. Create one to start quoting.",
    spotIllustration: SpotProjects,
  },
  clients: {
    icon: Users,
    heading: "No clients",
    description: "Add production companies, venues, and contacts you work with.",
    spotIllustration: SpotClients,
  },
  maintenance: {
    icon: Wrench,
    heading: "No maintenance records",
    description: "Schedule repairs, test & tag, and inspections to keep gear in top shape.",
    spotIllustration: SpotMaintenance,
  },
  warehouse: {
    icon: Truck,
    heading: "Nothing to prep",
    description: "Confirmed projects with upcoming dates will appear here for checkout.",
    spotIllustration: SpotAssets,
  },
  documents: {
    icon: FileText,
    heading: "No documents",
    description: "Quotes, invoices, and pull sheets generated from projects appear here.",
    spotIllustration: SpotDocuments,
  },
  reports: {
    icon: BarChart3,
    heading: "No data to report",
    description: "Reports will populate as you use the system — track projects and assets to see insights.",
    spotIllustration: SpotDocuments,
  },
  calendar: {
    icon: Calendar,
    heading: "No bookings",
    description: "Confirmed projects and reservations will appear on the calendar.",
    spotIllustration: SpotCalendar,
  },
  locations: {
    icon: MapPin,
    heading: "No locations",
    description: "Add warehouses, venues, and vehicles to track where gear lives.",
    spotIllustration: SpotLocations,
  },
  settings: {
    icon: Settings,
    heading: "Nothing configured",
    description: "Adjust this setting to customise how your organisation uses GearFlow.",
    spotIllustration: null,
  },
  notifications: {
    icon: Bell,
    heading: "All caught up",
    description: "New notifications will appear here as they come in.",
    spotIllustration: SpotNotifications,
  },
  categories: {
    icon: Tag,
    heading: "No categories",
    description: "Categories organise your gear — create groups like Audio, Lighting, Video.",
    spotIllustration: SpotAssets,
  },
  kits: {
    icon: ClipboardList,
    heading: "No kits",
    description: "Kits bundle assets that always go together — build one to speed up checkout.",
    spotIllustration: SpotKits,
  },
  crew: {
    icon: UserCheck,
    heading: "No crew members",
    description: "Add freelancers, employees, and contractors who work your events.",
    spotIllustration: SpotCrew,
  },
  activity: {
    icon: Clock,
    heading: "No activity",
    description: "Actions taken by your team will be logged here for audit trailing.",
    spotIllustration: null,
  },
  suppliers: {
    icon: Truck,
    heading: "No suppliers",
    description: "Add the vendors and suppliers you purchase or hire gear from.",
    spotIllustration: SpotClients,
  },
  lineItems: {
    icon: ClipboardList,
    heading: "No line items",
    description: "Add assets and kits to this project to build the quote.",
    spotIllustration: SpotAssets,
  },
  history: {
    icon: Clock,
    heading: "No history",
    description: "Past checkout and return records will appear here.",
    spotIllustration: null,
  },
  search: {
    icon: Package,
    heading: "No results",
    description: "Try adjusting your search or filters to find what you're looking for.",
    spotIllustration: null,
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
 * - Spot illustration at 56px with text-primary/60 when available
 * - Falls back to 44px icon container with teal border + teal-subtle background, rounded-[10px]
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

  // Use spot illustration when available and no custom icon override
  const SpotIllustration = !customIcon ? preset?.spotIllustration : null;

  return (
    <FadeIn>
      <div className={cn("flex flex-col items-center py-12 text-center", className)}>
        {SpotIllustration ? (
          <SpotIllustration className="mb-3 size-14 text-primary/60" />
        ) : (
          <div className="mb-3 flex size-11 items-center justify-center rounded-[10px] border border-primary/20 bg-teal-subtle">
            <Icon className="size-5 text-primary" strokeWidth={1.75} />
          </div>
        )}
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
    </FadeIn>
  );
}
