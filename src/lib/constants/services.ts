import type { ServiceTypeValue } from "../../../convex/lib/serviceTypes";

export const SERVICE_TYPE_LABELS: Record<ServiceTypeValue, string> = {
  DELIVERY: "Delivery",
  PICKUP: "Pickup",
  CLIENT_PICKUP: "Client pick up",
  CLIENT_DROPOFF: "Client drop off",
  BUMP_IN: "Bump In",
  BUMP_OUT: "Bump Out",
  LABOUR: "Labour",
  MISC: "Misc",
};

export const SERVICE_TYPE_ICONS: Record<ServiceTypeValue, string> = {
  DELIVERY: "Truck",
  PICKUP: "Truck",
  CLIENT_PICKUP: "Store",
  CLIENT_DROPOFF: "Store",
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
