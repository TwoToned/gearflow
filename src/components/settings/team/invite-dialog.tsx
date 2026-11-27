"use client";
// use-client: form state and a server action (R-8.1.1)

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addMemberByEmail } from "@/server/settings";
import { showError } from "@/lib/show-error";
import { assignableRoles, type TeamInviteSource, type TeamMemberSource } from "@/lib/team-model";
import { refreshOrgMembers } from "@/hooks/use-org-members";
import { refreshPendingInvitations } from "@/hooks/use-pending-invitations";
import { cn } from "@/lib/utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Inline validation, in the order a person would fix it. Pure, so the dialog and its test agree. */
function inviteEmailError(
  email: string,
  members: Pick<TeamMemberSource, "email">[],
  invites: Pick<TeamInviteSource, "email">[],
): string | null {
  const e = email.trim().toLowerCase();
  if (!e) return null;
  if (!EMAIL_RE.test(e)) return "That doesn't look like an email address.";
  if (members.some((m) => m.email?.toLowerCase() === e)) return "They're already a member.";
  if (invites.some((i) => i.email.toLowerCase() === e)) return "They already have an invite. Resend it from the list.";
  return null;
}

/**
 * Invite is a dialog (§9k.3): an email with inline validation, then the roles
 * the viewer may hand out as radios with the live descriptions (one list,
 * `ASSIGNABLE_ROLE_OPTIONS`, filtered by the same policy the server enforces).
 */
export function InviteDialog({
  open,
  onOpenChange,
  orgId,
  viewerRole,
  members,
  invites,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | undefined;
  viewerRole: string | null;
  members: Pick<TeamMemberSource, "email">[];
  invites: Pick<TeamInviteSource, "email">[];
}) {
  const roles = assignableRoles(viewerRole);
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState("member");
  const [touched, setTouched] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  const effectiveRole = roles.some((r) => r.value === role) ? role : roles[0]?.value;
  const error = touched ? inviteEmailError(email, members, invites) : null;
  const blocked = !email.trim() || inviteEmailError(email, members, invites) !== null || !effectiveRole;

  const submit = async () => {
    setTouched(true);
    if (blocked || !effectiveRole) return;
    setPending(true);
    try {
      await addMemberByEmail(email.trim(), effectiveRole);
      refreshOrgMembers(orgId);
      refreshPendingInvitations(orgId);
      toast.success(`Invitation sent to ${email.trim()}`);
      setEmail("");
      setTouched(false);
      onOpenChange(false);
    } catch (e) {
      showError(e, { fallbackTitle: "Couldn't send the invite" });
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription>They get an email with a link to join. Nobody is added until they accept.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email address</Label>
            <Input
              id="invite-email"
              type="email"
              inputMode="email"
              autoComplete="off"
              placeholder="colleague@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "invite-email-error" : undefined}
              className="text-base md:text-ui-text"
            />
            {error ? (
              <p id="invite-email-error" role="alert" className="t-micro text-t-out">
                {error}
              </p>
            ) : null}
          </div>
          <fieldset className="space-y-1">
            <legend className="mb-1 text-badge font-semibold text-muted">Role</legend>
            {roles.map((r) => (
              <label
                key={r.value}
                className={cn(
                  "flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--r)] border border-line px-3 py-2 hover:bg-elev",
                  effectiveRole === r.value && "border-red bg-red-soft/40",
                )}
              >
                <input
                  type="radio"
                  name="invite-role"
                  value={r.value}
                  checked={effectiveRole === r.value}
                  onChange={() => setRole(r.value)}
                  className="mt-1 accent-[var(--red)]"
                />
                <span>
                  <span className="block text-ui-text font-medium text-ink">{r.label}</span>
                  <span className="block t-micro text-muted">{r.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="line" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={pending || blocked}>
              Send invite
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
