/**
 * MCP prompt templates (design §12, "prompt templates for recurring
 * workflows"). Hand-authored — a prompt is a workflow recipe, not a
 * derivation of the registry, so there is nothing here for a generator to
 * produce. Each one is a short set of instructions naming the curated tools
 * to call and in what order; the model still does the reasoning.
 */
interface McpPromptArg {
  name: string;
  description: string;
  required: boolean;
}

export interface McpPromptDef {
  name: string;
  title: string;
  description: string;
  args: readonly McpPromptArg[];
  render: (args: Record<string, string>) => string;
}

export const MCP_PROMPTS: readonly McpPromptDef[] = [
  {
    name: "weekly_availability_sweep",
    title: "Weekly availability sweep",
    description: "Summarise what's booked, what's free, and what's overdue for the coming week.",
    args: [{ name: "weekStartDate", description: "ISO date (YYYY-MM-DD) the week starts on", required: true }],
    render: (args) =>
      `Run a weekly availability sweep starting ${args.weekStartDate ?? "next Monday"}.\n\n` +
      "1. Call `check_availability` for the 7-day window to see every booking.\n" +
      "2. Call `list_overbookings` for the same window and flag any conflicts.\n" +
      "3. Call `get_warehouse_status` to note anything already overdue.\n" +
      "4. Summarise: what's booked, what's free, what needs attention — grouped by day.",
  },
  {
    name: "prep_sheet_review",
    title: "Prep sheet review",
    description: "Review a project's staged pick list before dispatch and flag anything missing.",
    args: [{ name: "projectId", description: "The project (job) id to review", required: true }],
    render: (args) =>
      `Review the prep sheet for project ${args.projectId ?? "<projectId>"} before dispatch.\n\n` +
      "1. Call `get_project` for the full line-item list and dates.\n" +
      "2. For each line item, cross-check `get_asset`/`search_assets` for status (available/in maintenance/already deployed).\n" +
      "3. Flag any line item whose committed asset isn't actually available for the project's dates — suggest `swap_asset` candidates.\n" +
      "4. Only after everything checks out, note that `stage_pick_list` and `dispatch_gear` are the next steps — do not call them without operator confirmation.",
  },
  {
    name: "overbooking_triage",
    title: "Overbooking triage",
    description: "Triage overbooking conflicts across a date range and propose resolutions.",
    args: [
      { name: "startDate", description: "ISO date (YYYY-MM-DD) — start of the range to triage", required: true },
      { name: "endDate", description: "ISO date (YYYY-MM-DD) — end of the range to triage", required: true },
    ],
    render: (args) =>
      `Triage overbooking conflicts between ${args.startDate ?? "<startDate>"} and ${args.endDate ?? "<endDate>"}.\n\n` +
      "1. Call `list_overbookings` for the range.\n" +
      "2. For each conflict, call `search_assets` (or `call_operation` on `reservationConflicts.swapCandidates`) to find a substitute unit.\n" +
      "3. Propose a resolution per conflict (swap, reschedule, or flag for a human to decide) — do NOT call `swap_asset` or any write without operator confirmation, since this is a triage/recommendation pass, not an execution pass.",
  },
];

export const MCP_PROMPTS_BY_NAME: ReadonlyMap<string, McpPromptDef> = new Map(MCP_PROMPTS.map((p) => [p.name, p]));
