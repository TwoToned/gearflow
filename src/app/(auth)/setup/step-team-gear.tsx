"use client";
// use-client: interactive — form state, Convex/Prisma-backed hooks (R-8.1.1)

import { useState, useEffect } from "react";
import { Loader2, UserPlus, Check, Upload, Plus } from "lucide-react";
import { toast } from "sonner";
import { AuthShell } from "../auth-playful";
import { WizardRail } from "@/components/ui/wizard-rail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CSVImportDialog } from "@/components/assets/csv-import-dialog";
import { addMemberByEmail } from "@/server/settings";
import { useModelWrites } from "@/hooks/use-model-writes";
import { refreshOrgMembers } from "@/hooks/use-org-members";
import { refreshPendingInvitations } from "@/hooks/use-pending-invitations";
import { ASSIGNABLE_ROLE_OPTIONS, type RoleOption } from "@/lib/role-descriptions";
import { TOTAL_STEPS } from "./wizard-steps";
import { capture, AnalyticsEvent, type SetupStepId } from "@/lib/analytics";

interface InviteResult {
  email: string;
  role: string;
  ok: boolean;
  message?: string;
}

interface CreatedModel {
  id: string;
  name: string;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

function roleLabel(value: string): string {
  return ASSIGNABLE_ROLE_OPTIONS.find((r) => r.value === value)?.label ?? value;
}

/**
 * `/setup` step 5 — C5 (#1103), "your team" + "your gear" sectioned onto
 * one screen (the design doc's own framing: "Five screens, sectioned — not
 * eight steps, which tests as a slog" — rows 4/5 of its screen table are
 * two content GROUPS on this one screen, not two wizard steps; the mockup
 * confirms this — there is no separate "Step X of 5 · Your team" panel).
 *
 * Unlike every prior step, there is no `OrgSettings` write here at all —
 * both sections are already-final, independently-live actions the instant
 * you take them (an invite is sent the moment you click "Send invite"; a
 * model is created the moment you click "Add"; a CSV import commits row by
 * row as it runs). D5's "no draft state" applies at the finest possible
 * grain: there is nothing to batch into a "Save and continue", so this
 * screen has no such button — just "Skip for now" (a genuine no-op, unlike
 * C4's location fallback: nothing here is load-bearing enough to need one)
 * and "Finish setup", which do the exact same thing (`onDone()`) under
 * different labels for whichever state the operator is in.
 *
 * Gear import defaults to `type="models"` (not "assets"): a brand-new org
 * has zero models, and an asset needs one to reference, so importing
 * assets first would have nothing to attach to.
 *
 * "Add one by hand" creates a model only — a bare `name` (everything else
 * `modelSchema` needs is optional or defaulted). Deliberately does NOT
 * chain into asset/project creation here: that chained hand-off (model →
 * asset → project → line item) is Phase D's own job (#1107), coached by
 * the activation tour after the wizard hands off — this screen's job is
 * just seeding, per #1068's own phase table ("Your gear ... hands off to
 * Phase D").
 */
export function StepTeamGear({
  orgId,
  onDone,
  onStepOutcome,
}: {
  orgId: string;
  onDone: () => void;
  /** D4 (#1108) — purely additive analytics tally; doesn't affect `onDone`.
   *  "Skip for now" reports "skipped" and "Finish setup" reports "completed"
   *  regardless of whether any invite/model was actually added on this
   *  screen — it reflects which button the operator chose, same as every
   *  earlier step's Skip/Save distinction. */
  onStepOutcome: (outcome: "completed" | "skipped") => void;
}) {
  const modelWrites = useModelWrites();

  useEffect(() => {
    capture(AnalyticsEvent.SetupStepViewed, { step: "team_gear" satisfies SetupStepId });
  }, []);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<RoleOption["value"]>("member");
  const [inviting, setInviting] = useState(false);
  const [invites, setInvites] = useState<InviteResult[]>([]);

  const [modelName, setModelName] = useState("");
  const [creatingModel, setCreatingModel] = useState(false);
  const [createdModels, setCreatedModels] = useState<CreatedModel[]>([]);
  const [csvDialogOpen, setCsvDialogOpen] = useState(false);

  async function handleInvite() {
    const email = inviteEmail.trim();
    if (!email) return;
    setInviting(true);
    try {
      await addMemberByEmail(email, inviteRole);
      refreshOrgMembers(orgId);
      refreshPendingInvitations(orgId);
      setInvites((prev) => [...prev, { email, role: inviteRole, ok: true }]);
      setInviteEmail("");
      toast.success(`Invitation sent to ${email}`);
    } catch (e) {
      setInvites((prev) => [...prev, { email, role: inviteRole, ok: false, message: errorMessage(e) }]);
      toast.error(errorMessage(e));
    } finally {
      setInviting(false);
    }
  }

  async function handleCreateModel() {
    const name = modelName.trim();
    if (!name) return;
    setCreatingModel(true);
    try {
      const { id } = await modelWrites.create({ name });
      setCreatedModels((prev) => [...prev, { id, name }]);
      setModelName("");
      toast.success(`${name} added`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setCreatingModel(false);
    }
  }

  return (
    <AuthShell accent="setup" annotation="the wizard's last stop — the rest is the tour.">
      <WizardRail step={5} total={TOTAL_STEPS} />
      <p className="t-annotation text-[13px] text-red">Step 5 of {TOTAL_STEPS} · Your team &amp; your gear</p>
      <h1 className="t-title mt-1 text-ink">Bring in your crew, seed your inventory.</h1>
      <p className="mt-1 text-sm text-muted">
        Both of these can wait — invite people and add gear any time from Settings and Assets.
      </p>

      <div className="mt-6 space-y-6">
        <TeamInviteSection
          email={inviteEmail}
          onEmailChange={setInviteEmail}
          role={inviteRole}
          onRoleChange={setInviteRole}
          inviting={inviting}
          onInvite={handleInvite}
          invites={invites}
        />

        <GearSection
          modelName={modelName}
          onModelNameChange={setModelName}
          creatingModel={creatingModel}
          onCreateModel={handleCreateModel}
          createdModels={createdModels}
          onImportClick={() => setCsvDialogOpen(true)}
        />

        <div className="flex items-center justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={() => {
              capture(AnalyticsEvent.SetupStepSkipped, { step: "team_gear" satisfies SetupStepId });
              onStepOutcome("skipped");
              onDone();
            }}
            className="text-sm text-muted hover:text-ink"
          >
            Skip for now
          </button>
          <Button
            onClick={() => {
              capture(AnalyticsEvent.SetupStepCompleted, { step: "team_gear" satisfies SetupStepId });
              onStepOutcome("completed");
              onDone();
            }}
          >
            Finish setup
          </Button>
        </div>
      </div>

      <CSVImportDialog type="models" open={csvDialogOpen} onOpenChange={setCsvDialogOpen} />
    </AuthShell>
  );
}

/** The team-invite section — split out purely to keep the main component's
 *  own complexity down. Each invite sends immediately (no batching, same
 *  live-send pattern `InviteMember` on the Settings page already uses); a
 *  local list just shows what was sent this session, since a brand-new org
 *  has no members/invites to load yet. */
function TeamInviteSection({
  email,
  onEmailChange,
  role,
  onRoleChange,
  inviting,
  onInvite,
  invites,
}: {
  email: string;
  onEmailChange: (v: string) => void;
  role: RoleOption["value"];
  onRoleChange: (v: RoleOption["value"]) => void;
  inviting: boolean;
  onInvite: () => void;
  invites: InviteResult[];
}) {
  const selected = ASSIGNABLE_ROLE_OPTIONS.find((r) => r.value === role);
  return (
    <div className="space-y-3 rounded-[var(--r)] border-2 border-line-2 bg-elev p-4">
      <h4 className="t-body font-medium text-ink">Your team</h4>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="invite-email">Email address</Label>
          <Input
            id="invite-email"
            type="email"
            placeholder="colleague@company.com"
            value={email}
            disabled={inviting}
            onChange={(e) => onEmailChange(e.target.value)}
            onKeyDown={(e) => {
              // Same in-flight guard as the button's own `disabled` — held
              // Enter (OS key-repeat) or a fast double-tap otherwise bypasses
              // it entirely, since a keydown handler doesn't respect a
              // sibling button's disabled state on its own.
              if (e.key === "Enter" && email.trim() && !inviting) {
                e.preventDefault();
                onInvite();
              }
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invite-role">Role</Label>
          <Select value={role} onValueChange={(v) => onRoleChange(v as RoleOption["value"])}>
            <SelectTrigger id="invite-role" className="w-full sm:w-[160px]">
              <SelectValue>{selected?.label ?? role}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ASSIGNABLE_ROLE_OPTIONS.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="button" onClick={onInvite} disabled={inviting || !email.trim()}>
          {inviting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
          Send invite
        </Button>
      </div>
      {selected && <p className="text-xs text-fg-3">{selected.description}</p>}
      <InviteList invites={invites} />
    </div>
  );
}

function InviteList({ invites }: { invites: InviteResult[] }) {
  if (invites.length === 0) return null;
  return (
    <ul className="space-y-1 pt-1">
      {invites.map((inv, i) => (
        <li key={`${inv.email}-${i}`} className="flex items-center gap-1.5 text-xs">
          {inv.ok ? (
            <>
              <Check className="h-3 w-3 flex-none text-ok" aria-hidden />
              <span className="text-fg-2">
                {inv.email} — {roleLabel(inv.role)}
              </span>
            </>
          ) : (
            <span className="text-red">
              {inv.email}: {inv.message}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The gear section — split out purely to keep the main component's own
 *  complexity down. */
function GearSection({
  modelName,
  onModelNameChange,
  creatingModel,
  onCreateModel,
  createdModels,
  onImportClick,
}: {
  modelName: string;
  onModelNameChange: (v: string) => void;
  creatingModel: boolean;
  onCreateModel: () => void;
  createdModels: CreatedModel[];
  onImportClick: () => void;
}) {
  return (
    <div className="space-y-3 rounded-[var(--r)] border-2 border-line-2 bg-elev p-4">
      <h4 className="t-body font-medium text-ink">Your gear</h4>
      <p className="text-xs text-fg-3">Import a spreadsheet, or add your first model by hand.</p>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="line" onClick={onImportClick}>
          <Upload className="mr-2 h-4 w-4" />
          Import a spreadsheet
        </Button>
        <div className="flex items-center gap-2">
          <Input
            aria-label="Model name"
            value={modelName}
            disabled={creatingModel}
            onChange={(e) => onModelNameChange(e.target.value)}
            placeholder="e.g. Shure SM58"
            onKeyDown={(e) => {
              // Same in-flight guard as the button's own `disabled` — see
              // the identical comment on the invite-email input above.
              if (e.key === "Enter" && modelName.trim() && !creatingModel) {
                e.preventDefault();
                onCreateModel();
              }
            }}
          />
          <Button type="button" variant="line" onClick={onCreateModel} disabled={creatingModel || !modelName.trim()}>
            {creatingModel ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add
          </Button>
        </div>
      </div>

      {createdModels.length > 0 && (
        <ul className="space-y-1 pt-1">
          {createdModels.map((m) => (
            <li key={m.id} className="flex items-center gap-1.5 text-xs text-fg-2">
              <Check className="h-3 w-3 flex-none text-ok" aria-hidden />
              {m.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
