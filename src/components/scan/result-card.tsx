"use client";

import Link from "next/link";

import { conditionWord } from "../../../convex/lib/assetCondition";
import { formatDateDayMonth, formatWeekdayDayMonth } from "@/lib/formatters";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import { JOB_STATE_WORDS, ttFlag, type CheckableCard, type ScanCardData } from "@/lib/scan-page";
import { assetStatusLabels, formatLabel } from "@/lib/status-labels";
import { getStatusIntent, intentStyles } from "@/lib/status-colors";
import { cn, focusRing } from "@/lib/utils";
import { ActionMenu } from "@/components/ui/action-menu";
import { StatusWord } from "@/components/ui/status-word";

type AssetCard = CheckableCard;

/**
 * The result card's head and facts (spec §9i.2): `AURA-01 ● Prepped` with inline
 * flags (`T&T overdue 38d`, `Damaged`), the model linking to the asset, then four
 * facts in two columns — Where, On job, Last check, Last T&T — and, for an asset out
 * on a job, the one line saying a check here is recorded on the asset.
 */
export function ResultCard({ card, now, menu }: { card: AssetCard; now: number; menu: ActionMenuSpec }) {
  const flag = ttFlag(card.tt, now);
  return (
    <section aria-label={`Scanned ${card.asset.assetTag}`} className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <CardHead asset={card.asset} flag={flag} />
        <ActionMenu spec={menu} label="Scan actions" />
      </div>
      <Identity asset={card.asset} />
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-caption">
        <Fact term="Where">{card.location?.name ?? <Muted>No location</Muted>}</Fact>
        <Fact term="On job">
          <OnJob job={card.job} />
        </Fact>
        <Fact term="Last check">{lastCheckText(card.lastCheck)}</Fact>
        <Fact term="Last T&T">
          <LastTt tt={card.tt} tone={flag?.tone ?? null} />
        </Fact>
      </dl>
      <OtherJobLine job={card.job} />
    </section>
  );
}

type Asset = AssetCard["asset"];
type Job = ScanCardData["job"];

/** `AURA-01 ● Prepped  ● T&T overdue 38d  ● Damaged`. */
function CardHead({ asset, flag }: { asset: Asset; flag: ReturnType<typeof ttFlag> }) {
  const status = asset.status ?? "AVAILABLE";
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
      <span className="font-mono text-ui-text font-semibold text-ink">{asset.assetTag}</span>
      <StatusWord status={{ label: assetStatusLabels[status] ?? formatLabel(status), intent: getStatusIntent("asset", status) }} />
      {flag ? <Flag label={flag.label} tone={flag.tone} /> : null}
      {asset.condition === "DAMAGED" ? <Flag label={conditionWord("DAMAGED")} tone="warning" /> : null}
    </div>
  );
}

/** The model (linking to the asset) · serial · condition word. */
function Identity({ asset }: { asset: Asset }) {
  return (
    <p className="text-caption text-muted">
      <Link href={`/assets/registry/${asset.id}`} className={cn("font-medium text-ink hover:underline", focusRing)}>
        {asset.modelName ?? "Unknown model"}
      </Link>
      {asset.serialNumber ? <> · S/N <span className="font-mono">{asset.serialNumber}</span></> : null}
      {" · "}
      {conditionWord(asset.condition as Parameters<typeof conditionWord>[0])}
    </p>
  );
}

function OnJob({ job }: { job: Job }) {
  if (!job) return <Muted>Not on a job</Muted>;
  return (
    <Link href={`/projects/${job.projectId}`} className={cn("hover:underline", focusRing)}>
      #{job.projectNumber} {job.projectName} · {JOB_STATE_WORDS[job.state]}
    </Link>
  );
}

/** An asset out on a job: a check here is recorded on the asset, not the job. */
function OtherJobLine({ job }: { job: Job }) {
  if (job?.state !== "out") return null;
  return (
    <p className="flex items-start gap-2 text-caption text-ink-2">
      <span aria-hidden="true" className={cn("mt-1.5 size-[7px] shrink-0 rounded-full", intentStyles.warning.dot)} />
      <span>
        On #{job.projectNumber} {job.projectName}
        {job.backAt ? ` — back ${formatWeekdayDayMonth(job.backAt)}` : ""}. A check here is recorded on the asset, not the job.
      </span>
    </p>
  );
}

function Flag({ label, tone }: { label: string; tone: "error" | "warning" }) {
  return <StatusWord status={{ label, intent: tone }} />;
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-muted">{children}</span>;
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-micro uppercase tracking-wide text-muted">{term}</dt>
      <dd className="truncate text-ink">{children}</dd>
    </div>
  );
}

function lastCheckText(c: ScanCardData["lastCheck"]): React.ReactNode {
  if (!c) return <Muted>not checked</Muted>;
  const result = c.failed > 0 ? `${c.failed} of ${c.total}${c.truncated ? "+" : ""} failed` : `${c.total}${c.truncated ? "+" : ""} clean`;
  return `${formatDateDayMonth(new Date(c.at))}${c.byName ? ` · ${c.byName}` : ""} · ${result}`;
}

function LastTt({ tt, tone }: { tt: ScanCardData["tt"]; tone: "error" | "warning" | null }) {
  if (!tt) return <Muted>Not on the register</Muted>;
  const tested = tt.lastTestDate ? formatDateDayMonth(new Date(tt.lastTestDate)) : "never tested";
  const due = tt.nextDueDate ? `due ${formatDateDayMonth(new Date(tt.nextDueDate))}` : null;
  return (
    <Link href={`/test-and-tag/${tt.id}`} className={cn("hover:underline", focusRing)}>
      {tested}
      {due ? (
        <>
          {" · "}
          <span className={tone ? intentStyles[tone].text : undefined}>{due}</span>
        </>
      ) : null}
    </Link>
  );
}
