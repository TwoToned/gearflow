import type { ServiceType } from "@/generated/prisma/client";

export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  DELIVERY: "Delivery",
  PICKUP: "Pickup",
  BUMP_IN: "Bump In",
  BUMP_OUT: "Bump Out",
  LABOUR: "Labour",
  MISC: "Misc",
};

export const SERVICE_TYPE_ICONS: Record<ServiceType, string> = {
  DELIVERY: "Truck",
  PICKUP: "Truck",
  BUMP_IN: "ArrowDownToLine",
  BUMP_OUT: "ArrowUpFromLine",
  LABOUR: "HardHat",
  MISC: "Wrench",
};

export const SERVICE_STATUS_LABELS: Record<string, string> = {
  PLANNED: "Planned",
  CONFIRMED: "Confirmed",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const SERVICE_STATUS_COLORS: Record<string, string> = {
  PLANNED: "text-fg-3",
  CONFIRMED: "text-green-600 dark:text-green-400",
  IN_PROGRESS: "text-blue-600 dark:text-blue-400",
  COMPLETED: "text-teal-600 dark:text-teal-400",
  CANCELLED: "text-red-600 dark:text-red-400",
};

export const SERVICE_TYPES = [
  "DELIVERY",
  "PICKUP",
  "BUMP_IN",
  "BUMP_OUT",
  "LABOUR",
  "MISC",
] as const;
