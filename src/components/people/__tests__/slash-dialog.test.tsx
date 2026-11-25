// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import { useSlashDialog } from "@/components/people/use-slash-dialog";
import { SLASH_COMMANDS } from "@/lib/slash-commands";

/**
 * UX Phase 13 (review): the Crew page is a list now, so `/log-time` there navigates to
 * Timesheets, and `/export` still opens the reused ExportDialog through the page's listener.
 */
const fire = (dialog: string) => window.dispatchEvent(new CustomEvent("slash-command", { detail: { dialog } }));

describe("crew slash commands", () => {
  it("crew-log-time navigates to Timesheets (no dialog lives on /crew any more)", () => {
    const cmd = SLASH_COMMANDS.find((c) => c.id === "crew-log-time");
    expect(cmd?.action).toEqual({ type: "navigate", path: "/crew/timesheets" });
  });

  it("crew-export opens the dialog: the page's listener runs the handler for its dialog name", () => {
    const cmd = SLASH_COMMANDS.find((c) => c.id === "crew-export");
    expect(cmd?.action).toEqual({ type: "open_dialog", dialog: "export-timesheets" });
    const open = vi.fn();
    const { unmount } = renderHook(() => useSlashDialog({ "export-timesheets": open }));
    fire("export-timesheets");
    fire("something-else");
    expect(open).toHaveBeenCalledTimes(1);
    unmount();
    fire("export-timesheets");
    expect(open).toHaveBeenCalledTimes(1); // the listener is removed with the page
  });
});
