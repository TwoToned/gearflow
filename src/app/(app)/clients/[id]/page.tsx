"use client";
// use-client: reads the route param and drives tab / dialog state (R-8.1.1)

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { Archive, FilePlus, GitMerge, Link2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { api } from "../../../../../convex/_generated/api";

import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { newJobForClientHref } from "@/lib/new-job-url";
import { ClientMergeDialog } from "@/components/clients/client-merge-dialog";
import { ClientContactsManager, ReadOnlyContactsList } from "@/components/clients/client-contacts-manager";
import { XeroContactCard } from "@/components/clients/xero-contact-card";
import { EntityCommentsButton } from "@/components/collaboration/entity-comments-button";
import { MediaUploader, type MediaItem } from "@/components/media/media-uploader";
import { Facts, HealthRows, Headline, Overline, RecordRows, RecordShell, type HealthItem, type RecordTab } from "@/components/people/record-shell";
import { AddressDisplay } from "@/components/ui/address-display";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FadeIn } from "@/components/ui/motion";
import { NotesEditor } from "@/components/ui/notes-editor";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useMediaWrites } from "@/hooks/use-media-writes";
import { useClientWrites } from "@/hooks/use-native-client-writes";
import { useStableNow } from "@/hooks/use-stable-now";
import { useActiveOrganization, useSession } from "@/lib/auth-client";
import { getPrimaryContact } from "@/lib/client-contact-helpers";
import { formatCurrency } from "@/lib/formatters";
import { dayLabel } from "@/lib/list-views/people";
import type { ActionMenuSpec, StatusValue } from "@/lib/primitives/types";
import { clientTypeLabels, projectStatusLabels } from "@/lib/status-labels";
import { getStatusIntent } from "@/lib/status-colors";
import { useCanDo } from "@/lib/use-permissions";

const DAY_MS = 86_400_000;
const day = (ms: number) => dayLabel(Math.floor(ms / DAY_MS));

export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <RequirePermission resource="client" action="read">
      <FadeIn>
        <ClientRecord params={params} />
      </FadeIn>
    </RequirePermission>
  );
}

type Account = NonNullable<ReturnType<typeof useAccount>>;
function useAccount(orgId: string | undefined, id: string, now: number) {
  return useAuthedQuery(api.clientRecord.clientAccount, orgId ? { orgId, clientId: id, now } : "skip");
}

/** Health rows (derived on read): invoices past due and quotes about to lapse, each with its one action. */
function healthOf(account: Account | null | undefined, open: (tab: string) => void, now: number): HealthItem[] {
  if (!account) return [];
  const items: HealthItem[] = [];
  for (const i of account.invoices.filter((x) => x.status === "ISSUED" && x.paymentStatus !== "PAID")) {
    const late = i.dueDate != null && i.dueDate < now;
    const due = i.dueDate == null ? "" : late ? ` · ${Math.max(1, Math.floor((now - i.dueDate) / DAY_MS))}d overdue` : ` · due ${day(i.dueDate)}`;
    items.push({ key: i.id, tone: late ? "error" : "neutral", text: `${i.invoiceNumber ?? "Invoice"} ${formatCurrency(i.total - i.amountPaid)}${due}`, action: { label: "Invoices", onSelect: () => open("money") } });
  }
  for (const q of account.quotes.filter((x) => x.status === "SENT" && x.validUntil != null && x.validUntil - now < 14 * DAY_MS)) {
    items.push({ key: q.id, tone: "warning", text: `${q.projectNumber} v${q.version} expires ${day(q.validUntil as number)}`, action: { label: "Quotes", onSelect: () => open("money") } });
  }
  return items;
}

const sumUnpaid = (a: Account | null | undefined) => (a ? a.invoices.filter((i) => i.status === "ISSUED" && i.paymentStatus !== "PAID").reduce((s, i) => s + i.total - i.amountPaid, 0) : 0);

function ClientRecord({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const now = useStableNow();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const client = useAuthedQuery(api.clients.detail, orgId ? { orgId, id } : "skip");
  const account = useAccount(orgId, id, now);
  const merged = useAuthedQuery(api.clientMergeWrites.mergedInto, orgId ? { orgId, id } : "skip");
  const writes = useClientWrites();
  const media = useMediaWrites("client");
  const updateOne = useMutation(api.clientWrites.updateNative);
  const { data: session } = useSession();
  const canUpdate = useCanDo("client", "update");
  const canCreateJob = useCanDo("project", "create");
  const canMerge = useCanDo("invoice", "update");
  const [mergeOpen, setMergeOpen] = useState(false);
  const [xeroOpen, setXeroOpen] = useState(false);

  if (client === undefined) return <DetailPageSkeleton />;
  if (!client) return <p className="py-10 text-center text-ui-text text-muted">Client not found. It may have been archived, or you don&apos;t have access to it.</p>;

  const active = (client.isActive ?? true) === true;
  const contacts = client.contacts ?? [];
  const primary = getPrimaryContact(contacts);
  const status: StatusValue = active ? { label: "Active", intent: "success" } : { label: merged ? "Merged" : "Archived", intent: "neutral", outline: true };
  const openJobs = client.projects.filter((p) => !["CANCELLED", "COMPLETED", "INVOICED"].includes(p.status ?? ""));
  const reactivate = () =>
    void updateOne({ id, orgId: orgId!, patch: { isActive: true }, actor: { userId: session?.user.id ?? "", userName: session?.user.name ?? "" }, auditId: createId(), now: Date.now() }).then(() => toast.success("Client reactivated"));

  const menu: ActionMenuSpec = {
    items: [
      ...(canCreateJob && active ? [{ key: "new-job", label: "New job for client…", group: "organise" as const, icon: FilePlus, onSelect: () => router.push(newJobForClientHref(id)) }] : []),
      ...(canUpdate ? [{ key: "xero", label: "Sync / Change Xero mapping…", group: "organise" as const, icon: Link2, onSelect: () => setXeroOpen(true) }] : []),
      ...(canUpdate && canMerge && active ? [{ key: "merge", label: "Merge into another client…", group: "organise" as const, icon: GitMerge, onSelect: () => setMergeOpen(true) }] : []),
      ...(canUpdate && !active && !merged ? [{ key: "reactivate", label: "Reactivate", group: "organise" as const, icon: RotateCcw, onSelect: reactivate }] : []),
      ...(canUpdate && active
        ? [{
            key: "archive", label: "Archive…", group: "danger" as const, icon: Archive, danger: true,
            onSelect: () => void writes.archive(id).then(() => toast.success("Client archived")),
            confirm: { title: `Archive ${client.name}?`, body: "The client leaves pickers and the active list. Its jobs, quotes, invoices and history stay exactly as they were, and you can reactivate it.", confirmLabel: "Archive" },
          }]
        : []),
    ],
  };

  const open = (tab: string) => router.replace(`/clients/${id}?tab=${tab}`, { scroll: false });
  const unpaid = sumUnpaid(account);
  const health = healthOf(account, open, now);

  const overview = (
    <div className="flex flex-col gap-8">
      <Headline sub={account ? `${openJobs.length} open job${openJobs.length === 1 ? "" : "s"}` : undefined}>
        {account && unpaid > 0 ? `${formatCurrency(unpaid)} outstanding` : `${openJobs.length} open job${openJobs.length === 1 ? "" : "s"}`}
      </Headline>
      <HealthRows items={health} allClear={account ? "Nothing needs a look." : "Nothing to show."} />
      <div className="grid gap-8 md:grid-cols-3">
        <Facts title="Contact" facts={[
          { label: "Name", value: primary?.name ?? client.contactName },
          { label: "Email", value: (primary?.email ?? client.contactEmail) ? <a className="hover:underline" href={`mailto:${primary?.email ?? client.contactEmail}`}>{primary?.email ?? client.contactEmail}</a> : null },
          { label: "Phone", value: primary?.phone ?? client.contactPhone },
          { label: "More", value: contacts.length > 1 ? `${contacts.length - 1} more contact${contacts.length === 2 ? "" : "s"}` : null },
        ]} />
        <Facts title="Billing" facts={[
          { label: "Billing", value: client.billingAddress ? <AddressDisplay address={client.billingAddress} latitude={client.billingLatitude} longitude={client.billingLongitude} label={`${client.name} — Billing`} compact /> : null },
          { label: "Shipping", value: client.shippingAddress ? <AddressDisplay address={client.shippingAddress} latitude={client.shippingLatitude} longitude={client.shippingLongitude} label={`${client.name} — Shipping`} compact /> : null },
        ]} />
        <Facts title="Account" facts={[
          { label: "Type", value: client.type ? clientTypeLabels[client.type] ?? client.type : null },
          { label: "ABN", value: client.taxId },
          { label: "Terms", value: client.paymentTerms },
          { label: "Discount", value: client.defaultDiscount != null ? `${Number(client.defaultDiscount)}%` : null },
          { label: "Tax", value: client.taxExempt ? `Exempt${client.taxExemptReason ? ` · ${client.taxExemptReason}` : ""}` : null },
          { label: "Xero", value: client.xeroContactName ?? (client.xeroContactId ? "Linked" : null) },
        ]} />
      </div>
      <section aria-label="Notes">
        <Overline>Notes</Overline>
        <NotesEditor initialNotes={client.notes || ""} onSave={(notes) => writes.updateNotes(id, notes)} placeholder="Add notes about this client..." />
      </section>
      {orgId && <EntityCommentsButton orgId={orgId} entityType="client" entityId={id} />}
    </div>
  );

  const tabs: RecordTab[] = [
    { value: "overview", label: "Overview", panel: overview },
    {
      value: "jobs", label: "Jobs", count: client.projects.length,
      panel: <RecordRows noun="job" empty="No jobs yet. Jobs for this client appear here." rows={client.projects.map((p) => ({
        id: p.id, title: p.name, href: `/projects/${p.id}`, meta: [p.projectNumber, `${p._count.lineItems} line${p._count.lineItems === 1 ? "" : "s"}`],
        status: { label: projectStatusLabels[p.status ?? ""] ?? p.status ?? "", intent: getStatusIntent("project", p.status ?? "") },
      }))} />,
    },
    ...(account ? [{
      value: "money", label: "Quotes & invoices", count: account.invoices.length + account.quotes.length,
      panel: <MoneyTab account={account} now={now} />,
    }] : []),
    {
      value: "contacts", label: "Contacts", count: contacts.length,
      panel: <CanDo resource="client" action="update" fallback={<ReadOnlyContactsList contacts={contacts} legacy={client} />}><ClientContactsManager clientId={id} contacts={contacts} /></CanDo>,
    },
    {
      value: "files", label: "Files", count: client.media?.length ?? 0,
      panel: (
        <MediaUploader
          entityType="client" entityId={id} accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,image/*"
          existingMedia={(client.media || []).map((m: MediaItem) => m)}
          onUploadComplete={async (f) => { await media.add({ parentId: id, fileId: f.id, type: "DOCUMENT" }); }}
          onRemove={async (mediaId) => { await media.remove(mediaId); }}
        />
      ),
    },
    { value: "history", label: "History", panel: <ActivityTimeline entityType="client" entityId={id} limit={25} /> },
  ];

  const banner = !active ? (
    <span>{merged ? `Merged into ${merged.name}. Its jobs, invoices, contacts and files moved there.` : "Archived. Hidden from pickers and new jobs; its jobs, invoices and history stay as they were."}</span>
  ) : undefined;

  return (
    <>
      <RecordShell
        crumb={{ label: "Clients", href: "/clients" }}
        title={client.name}
        status={status}
        meta={[client.type ? clientTypeLabels[client.type] : null, primary?.name ?? client.contactName, `${client.projects.length} job${client.projects.length === 1 ? "" : "s"}`].filter(Boolean)}
        banner={banner}
        onEdit={canUpdate ? () => router.push(`/clients/${id}?edit=1`) : undefined}
        menu={menu}
        tabs={tabs}
        rail={<Facts title="At a glance" facts={[{ label: "Contact", value: primary?.name ?? client.contactName }, { label: "Terms", value: client.paymentTerms }, { label: "Open jobs", value: String(openJobs.length) }]} />}
      />
      <ClientMergeDialog open={mergeOpen} onOpenChange={setMergeOpen} orgId={orgId} loser={{ id, name: client.name }} />
      <Dialog open={xeroOpen} onOpenChange={setXeroOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Xero contact</DialogTitle></DialogHeader>
          <XeroContactCard clientId={id} xeroContactId={client.xeroContactId} xeroContactName={client.xeroContactName} />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** An invoice's one word (Void / Paid / Overdue / Issued) and whether it is late. */
function invoiceWord(i: { status: string; paymentStatus?: string | null; dueDate?: number | null }, now: number) {
  const late = i.status === "ISSUED" && i.paymentStatus !== "PAID" && i.dueDate != null && i.dueDate < now;
  if (i.status === "VOID") return { label: "Void", late };
  if (i.paymentStatus === "PAID") return { label: "Paid", late };
  return { label: late ? "Overdue" : "Issued", late };
}

/** The account view: Finance owns the documents; each row links into it. */
function MoneyTab({ account, now }: { account: Account; now: number }) {
  return (
    <div className="flex flex-col gap-8">
      <section aria-label="Invoices">
        <Overline>Invoices</Overline>
        <RecordRows noun="invoice" empty="No invoices yet." rows={account.invoices.map((i) => {
          const { label, late } = invoiceWord(i, now);
          return {
            id: i.id, title: `${i.invoiceNumber ?? "Invoice"} · ${formatCurrency(i.total)}`, href: i.projectId ? `/projects/${i.projectId}?tab=finance` : undefined,
            meta: [i.projectNumber, i.dueDate ? `due ${day(i.dueDate)}` : null],
            status: { label, intent: late ? "error" : label === "Paid" ? "success" : "neutral" } as StatusValue,
          };
        })} />
      </section>
      <section aria-label="Quotes">
        <Overline>Quotes</Overline>
        <RecordRows noun="quote" empty="No quotes yet." rows={account.quotes.map((q) => ({
          id: q.id, title: `${q.projectNumber} · v${q.version}${q.label ? ` · ${q.label}` : ""}`, href: `/projects/${q.projectId}?tab=finance`,
          meta: [q.validUntil ? `valid to ${day(q.validUntil)}` : null],
          status: { label: q.status.charAt(0) + q.status.slice(1).toLowerCase(), intent: q.status === "ACCEPTED" ? "success" : q.status === "EXPIRED" ? "error" : "neutral" } as StatusValue,
        }))} />
      </section>
      {account.truncated && <p className="text-caption text-muted">Showing the most recent records.</p>}
    </div>
  );
}
