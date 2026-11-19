// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeployGateDialog, gateReady, type GateAccessory } from "@/components/warehouse/job/deploy-gate-dialog";

const rows: GateAccessory[] = [
  { id: "a", name: "AA batteries", tier: "DEFAULT", parentName: "SM58", officeNote: "Client supplies" },
  { id: "b", name: "Windshield", tier: "OPTIONAL", parentName: "SM58", officeNote: "" },
];

describe("deploy gate", () => {
  it("gateReady: a DEFAULT left behind needs a reason, OPTIONAL does not", () => {
    expect(gateReady(rows, {})).toBe(false);
    expect(gateReady(rows, { a: { id: "a", action: "leave", reason: "" }, b: { id: "b", action: "leave", reason: "" } })).toBe(false);
    expect(gateReady(rows, { a: { id: "a", action: "leave", reason: "x" }, b: { id: "b", action: "leave", reason: "" } })).toBe(true);
    expect(gateReady(rows, { a: { id: "a", action: "pack", reason: "" }, b: { id: "b", action: "pack", reason: "" } })).toBe(true);
  });
  it("D9: leaving a DEFAULT prefills the office note, editable, and confirm returns it", async () => {
    const onConfirm = vi.fn();
    render(<DeployGateDialog rows={rows} onConfirm={onConfirm} onCancel={() => {}} />);
    const leave = screen.getAllByRole("button", { name: "Leave" });
    await userEvent.click(leave[0]);
    const input = screen.getByLabelText("Reason for leaving AA batteries") as HTMLInputElement;
    expect(input.value).toBe("Client supplies");
    await userEvent.type(input, " (per office)");
    await userEvent.click(leave[1]);
    await userEvent.click(screen.getByRole("button", { name: "Deploy" }));
    expect(onConfirm).toHaveBeenCalledWith(expect.arrayContaining([{ id: "a", action: "leave", reason: "Client supplies (per office)" }]));
  });
  it("Deploy stays disabled until every row is decided", async () => {
    render(<DeployGateDialog rows={rows} onConfirm={() => {}} onCancel={() => {}} />);
    expect((screen.getByRole("button", { name: "Deploy" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
