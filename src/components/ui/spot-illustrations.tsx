import { type SVGProps } from "react";

type SpotProps = SVGProps<SVGSVGElement> & { className?: string };

const defaultProps: SVGProps<SVGSVGElement> = {
  width: 64,
  height: 64,
  viewBox: "0 0 64 64",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

/** Road case / pelican case with latches and handle */
export function SpotAssets({ className, ...props }: SpotProps) {
  return (
    <svg className={className} {...defaultProps} {...props}>
      {/* Case body */}
      <rect x="10" y="18" width="44" height="32" rx="2" />
      {/* Handle */}
      <path d="M24 18v-4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4" />
      {/* Latches */}
      <rect x="17" y="32" width="6" height="4" rx="1" />
      <rect x="41" y="32" width="6" height="4" rx="1" />
      {/* Center seam */}
      <line x1="10" y1="34" x2="17" y2="34" />
      <line x1="47" y1="34" x2="54" y2="34" />
    </svg>
  );
}

/** Stage plot / floor plan with gear placement markers */
export function SpotProjects({ className, ...props }: SpotProps) {
  return (
    <svg className={className} {...defaultProps} {...props}>
      {/* Floor plan outline */}
      <rect x="10" y="12" width="44" height="40" rx="2" />
      {/* Stage edge */}
      <line x1="10" y1="24" x2="54" y2="24" />
      {/* Gear placement squares */}
      <rect x="18" y="16" width="4" height="4" />
      <rect x="30" y="16" width="4" height="4" />
      <rect x="42" y="16" width="4" height="4" />
      {/* Audience markers */}
      <circle cx="22" cy="36" r="2" />
      <circle cx="32" cy="36" r="2" />
      <circle cx="42" cy="36" r="2" />
    </svg>
  );
}

/** Over-ear headset with mic boom */
export function SpotCrew({ className, ...props }: SpotProps) {
  return (
    <svg className={className} {...defaultProps} {...props}>
      {/* Headband */}
      <path d="M16 32v-6a16 16 0 0 1 32 0v6" />
      {/* Left ear cup */}
      <rect x="12" y="30" width="8" height="12" rx="3" />
      {/* Right ear cup */}
      <rect x="44" y="30" width="8" height="12" rx="3" />
      {/* Mic boom */}
      <path d="M12 38c-4 2-6 6-6 10" />
      {/* Mic */}
      <circle cx="6" cy="50" r="2.5" />
    </svg>
  );
}

/** Wrench and gear/cog */
export function SpotMaintenance({ className, ...props }: SpotProps) {
  return (
    <svg className={className} {...defaultProps} {...props}>
      {/* Gear (cog) */}
      <circle cx="38" cy="24" r="6" />
      <circle cx="38" cy="24" r="10" strokeDasharray="4 3.8" />
      {/* Wrench handle */}
      <path d="M12 52l16-16" />
      {/* Wrench head */}
      <path d="M28 36l-4-4a6 6 0 0 0-8.5 8.5l4 4z" />
      {/* Wrench open jaw */}
      <path d="M8 48l4 4" />
    </svg>
  );
}

/** Calendar page with date marks */
export function SpotCalendar({ className, ...props }: SpotProps) {
  return (
    <svg className={className} {...defaultProps} {...props}>
      {/* Calendar body */}
      <rect x="10" y="14" width="44" height="40" rx="2" />
      {/* Header bar */}
      <line x1="10" y1="26" x2="54" y2="26" />
      {/* Binding rings */}
      <line x1="22" y1="10" x2="22" y2="18" />
      <line x1="42" y1="10" x2="42" y2="18" />
      {/* Date marks */}
      <line x1="18" y1="33" x2="24" y2="33" />
      <line x1="29" y1="33" x2="35" y2="33" />
      <line x1="40" y1="33" x2="46" y2="33" />
      <line x1="18" y1="42" x2="24" y2="42" />
    </svg>
  );
}

/** Paper document with a seal/stamp */
export function SpotDocuments({ className, ...props }: SpotProps) {
  return (
    <svg className={className} {...defaultProps} {...props}>
      {/* Document body with folded corner */}
      <path d="M14 8h26l10 10v38a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" />
      {/* Folded corner */}
      <path d="M40 8v10h10" />
      {/* Text lines */}
      <line x1="20" y1="28" x2="40" y2="28" />
      <line x1="20" y1="34" x2="36" y2="34" />
      {/* Seal/stamp circle */}
      <circle cx="38" cy="48" r="6" />
      <circle cx="38" cy="48" r="3" />
    </svg>
  );
}

/** Handshake */
export function SpotClients({ className, ...props }: SpotProps) {
  return (
    <svg className={className} {...defaultProps} {...props}>
      {/* Left arm */}
      <path d="M6 30h10l6 4" />
      {/* Right arm */}
      <path d="M58 30H48l-6 4" />
      {/* Clasped hands */}
      <path d="M22 34c4-2 8-2 10 0s6 2 10 0" />
      {/* Fingers/grip detail */}
      <path d="M22 34c2 4 6 6 10 4" />
      <path d="M42 34c-2 4-6 6-10 4" />
    </svg>
  );
}

/** Open road case with items/compartments inside */
export function SpotKits({ className, ...props }: SpotProps) {
  return (
    <svg className={className} {...defaultProps} {...props}>
      {/* Case bottom */}
      <rect x="10" y="32" width="44" height="22" rx="2" />
      {/* Open lid (angled back) */}
      <path d="M10 32l4-20h36l4 20" />
      {/* Lid edge */}
      <line x1="14" y1="12" x2="50" y2="12" />
      {/* Compartment dividers inside */}
      <line x1="26" y1="36" x2="26" y2="50" />
      <line x1="42" y1="36" x2="42" y2="50" />
      {/* Item in first compartment */}
      <rect x="14" y="38" width="8" height="8" rx="1" />
    </svg>
  );
}

/** Warehouse/building facade */
export function SpotLocations({ className, ...props }: SpotProps) {
  return (
    <svg className={className} {...defaultProps} {...props}>
      {/* Building outline */}
      <rect x="10" y="16" width="44" height="38" rx="1" />
      {/* Roof peak */}
      <path d="M6 16l26-8 26 8" />
      {/* Roller door */}
      <rect x="22" y="36" width="20" height="18" rx="1" />
      {/* Door horizontal lines */}
      <line x1="22" y1="42" x2="42" y2="42" />
      <line x1="22" y1="48" x2="42" y2="48" />
      {/* Windows */}
      <rect x="16" y="22" width="8" height="6" rx="1" />
      <rect x="40" y="22" width="8" height="6" rx="1" />
    </svg>
  );
}

/** Bell with pulse ring */
export function SpotNotifications({ className, ...props }: SpotProps) {
  return (
    <svg className={className} {...defaultProps} {...props}>
      {/* Bell body */}
      <path d="M24 46h16" />
      <path d="M20 46c0-2-4-6-4-16a16 16 0 0 1 32 0c0 10-4 14-4 16" />
      {/* Bell clapper */}
      <path d="M28 46c0 2.2 1.8 4 4 4s4-1.8 4-4" />
      {/* Pulse ring */}
      <path d="M50 22a20 20 0 0 1 2 8" />
      <path d="M54 18a26 26 0 0 1 4 12" />
    </svg>
  );
}
