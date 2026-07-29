import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { API_REGISTRY } from "@/lib/api/registry.generated";
import { CURATED_TOOL_DEFS } from "@/lib/api/mcp/curated-tool-defs";
import { snippetsFor } from "@/lib/api/sdk-snippets";
import { API_BASE_URL } from "@/lib/api/version";
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_DESCRIPTIONS } from "@/lib/webhooks/events";

export const metadata = {
  title: "RVLT Flow Agent API",
  description: "REST + MCP reference for connecting an AI agent or script to RVLT Flow.",
};

/**
 * The Phase 8 (#1004) API docs page — "a person who didn't build this can
 * mint a key, connect an MCP client, and complete a real task using only the
 * docs site" (acceptance criterion). #959's Docusaurus site (ROADMAP §3.2)
 * doesn't exist yet, so this in-app page is the interim home for the API
 * reference; move this content there wholesale once #959 lands rather than
 * maintaining two copies (R-3.1).
 *
 * Every fact below is read live from the generated registry/manifest —
 * `API_REGISTRY`, `CURATED_TOOL_DEFS`, `sdk-snippets.ts` — never hand-typed,
 * so this page cannot describe an operation that doesn't exist or has
 * drifted from its real schema.
 */
export default function ApiDocsPage() {
  const stable = API_REGISTRY.filter((op) => op.stability === "stable" && op.agentReachable);
  const reachableCount = API_REGISTRY.filter((op) => op.agentReachable).length;

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-10 sm:px-6">
      <PageIntro />
      <GettingStartedCards />
      <CompatibilityPolicySection stableCount={stable.length} reachableCount={reachableCount} />
      <WebhookEventsSection />
      <CuratedOperationsSection stable={stable} reachableCount={reachableCount} />
      <footer className="border-t border-border pt-6 text-xs text-muted">
        Architecture: FEATUREDOCS/56. Design doc: docs/designs/api-mcp-reimplementation.md. Third-party
        developer access (OAuth apps, quotas, a marketplace) is designed for but not shipped — see decision
        5.
      </footer>
    </div>
  );
}

function PageIntro() {
  return (
    <header className="space-y-2">
      <p className="t-overline text-muted">Developer reference</p>
      <h1 className="t-title text-ink text-3xl">RVLT Flow Agent API</h1>
      <p className="t-body text-muted">
        A REST API and an MCP server over the exact gates a human operator faces in the UI — RBAC, org
        isolation, project locks, overbooking checks — enforced inside the same Convex mutation as the
        write, not re-implemented here. See{" "}
        <a className="underline" href="/llms.txt">
          /llms.txt
        </a>{" "}
        for the plain-text agent-facing summary and{" "}
        <a className="underline" href="/api/v1/openapi.json">
          /api/v1/openapi.json
        </a>{" "}
        for the full machine-readable contract.
      </p>
    </header>
  );
}

function GettingStartedCards() {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>1. Mint a key</CardTitle>
          <CardDescription>
            <Link className="underline" href="/settings/api-keys">
              Settings → API keys
            </Link>{" "}
            → &ldquo;Connect an AI Agent&rdquo; mints a read-only key and a ready-to-paste MCP config in one
            click. Use the explicit form for write scopes or other presets.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Connect over MCP</CardTitle>
          <CardDescription>
            Streamable HTTP, bearer-authenticated, at <code>{API_BASE_URL}/api/v1/mcp</code>. Any MCP client
            that speaks remote/streamable HTTP servers works directly; for stdio-only clients, run the local
            proxy bundled in this repo (<code>pnpm run mcp:stdio-proxy</code>).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md border border-border bg-paper-2 p-3 text-xs">
            {JSON.stringify(
              {
                mcpServers: {
                  "rvlt-flow": {
                    url: `${API_BASE_URL}/api/v1/mcp`,
                    headers: { Authorization: "Bearer <your key>" },
                  },
                },
              },
              null,
              2,
            )}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. Or call REST directly</CardTitle>
          <CardDescription>
            <code>GET /whoami</code> to check your key, <code>GET /operations</code> to list what it can
            call, then <code>POST /ops/{"{operation}"}</code> with{" "}
            <code>{"{\"args\": {...}, \"idempotencyKey\": \"...\"}"}</code> (idempotencyKey required for
            writes). An operation absent from <code>/operations</code> is a 404 at <code>/ops/{"{operation}"}</code>{" "}
            — the surface is closed by default.
          </CardDescription>
        </CardHeader>
      </Card>
    </>
  );
}

function CompatibilityPolicySection({ stableCount, reachableCount }: { stableCount: number; reachableCount: number }) {
  return (
    <section className="space-y-3">
      <h2 className="t-title text-ink text-xl">Compatibility policy</h2>
      <p className="t-body text-muted">
        Two stability tiers, declared per operation and in the OpenAPI description:
      </p>
      <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
        <li>
          <strong className="text-ink">stable</strong> — the {stableCount} curated operations below, the
          error <code>code</code> vocabulary, the scope vocabulary, the envelope shape, and webhook event
          schemas. Additive-only within <code>/v1</code>: fields and operations may be added, never removed
          or narrowed. A breaking change means <code>/v2</code>. Enforced mechanically, not by intention — a
          CI check fails the build if a stable operation loses a field or disappears.
        </li>
        <li>
          <strong className="text-ink">tracks-app</strong> — the other {reachableCount - stableCount} agent-
          reachable operations (REST&apos;s <code>/ops/{"{operation}"}</code> generic surface, MCP&apos;s{" "}
          <code>call_operation</code> tool). Follows the app&apos;s internals directly, so an ordinary
          refactor is not a breaking API change.
        </li>
      </ul>
      <p className="t-body text-muted">
        Mechanics: the <code>/v1</code> path prefix, the <code>rvlt_flow.v1.*</code> MCP tool namespace,
        versioned webhook events (e.g. <code>project.status_changed.v1</code>), an{" "}
        <code>X-RVLT-Flow-API-Version</code> response header, and an in-band <code>warnings[]</code> array on
        every success envelope — the only deprecation channel an autonomous agent reliably consumes.
      </p>
    </section>
  );
}

function WebhookEventsSection() {
  return (
    <section className="space-y-3">
      <h2 className="t-title text-ink text-xl">Webhook events</h2>
      <p className="t-body text-muted">
        Configure endpoints at Settings → Webhooks. Signed, replay-resistant, retried with dedupe.
      </p>
      <table className="w-full border-collapse text-sm">
        <tbody>
          {WEBHOOK_EVENTS.map((event) => (
            <tr key={event} className="border-b border-border">
              <td className="whitespace-nowrap py-1.5 pr-4 font-mono text-xs text-ink">{event}</td>
              <td className="py-1.5 text-muted">{WEBHOOK_EVENT_DESCRIPTIONS[event]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function CuratedOperationsSection({
  stable,
  reachableCount,
}: {
  stable: readonly (typeof API_REGISTRY)[number][];
  reachableCount: number;
}) {
  const curatedByOperation = new Map(CURATED_TOOL_DEFS.filter((d) => d.operation).map((d) => [d.operation, d]));

  return (
    <section className="space-y-4">
      <h2 className="t-title text-ink text-xl">Curated operations ({stable.length})</h2>
      <p className="t-body text-muted">
        The hand-picked, additive-only surface — the same operations backing the curated MCP tools. Beyond
        these, <code>GET /operations</code> / the MCP <code>list_operations</code> tool enumerate the full
        agent-reachable surface ({reachableCount} operations).
      </p>
      {stable.map((op) => {
        const curated = curatedByOperation.get(op.operation);
        const snippets = snippetsFor(op);
        return (
          <details key={op.operation} className="rounded-[var(--radius)] border-2 border-border bg-card p-4">
            <summary className="cursor-pointer select-none">
              <span className="font-mono text-sm text-ink">{op.operation}</span>{" "}
              <span className="text-xs text-muted">
                ({op.kind}
                {op.scopePairs.length ? `, scope: ${op.scopePairs.map((p) => `${p.resource}:${p.action}`).join(" or ")}` : ""})
              </span>
            </summary>
            <div className="mt-3 space-y-3">
              {curated?.summary && <p className="text-sm text-muted">{curated.summary}</p>}
              <SnippetBlock label="curl" code={snippets.curl} />
              <SnippetBlock label="TypeScript" code={snippets.typescript} />
              <SnippetBlock label="Python" code={snippets.python} />
            </div>
          </details>
        );
      })}
    </section>
  );
}

function SnippetBlock({ label, code }: { label: string; code: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-fg-2">{label}</p>
      <pre className="overflow-x-auto rounded-md border border-border bg-paper-2 p-2.5 text-xs">{code}</pre>
    </div>
  );
}
