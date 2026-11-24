/**
 * The Home widget kinds, as a LEAF module: the registry (`dashboard-widgets.ts`)
 * imports every widget component, so a widget that needs the kind type (via
 * `widget-chrome.tsx`'s board context) must not import the registry back
 * (depcruise no-circular).
 */
export type DashboardWidgetKind =
  | "onTheFloorNow"
  | "needsAttention"
  | "statActiveJobs"
  | "statOverdueReturns"
  | "statGearDeployed"
  | "statCrewBooked"
  | "upcomingProjects"
  | "recentActivity"
  | "finishSetupChecklist"
  | "activationChecklist"
  | "myTasks";
