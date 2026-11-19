/**
 * The sub-hire order lifecycle's allowed moves: ONE definition shared by the
 * order dialog's Actions menu and the Equipment tab's Orders rows (R-3.1). UX
 * only; `updateSubHireStatusNative` is the authority.
 */
export type SubHireOrderStatus = "DRAFT" | "CONFIRMED" | "ON_HIRE" | "RETURNED" | "CANCELLED";

interface SubHireTransitions {
  forward?: { status: SubHireOrderStatus; label: string };
  cancel?: boolean;
}

export const SUB_HIRE_TRANSITIONS: Record<string, SubHireTransitions> = {
  DRAFT: { forward: { status: "CONFIRMED", label: "Confirm" }, cancel: true },
  CONFIRMED: { forward: { status: "RETURNED", label: "Mark Returned" }, cancel: true },
  ON_HIRE: { forward: { status: "RETURNED", label: "Mark Returned" }, cancel: true },
  RETURNED: {},
  CANCELLED: {},
};
