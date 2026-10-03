"use client";
// use-client: live Convex data via client subscription (useQuery) (R-8.1.1)

import Link from "next/link";
import type { FunctionReturnType } from "convex/server";
import { ChevronRight } from "lucide-react";
import { PageMeta } from "@/components/layout/page-meta";
import { ListPageLayout } from "@/components/layout/page-layouts";
import { RequirePermission } from "@/components/auth/require-permission";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useStableNow } from "@/hooks/use-stable-now";
import { useActiveOrganization } from "@/lib/auth-client";
import type { api } from "../../../../../convex/_generated/api";
import { api as convexApi } from "../../../../../convex/_generated/api";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { projectStatusLabels, formatLabel } from "@/lib/status-labels";
import { cn, focusRing } from "@/lib/utils";
import { FadeIn } from "@/components/ui/motion";

const PIPELINE_STATUSES = ["ENQUIRY", "QUOTING", "QUOTED", "CONFIRMED"] as const;

type PipelineCards = FunctionReturnType<typeof api.pipeline.forOrg>;
type PipelineCard = PipelineCards[number];

const ROTTING_BORDER: Record<PipelineCard["rotting"], string> = {
  none: "",
  amber: "border-l-[3px] border-l-warn bg-warn-soft/20",
  error: "border-l-[3px] border-l-t-out bg-out-soft/30",
};
const ROTTING_TEXT: Record<PipelineCard["rotting"], string> = {
  none: "text-faint",
  amber: "text-warn",
  error: "text-t-out",
};

/** One deal's row — split out of the page (R-3.6) to keep the list's map
 *  callback simple. */
function PipelineRow({ card }: { card: PipelineCard }) {
  return (
    <li>
      <Link
        href={`/projects/${card.projectId}`}
        className={cn("flex items-center gap-3 px-4 py-3 transition-colors hover:bg-paper-2", focusRing, ROTTING_BORDER[card.rotting])}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-ui-text font-medium text-ink-2">{card.projectName}</p>
          <p className="truncate text-caption text-muted">
            {card.clientName ?? "No client"}
            {card.nextStepTitle ? ` · ${card.nextStepTitle}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-caption text-muted">
            {card.nextStepDate != null ? `Next: ${new Date(card.nextStepDate).toLocaleDateString()}` : "No date"}
          </p>
          {card.daysSinceTouch != null && (
            <p className={cn("text-caption", ROTTING_TEXT[card.rotting])}>
              {card.daysSinceTouch === 0 ? "Touched today" : `${card.daysSinceTouch}d since touch`}
            </p>
          )}
        </div>
        <StatusIndicator category="project" value={card.status} label={projectStatusLabels[card.status] ?? formatLabel(card.status)} variant="pill" />
        <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />
      </Link>
    </li>
  );
}

function PipelineStatusSection({ status, cards }: { status: (typeof PIPELINE_STATUSES)[number]; cards: PipelineCard[] }) {
  const inStatus = cards.filter((c) => c.status === status);
  if (inStatus.length === 0) return null;
  return (
    <section>
      <h2 className="t-overline mb-2 text-muted">
        {projectStatusLabels[status] ?? formatLabel(status)} ({inStatus.length})
      </h2>
      <ul className="divide-y divide-line rounded-[var(--r-lg)] border border-line bg-card">
        {inStatus.map((card) => (
          <PipelineRow key={card.projectId} card={card} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Pipeline view (#1245, design §8.4/§13) — "the project board filtered to
 * ENQUIRY → QUOTING → QUOTED → CONFIRMED, sorted by next-step date, reachable
 * as Clients → Pipeline. No new object — the project is the deal."
 *
 * A standalone read-only page rather than a mode of the (not-yet-merged at
 * build time) revived project board — see FEATUREDOCS/80.
 */
export default function ClientPipelinePage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  // A mount-time snapshot, NEVER a fresh `Date.now()` — the arg is part of the
  // Convex subscription key, so re-evaluating it each render re-subscribes every
  // render and the page never leaves its loading branch (see use-stable-now.ts).
  const now = useStableNow();
  const cards = useAuthedQuery(convexApi.pipeline.forOrg, orgId ? { orgId, now } : "skip");

  return (
    <FadeIn>
      <PageMeta title="Pipeline" />
      <RequirePermission resource="project" action="read">
        <ListPageLayout
          title="Pipeline"
          description="Enquiry through confirmed, sorted by next-step date."
        >
          {cards === undefined ? (
            <p className="text-caption text-muted">Loading…</p>
          ) : cards.length === 0 ? (
            <EmptyState
              title="Nothing in the pipeline"
              description="Enquiries, quotes and confirmed jobs will show up here, soonest next step first."
            />
          ) : (
            <div className="space-y-6">
              {PIPELINE_STATUSES.map((status) => (
                <PipelineStatusSection key={status} status={status} cards={cards} />
              ))}
            </div>
          )}
        </ListPageLayout>
      </RequirePermission>
    </FadeIn>
  );
}
