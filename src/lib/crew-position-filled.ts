import "server-only";

import { deliverSideEffectEmail } from "@/lib/email-side-effect";
import { crewPositionFilledEmail } from "@/lib/crew-emails";
import { buildAssignmentEmailData } from "@/lib/crew-assignment-email-data";

/**
 * "First-come fill" notice — sent to a crew member whose still-open offer was
 * auto-cancelled once the service's required headcount was reached on every
 * day that offer covered (`crewAssignments.autoFillServiceNative`, called from
 * the public respond route). Best-effort: never blocks the accept response that
 * triggers it.
 *
 * A PLAIN server-only module, never a `"use server"` export (UX Phase 15
 * ruling): it has no session and no authz of its own, so as an action any
 * browser session could make the app email any crew member by assignment id.
 * Only the respond route, which already holds the accepted offer's token,
 * imports it.
 */
export async function notifyPositionFilled(assignmentId: string): Promise<void> {
  const { assignment, emailData } = await buildAssignmentEmailData(assignmentId);
  const crewEmail = assignment.crewMember.email;
  if (!crewEmail) return;
  const email = crewPositionFilledEmail(emailData);
  await deliverSideEffectEmail({
    idempotencyKey: `crew-position-filled:${assignmentId}`,
    to: crewEmail,
    subject: email.subject,
    html: email.html,
  });
}
