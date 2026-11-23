"use client";

import Link from "next/link";

import { formatDateDayMonth } from "@/lib/formatters";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import { buildTtCardMenu } from "@/lib/row-actions/scan-actions";
import { checkableCard, ttFlag } from "@/lib/scan-page";
import { applianceTypeLabels, equipmentClassLabels, testTagStatusLabels } from "@/lib/status-labels";
import { getStatusIntent } from "@/lib/status-colors";
import { cn, focusRing } from "@/lib/utils";
import { ActionMenu } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { StatusWord } from "@/components/ui/status-word";
import { LabelTemplate } from "@/components/test-tag/label-template";
import { ResultCard } from "./result-card";
import { ExceptionState, LoadingState } from "./scan-states";
import { TtSection } from "./tt-section";
import { testableItem, type TestCardData, type useTtMode } from "./use-tt-mode";
import type { useTtRegister } from "./use-tt-register";

type TtMode = ReturnType<typeof useTtMode>;

interface TtBodyProps {
  tag: string | null;
  card: TestCardData | undefined;
  now: number;
  tt: TtMode;
  register: ReturnType<typeof useTtRegister>;
  testerMenu: { label: string; spec: ActionMenuSpec };
  onOpen: (href: string) => void;
  onClearScan: () => void;
  onScanAgain: () => void;
  onType: () => void;
  canRegister: boolean;
  /** Card ⋯ `Create maintenance job…`; absent without `maintenance:create` or an inventory asset. */
  onCreateMaintenance?: () => void;
}

/**
 * Test & tag mode's body (spec §9i.2, §9i.3): Ready, the not-a-testable-item states
 * (unknown, kit, bulk, `Not on the test & tag register` + Add, Retired + Reactivate),
 * else the card and the inline test. The printable label for a `Save and print label`
 * is mounted here, print-only (fixes F7: it used to print the page).
 */
export function TtBody(p: TtBodyProps) {
  return (
    <>
      <TtContent {...p} />
      {p.tt.label ? (
        <div className="hidden print:block">
          <LabelTemplate
            testTagId={p.tt.label.testTagId}
            result={p.tt.label.result}
            testDate={new Date(p.tt.label.testDate)}
            nextDueDate={new Date(p.tt.label.nextDueDate)}
            testerName={p.tt.label.testerName}
          />
        </div>
      ) : null}
    </>
  );
}

/** Everything that is not a testable item: Ready, loading, and the §9i.3 states. */
function stateFor(p: TtBodyProps): React.ReactNode | null {
  const { card, tag } = p;
  if (!tag) return <State title="Scan a tag to test it" />;
  if (!card || card.tag !== tag) return <LoadingState />;
  if (card.kind === "unknown" || card.kind === "kit") {
    return <ExceptionState card={card} onScanAgain={p.onScanAgain} onType={p.onType} canRegister={p.canRegister} canCheckItemSettings={false} />;
  }
  if (card.kind === "bulk") return <State tag={card.tag} title="Bulk stock is tested through each item's own test tag: scan that tag" />;
  if (!card.tt) return <NotOnRegister card={card} onAdd={p.register.addToRegister} />;
  return testableItem(card) ? null : <Retired tt={card.tt} onReactivate={p.register.reactivate} />;
}

function TtContent(p: TtBodyProps) {
  const state = stateFor(p);
  const card = p.card;
  const item = testableItem(card);
  if (state || !card || !item) return state;
  const menu = buildTtCardMenu({
    assetId: item.assetId, ttId: item.id, testTagId: item.testTagId, onOpen: p.onOpen,
    onQuickPass: () => void p.tt.quickPass(), onClearScan: p.onClearScan, onRetire: () => void p.register.retire(item),
    onCreateMaintenance: p.onCreateMaintenance,
  });
  const asAsset = checkableCard({ ...card, checkItemCount: 1 });
  return (
    <div className="flex flex-col gap-5 border-t border-line pt-4">
      {asAsset ? <ResultCard card={asAsset} now={p.now} menu={menu} /> : <TtOnlyHead card={card} now={p.now} menu={menu} />}
      <p className="text-caption text-muted">
        {[equipmentClassLabels[item.equipmentClass ?? ""], applianceTypeLabels[item.applianceType ?? ""], item.make].filter(Boolean).join(" · ")}
        {p.tt.profile ? ` · tested against ${p.tt.profile.name}` : " · no test profile applies"}
      </p>
      <TtSection
        draft={p.tt.draft}
        edit={p.tt.edit}
        onPassAllVisual={p.tt.passAllVisual}
        profile={p.tt.profile}
        testerMenu={p.testerMenu}
        result={p.tt.result}
        intervalMonths={item.testIntervalMonths}
        now={p.now}
        canRefer={!!item.assetId}
      />
    </div>
  );
}

function State({ tag, title, children }: { tag?: string; title: string; children?: React.ReactNode }) {
  return (
    <section aria-live="polite" className="flex flex-col gap-2 border-y border-line py-6">
      {tag ? <span className="font-mono text-ui-text font-semibold text-ink">{tag}</span> : null}
      <p className="text-ui-text text-ink">{title}</p>
      {children ? <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption">{children}</div> : null}
    </section>
  );
}

function NotOnRegister({ card, onAdd }: { card: TestCardData; onAdd: TtBodyProps["register"]["addToRegister"] }) {
  const asset = card.asset;
  return (
    <State tag={card.tag} title={`${asset?.modelName ?? "This asset"} is not on the test & tag register`}>
      {asset ? (
        <Button variant="ghost" size="sm" className="px-1 text-link" onClick={() => void onAdd(asset)}>
          Add to the register
        </Button>
      ) : null}
    </State>
  );
}

function Retired({ tt, onReactivate }: { tt: NonNullable<TestCardData["tt"]>; onReactivate: TtBodyProps["register"]["reactivate"] }) {
  return (
    <State tag={tt.testTagId} title={`${tt.description} is retired from test & tag`}>
      <Button variant="ghost" size="sm" className="px-1 text-link" onClick={() => void onReactivate(tt)}>
        Reactivate and test
      </Button>
      <Link href={`/test-and-tag/${tt.id}`} className={cn("font-medium text-link hover:underline", focusRing)}>
        Open in test & tag list
      </Link>
    </State>
  );
}

/** A register item with no inventory asset: its own identity and Last T&T. */
function TtOnlyHead({ card, now, menu }: { card: TestCardData; now: number; menu: ActionMenuSpec }) {
  const tt = card.tt!;
  const flag = ttFlag(tt, now);
  const status = tt.status ?? "NOT_YET_TESTED";
  return (
    <section aria-label={`Scanned ${tt.testTagId}`} className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-mono text-ui-text font-semibold text-ink">{tt.testTagId}</span>
          <StatusWord status={{ label: testTagStatusLabels[status] ?? status, intent: getStatusIntent("testTag", status) }} />
          {flag ? <StatusWord status={{ label: flag.label, intent: flag.tone }} /> : null}
        </div>
        <ActionMenu spec={menu} label="Scan actions" />
      </div>
      <p className="text-caption text-muted">
        <span className="font-medium text-ink">{tt.description}</span>
        {tt.lastTestDate ? ` · last tested ${formatDateDayMonth(new Date(tt.lastTestDate))}` : " · never tested"}
      </p>
    </section>
  );
}
