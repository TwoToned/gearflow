import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * DESIGN §9.1 focus ring — apply to every hand-built interactive element
 * (registry components already encode it). Red 2px ring offset on the paper bg.
 */
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper";

/** DESIGN §9.1 disabled treatment for hand-built controls. */
export const disabledState = "disabled:opacity-45 disabled:cursor-not-allowed";
