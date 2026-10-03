"use client";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../../convex/_generated/api";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TASK_STATUS_LABELS } from "@/lib/project-tasks";

/** Client page "Work" tab (#1245, design §8.4) — every work item linked to
 *  this client via `workItemLinks` (next steps, and anything else someone
 *  links here), not a second task list. Read-only in this phase; work items
 *  are edited from the Today/project surfaces that already have the full
 *  editor. */
export function ClientWorkTab({ clientId }: { clientId: string }) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const data = useAuthedQuery(
    api.workItemLinks.forEntity,
    orgId ? { orgId, entityType: "client", entityId: clientId } : "skip",
  );

  return (
    <Panel padding="responsive">
      <h3 className="t-heading mb-4 text-ink">Linked work</h3>
      {data === undefined ? (
        <p className="text-caption text-muted">Loading…</p>
      ) : data.length === 0 ? (
        <EmptyState title="No work linked yet" description="Next steps and tasks linked to this client will appear here." />
      ) : (
        <ul className="space-y-2">
          {data.map((row) => {
            const item = row.workItem;
            if (!item) return null;
            return (
              <li key={row.linkId} className="flex items-center justify-between gap-3 rounded-[var(--r)] border border-line px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-ui-text text-ink-2">{item.title}</p>
                  {item.dueDate != null && (
                    <p className="text-caption text-muted">Due {new Date(item.dueDate).toLocaleDateString()}</p>
                  )}
                </div>
                <Badge status={item.status === "DONE" ? "ok" : item.status === "CANCELLED" ? "neutral" : "warn"}>
                  {TASK_STATUS_LABELS[(item.status ?? "TODO") as keyof typeof TASK_STATUS_LABELS] ?? item.status ?? "To do"}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
