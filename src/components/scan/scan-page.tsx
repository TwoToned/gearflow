"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Printer, Save } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMemberRoster } from "@/hooks/use-member-roster";
import { useScanFeedback } from "@/hooks/use-scan-feedback";
import { useStableNow } from "@/hooks/use-stable-now";
import { useActiveOrganization } from "@/lib/auth-client";
import type { ActionItem, ActionMenuSpec } from "@/lib/primitives/types";
import { buildScanCardMenu, buildScanPageMenu } from "@/lib/row-actions/scan-actions";
import {
  LAST_SCANS_SHOWN,
  SCAN_MODE_LABELS,
  checkableCard,
  exceptionVerdict,
  scanCardAssetId,
  scanCardName,
  ttExceptionVerdict,
  type CheckableCard,
  type LastScan,
  type ScanCardData,
  type ScanMode,
} from "@/lib/scan-page";
import { useCanDo, useCurrentRole } from "@/lib/use-permissions";
import { cn } from "@/lib/utils";
import { useScanTarget } from "@/components/scanner/scan-target";
import { PageMeta } from "@/components/layout/page-meta";
import { ActionMenu } from "@/components/ui/action-menu";
import { PinnedAboveBottomNav } from "@/components/ui/bulk-bar";
import { Button } from "@/components/ui/button";
import { ScanDock } from "@/components/ui/scan-dock";
import { StageFilter } from "@/components/ui/stage-filter";
import { CheckSection } from "./check-section";
import { DiscardDialog } from "./discard-dialog";
import { LastScans } from "./last-scans";
import { ResultCard } from "./result-card";
import { SavePrimary } from "./save-primary";
import { ExceptionState, LoadingState, ReadyState } from "./scan-states";
import { TtBody } from "./tt-body";
import { useCheckMode } from "./use-check-mode";
import { useScanSession } from "./use-scan-session";
import { useTtMode } from "./use-tt-mode";
import { useTtRegister } from "./use-tt-register";

/** The modes this user holds (absent, not greyed): Check needs `warehouse:scan`, T&T `testTag:create`. */
function useHeldModes(): ScanMode[] {
  const check = useCanDo("warehouse", "scan");
  const tt = useCanDo("testTag", "create");
  return [...(check ? (["check"] as const) : []), ...(tt ? (["tt"] as const) : [])];
}

/**
 * The Scan page (spec §9i, Phase 16): `/scan?mode=check|tt&tag=`. One column — head,
 * the mode words, the scan dock, the result card with its inline form, Last scans.
 * Every input path ends in ONE `scan(tag)` (`useScanSession`): the dock's wedge and
 * camera, the bottom-nav Scan (`useScanTarget`), a Last scans row and a deep link.
 * The camera is the dock's own `ScanButton` (one WASM engine, opened from the tap).
 */
export function ScanPage() {
  const held = useHeldModes();
  const { permissions, isLoading } = useCurrentRole();
  const session = useScanSession({ held });
  // Render nothing until the role has loaded (no flash of "Access Denied").
  if (isLoading || !permissions) return null;
  if (!session.mode) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <h2 className="t-title">Access Denied</h2>
        <p className="mt-2 t-body text-fg-3">You don&apos;t have permission to scan.</p>
      </div>
    );
  }
  return <ScanPageBody session={session} held={held} mode={session.mode} />;
}

type Session = ReturnType<typeof useScanSession>;

/** The page's data and the effects that tie the inputs to ONE `scan()`. */
function useScanPageModel(session: Session, mode: ScanMode) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const feedback = useScanFeedback();
  const { tag, lastScans, setDirty } = session;
  const args = orgId && tag ? { orgId, value: tag } : null;
  const checkCard = useAuthedQuery(api.scanLookup.checkCard, args && mode === "check" ? args : "skip");
  const testCard = useAuthedQuery(api.scanLookup.testCard, args && mode === "tt" ? args : "skip");
  const shared = {
    orgId, tag, play: feedback.play, addLastScan: lastScans.add, markUndone: lastScans.markUndone,
    finishScan: session.finishScan, reload: session.reload,
  };
  const check = useCheckMode({ ...shared, card: checkCard });
  const tt = useTtMode({ ...shared, card: testCard });
  const dirty = mode === "check" ? check.dirty : tt.dirty;
  useEffect(() => setDirty(dirty), [setDirty, dirty]);
  // The bottom-nav Scan lands in this page's pipeline, not the shell's lookup.
  useScanTarget((value) => session.scan(value));
  useLogExceptions({ card: mode === "check" ? checkCard : testCard, tag, mode, play: feedback.play, add: lastScans.add });
  return { orgId, feedback, checkCard, testCard, check, tt, checkable: checkableCard(checkCard) };
}

type Model = ReturnType<typeof useScanPageModel>;

/** What the head primary saves, or `null` for `Scan` (focus the dock). */
function primaryFor(mode: ScanMode, m: Model): { blocker: string | null; saving: boolean; save: (o: { keepOpen: boolean; print?: boolean }) => void; caret: ActionItem[] } | null {
  const keep = (save: (o: { keepOpen: boolean }) => unknown): ActionItem => ({
    key: "keep", label: "Save and keep this asset open", group: "edit", icon: Save, onSelect: () => void save({ keepOpen: true }),
  });
  if (mode === "check") {
    if (!m.checkable) return null;
    return { blocker: m.check.blocker, saving: m.check.saving, save: (o) => void m.check.save(o), caret: [keep(m.check.save)] };
  }
  if (!m.tt.item) return null;
  const print: ActionItem = { key: "print", label: "Save and print label", group: "documents", icon: Printer, onSelect: () => void m.tt.save({ keepOpen: false, print: true }) };
  return { blocker: m.tt.blocker, saving: m.tt.saving, save: (o) => void m.tt.save(o), caret: [keep(m.tt.save), print] };
}

function testerMenuFor(tt: Model["tt"], roster: ReturnType<typeof useMemberRoster>): { label: string; spec: ActionMenuSpec } {
  const options = roster.options.length > 0 ? roster.options : tt.tester ? [tt.tester] : [];
  return {
    label: tt.tester?.name || "Choose",
    spec: { items: options.map((o) => ({ key: o.id, label: o.name, group: "edit" as const, onSelect: () => tt.setTester(o) })) },
  };
}

function ScanPageBody({ session, held, mode }: { session: Session; held: ScanMode[]; mode: ScanMode }) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const now = useStableNow();
  const inputRef = useRef<HTMLInputElement>(null);
  const perms = { canAssets: useCanDo("asset", "read"), canRegister: useCanDo("asset", "create"), canCheckItemSettings: useCanDo("checkItem", "read") };
  const model = useScanPageModel(session, mode);
  const roster = useMemberRoster(model.orgId);
  const register = useTtRegister();
  const { tag, lastScans } = session;

  const focusDock = () => inputRef.current?.focus();
  const open = (href: string) => router.push(href);
  const entries = lastScans.entries.filter((e) => e.mode === mode);
  const pageMenu = buildScanPageMenu({
    soundsOn: model.feedback.enabled, hasLoaded: !!tag, lastScanCount: entries.length,
    canTestTag: held.includes("tt"), canAssets: perms.canAssets, canCheckItemSettings: perms.canCheckItemSettings,
    onToggleSounds: model.feedback.toggle, onClearScan: session.clear, onOpen: open,
    onClearLastScans: () => lastScans.clear(mode),
  });
  const primary = <HeadPrimary primary={primaryFor(mode, model)} onScan={focusDock} />;
  const scanAgain = () => {
    session.clear();
    focusDock();
  };

  return (
    <div className={cn("mx-auto flex w-full max-w-[640px] flex-col gap-4", isMobile && "pb-28")}>
      <PageMeta title="Scan" />
      <header className="flex items-start gap-3">
        <h1 className="min-w-0 flex-1 font-display text-page-title font-extrabold leading-tight tracking-tight text-ink">Scan</h1>
        {isMobile ? null : primary}
        <ActionMenu spec={pageMenu} label="Scan page actions" />
      </header>

      <ModeWords held={held} mode={mode} entries={lastScans.entries} onMode={session.setMode} />

      <div className={cn(isMobile && "sticky top-0 z-20 -mx-4 bg-paper px-4 py-2")}>
        <ScanDock
          onScan={session.scan}
          modes={[]}
          mode={mode}
          onModeChange={() => {}}
          cameraContinuous={false}
          inputRef={inputRef}
          cameraTitle="Scan a tag with the camera"
          placeholder={DOCK_PLACEHOLDER[mode]}
        />
      </div>

      {mode === "tt" ? (
        <TtBody
          tag={tag} card={model.testCard} now={now} tt={model.tt} register={register}
          testerMenu={testerMenuFor(model.tt, roster)} onOpen={open} onClearScan={session.clear}
          onScanAgain={scanAgain} onType={focusDock} canRegister={perms.canRegister}
        />
      ) : (
        <CheckBody
          tag={tag}
          card={model.checkCard}
          now={now}
          check={model.check}
          checkable={model.checkable}
          menuCtx={{ canTestTag: held.includes("tt"), onOpen: open, onClearScan: session.clear }}
          onScanAgain={scanAgain}
          onType={focusDock}
          canRegister={perms.canRegister}
          canCheckItemSettings={perms.canCheckItemSettings}
        />
      )}

      <LastScans
        key={mode}
        entries={entries}
        mode={mode}
        shown={isMobile ? LAST_SCANS_SHOWN.phone : LAST_SCANS_SHOWN.desktop}
        onRescan={session.scan}
        onOpen={open}
      />

      {isMobile ? (
        <PinnedAboveBottomNav>
          <div className="flex justify-end rounded-[var(--r)] bg-paper/95 p-2 shadow-[var(--sh-card)]">{primary}</div>
        </PinnedAboveBottomNav>
      ) : null}

      <DiscardDialog
        open={!!session.pending}
        noun={DISCARD_NOUN[mode]}
        tag={tag}
        onKeep={session.cancelDiscard}
        onDiscard={() => {
          model.check.discard();
          model.tt.discard();
          session.confirmDiscard();
        }}
      />
    </div>
  );
}

const DOCK_PLACEHOLDER: Record<ScanMode, string> = { check: "Scan or type a tag to check", tt: "Scan or type a tag or test tag" };
const DISCARD_NOUN: Record<ScanMode, "check" | "test"> = { check: "check", tt: "test" };

/** `Save and scan next` once something can be saved; `Scan` (focus the dock) before that. */
function HeadPrimary({ primary, onScan }: { primary: ReturnType<typeof primaryFor>; onScan: () => void }) {
  if (!primary) return <Button onClick={onScan}>Scan</Button>;
  return (
    <SavePrimary
      blocker={primary.blocker}
      saving={primary.saving}
      onSave={() => primary.save({ keepOpen: false })}
      caret={{ items: primary.caret }}
    />
  );
}

/** `Check 7  Test & tag 5` — counts are saves this session; only the modes held. */
function ModeWords({ held, mode, entries, onMode }: { held: ScanMode[]; mode: ScanMode; entries: LastScan[]; onMode: (m: ScanMode) => void }) {
  if (held.length < 2) return null;
  const saved = (m: ScanMode) => entries.filter((e) => e.mode === m && SAVED_VERDICTS.has(e.verdict)).length;
  return (
    <StageFilter
      label="Scan mode"
      options={held.map((m) => ({ key: m, label: SCAN_MODE_LABELS[m], count: saved(m) }))}
      value={mode}
      onChange={(k) => k && onMode(k as ScanMode)}
    />
  );
}

const SAVED_VERDICTS = new Set<LastScan["verdict"]>(["clean", "failed"]);

function CheckBody({
  tag,
  card,
  now,
  check,
  checkable,
  menuCtx,
  onScanAgain,
  onType,
  canRegister,
  canCheckItemSettings,
}: {
  tag: string | null;
  card: ScanCardData | undefined;
  now: number;
  check: ReturnType<typeof useCheckMode>;
  checkable: CheckableCard | null;
  menuCtx: { canTestTag: boolean; onOpen: (href: string) => void; onClearScan: () => void };
  onScanAgain: () => void;
  onType: () => void;
  canRegister: boolean;
  canCheckItemSettings: boolean;
}) {
  if (!tag) return <ReadyState />;
  if (!card || card.tag !== tag) return <LoadingState />;
  if (!checkable) {
    return <ExceptionState card={card} onScanAgain={onScanAgain} onType={onType} canRegister={canRegister} canCheckItemSettings={canCheckItemSettings} />;
  }
  const menu = buildScanCardMenu({
    assetId: checkable.asset.id, ttId: checkable.tt?.id ?? null, canTestTag: menuCtx.canTestTag,
    canPassAll: check.canPassAll, onOpen: menuCtx.onOpen, onPassAll: check.passAll, onClearScan: menuCtx.onClearScan,
  });
  return (
    <div className="flex flex-col gap-5 border-t border-line pt-4">
      <ResultCard card={checkable} now={now} menu={menu} />
      <CheckSection
        items={check.items}
        states={check.states}
        onUpdate={check.update}
        onFailPhotoUploadingChange={check.onFailPhotoUploadingChange}
        canPassAll={check.canPassAll}
        onPassAll={check.passAll}
        condition={check.condition}
        conditionLocked={check.conditionLocked}
        onCondition={check.setCondition}
        notes={check.notes}
        onNotes={check.setNotes}
      />
    </div>
  );
}

const EXCEPTION_VERDICT: Record<ScanMode, (card: ScanCardData) => LastScan["verdict"] | null> = {
  check: exceptionVerdict,
  tt: ttExceptionVerdict,
};

/** Each exception scan (a tag this mode can't check or test) is logged once per load. */
function useLogExceptions({
  card,
  tag,
  mode,
  play,
  add,
}: {
  card: ScanCardData | undefined;
  tag: string | null;
  mode: ScanMode;
  play: ReturnType<typeof useScanFeedback>["play"];
  add: ReturnType<typeof useScanSession>["lastScans"]["add"];
}) {
  const logged = useRef<string | null>(null);
  useEffect(() => {
    if (!tag) logged.current = null;
    const key = `${mode}|${tag}`;
    if (!tag || card?.tag !== tag || logged.current === key) return;
    logged.current = key;
    const verdict = EXCEPTION_VERDICT[mode](card);
    if (!verdict) return;
    play("exception");
    const at = Date.now();
    add({ id: `${key}|${at}`, mode, tag, verdict, at, name: scanCardName(card), assetId: scanCardAssetId(card) });
  }, [card, tag, mode, play, add]);
}
