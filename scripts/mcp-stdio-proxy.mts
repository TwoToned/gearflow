#!/usr/bin/env -S pnpm exec tsx
/**
 * Local stdio↔HTTP MCP bridge (decision 4, design §12, issue #999) — a cheap
 * escape hatch for MCP clients that only speak stdio and don't yet support
 * remote Streamable HTTP. Relays raw JSON-RPC messages between the client's
 * stdin/stdout and `/api/v1/mcp` unmodified: no protocol re-implementation,
 * no re-authentication, no re-validation — it's a pipe, not a second server.
 *
 * Today this lives in-repo, run via `pnpm exec tsx scripts/mcp-stdio-proxy.mts`
 * (or `pnpm run mcp:stdio-proxy`) by anyone with the repo checked out.
 * Publishing it as a standalone zero-install package (this repo is pnpm-only
 * — never `npm`/`npx`) is Phase 8 (#1004, "polish + external readiness") —
 * until then, `pnpm dlx mcp-remote <url> --header "Authorization:Bearer
 * <key>"` (a maintained third-party stdio↔HTTP MCP proxy) is the
 * zero-install equivalent for anyone without this repo.
 *
 * Usage:
 *   pnpm run mcp:stdio-proxy -- --url https://flow.rvlt.app/api/v1/mcp --key gf_live_...
 *   RVLT_FLOW_MCP_URL=... RVLT_FLOW_API_KEY=... pnpm run mcp:stdio-proxy
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

function readArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const url = readArg("--url") ?? process.env.RVLT_FLOW_MCP_URL;
const apiKey = readArg("--key") ?? process.env.RVLT_FLOW_API_KEY;

if (!url || !apiKey) {
  console.error(
    "Usage: mcp-stdio-proxy --url <https://.../api/v1/mcp> --key <gf_live_...>\n" +
      "  (or RVLT_FLOW_MCP_URL / RVLT_FLOW_API_KEY env vars)",
  );
  process.exit(1);
}

/** Wire two `Transport`s directly to each other — no `Client`/`Server`
 *  wrapper on either side, so there's no second capability negotiation or
 *  protocol-version handshake to keep in sync with the real endpoint; every
 *  JSON-RPC message the local client sends reaches `/api/v1/mcp` byte-for-byte,
 *  and every response comes back the same way. */
function relay(local: Transport, remote: Transport): void {
  local.onmessage = (message) => {
    remote.send(message).catch((err: unknown) => console.error("[mcp-stdio-proxy] send to remote failed:", err));
  };
  remote.onmessage = (message) => {
    local.send(message).catch((err: unknown) => console.error("[mcp-stdio-proxy] send to local client failed:", err));
  };
  local.onerror = (err) => console.error("[mcp-stdio-proxy] local transport error:", err);
  remote.onerror = (err) => console.error("[mcp-stdio-proxy] remote transport error:", err);
  local.onclose = () => remote.close().catch(() => {});
  remote.onclose = () => local.close().catch(() => {});
}

async function main(): Promise<void> {
  const local = new StdioServerTransport();
  const remote = new StreamableHTTPClientTransport(new URL(url as string), {
    requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
  });

  relay(local, remote);

  await remote.start();
  await local.start();
  console.error(`[mcp-stdio-proxy] relaying stdio ↔ ${url}`);
}

main().catch((err: unknown) => {
  console.error("[mcp-stdio-proxy] fatal:", err);
  process.exit(1);
});
