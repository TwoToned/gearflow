/**
 * The job TYPE words — ONE map for the Jobs list (filter + column) and the job
 * header's meta line (UX Phase 7). An unknown value falls back to the caller's
 * own formatting.
 */
export const PROJECT_TYPE_LABELS: Record<string, string> = {
  DRY_HIRE: "Dry hire",
  WET_HIRE: "Wet hire",
  INSTALLATION: "Installation",
  TOUR: "Tour",
  CORPORATE: "Corporate",
  THEATRE: "Theatre",
  FESTIVAL: "Festival",
  CONFERENCE: "Conference",
  OTHER: "Other",
};
