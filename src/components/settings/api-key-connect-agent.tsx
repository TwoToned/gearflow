"use client";

import { useState } from "react";
import Link from "next/link";
import { Bot, Check, Copy, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { createApiKey } from "@/server/api-keys";
import { findApiKeyPreset } from "@/lib/api-key-presets";
import { SettingsCard, FormSection } from "@/components/layout/page-layouts";
import { Button } from "@/components/ui/button";

type TestState = "idle" | "testing" | "ok" | "error";

/** Pure `whoami` round-trip — split out of the component so its branching
 *  (fetch, non-2xx, org mismatch) doesn't add to ConnectAgentCard's own
 *  complexity (R-3.6). Two small pieces rather than one — fetchWhoami owns
 *  the HTTP/error-envelope shape, checkWhoami owns the org-match message. */
async function fetchWhoami(token: string): Promise<{ organizationId?: string; actingUser?: { name?: string } }> {
  const res = await fetch("/api/v1/whoami", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? "Request failed");
  return body.data ?? {};
}

async function checkWhoami(
  token: string,
  expectedOrgId: string | undefined,
  expectedOrgName: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    const data = await fetchWhoami(token);
    if (data.organizationId !== expectedOrgId) {
      return { ok: false, message: "Connected, but returned a different organization than expected." };
    }
    return { ok: true, message: `Connected as ${data.actingUser?.name ?? "agent"} — ${expectedOrgName}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Connection test failed" };
  }
}

/**
 * "Connect an AI Agent" one-screen flow (design §14): one click mints a
 * `read_only_agent` key, renders a copy-paste MCP config, and a "Test
 * connection" button that calls `whoami` and echoes the org back. Target
 * time-to-hello-world < 5 minutes.
 */
export function ConnectAgentCard({
  orgId,
  disabled,
  onCreated,
}: {
  orgId: string | undefined;
  disabled?: boolean;
  onCreated: (token: string, name: string) => void;
}) {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const [connected, setConnected] = useState<{ token: string; prefix: string } | null>(null);
  const [testResult, setTestResult] = useState<TestState>("idle");
  const [testMessage, setTestMessage] = useState<string | null>(null);

  const connectMutation = useServerMutation({
    mutationFn: () => {
      const preset = findApiKeyPreset("read_only_agent")!;
      return createApiKey({
        name: `AI Agent (${new Date().toLocaleDateString("en-AU")})`,
        actingUserId: session?.user?.id ?? "",
        scopes: [...preset.scopes],
        noFinancials: preset.noFinancialsDefault,
      });
    },
    onSuccess: (res) => {
      setConnected({ token: res.token, prefix: res.key.prefix });
      onCreated(res.token, res.key.name);
    },
    onError: (e) => toast.error(e.message),
  });

  async function testConnection() {
    if (!connected) return;
    setTestResult("testing");
    const result = await checkWhoami(connected.token, orgId, activeOrg?.name ?? "this org");
    setTestResult(result.ok ? "ok" : "error");
    setTestMessage(result.message);
  }

  return (
    <SettingsCard>
      <FormSection
        title="Connect an AI Agent"
        description="Mint a read-only key and get a ready-to-paste MCP config in one step. Use the explicit Create key form below for write access or other presets."
      >
        <div className="sm:col-span-2 space-y-4">
          <p className="text-xs text-fg-3">
            Full API reference, SDK snippets, and webhook events:{" "}
            <Link href="/docs/api" className="underline">
              /docs/api
            </Link>
          </p>
          {connected ? (
            <ConnectedAgentPanel
              connected={connected}
              testResult={testResult}
              testMessage={testMessage}
              onTest={testConnection}
            />
          ) : (
            <Button
              type="button"
              disabled={disabled || !orgId || !session?.user?.id || connectMutation.isPending}
              onClick={() => connectMutation.mutate()}
            >
              {connectMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Bot className="mr-2 h-4 w-4" />
              )}
              Connect an AI Agent
            </Button>
          )}
        </div>
      </FormSection>
    </SettingsCard>
  );
}

/** The post-mint config + test-connection panel — split out so its own
 *  conditional rendering doesn't add to ConnectAgentCard's complexity. */
function ConnectedAgentPanel({
  connected,
  testResult,
  testMessage,
  onTest,
}: {
  connected: { token: string; prefix: string };
  testResult: TestState;
  testMessage: string | null;
  onTest: () => void;
}) {
  const mcpUrl = typeof window !== "undefined" ? `${window.location.origin}/api/v1/mcp` : "/api/v1/mcp";
  const mcpConfig = JSON.stringify(
    {
      mcpServers: {
        "rvlt-flow": {
          url: mcpUrl,
          headers: { Authorization: `Bearer ${connected.token}` },
        },
      },
    },
    null,
    2,
  );

  async function copyConfig() {
    try {
      await navigator.clipboard.writeText(mcpConfig);
      toast.success("MCP config copied");
    } catch {
      toast.error("Couldn't copy — select and copy manually");
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-fg-2">MCP config — paste into your client</p>
        <div className="flex items-start gap-2">
          <pre className="flex-1 overflow-x-auto rounded-md border border-border bg-paper-2 p-2.5 text-xs">
            {mcpConfig}
          </pre>
          <Button type="button" size="sm" variant="line" onClick={copyConfig} aria-label="Copy MCP config">
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="line" size="sm" onClick={onTest} disabled={testResult === "testing"}>
          {testResult === "testing" && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          Test connection
        </Button>
        <TestResultBadge testResult={testResult} testMessage={testMessage} />
      </div>
      <p className="text-xs text-fg-3">
        Key {connected.prefix}… created with the read_only_agent preset — see it (and its request log)
        in the API keys list below.
      </p>
    </div>
  );
}

function TestResultBadge({ testResult, testMessage }: { testResult: TestState; testMessage: string | null }) {
  if (testResult === "ok") {
    return (
      <span className="flex items-center gap-1 text-xs text-ok">
        <Check className="h-3.5 w-3.5" /> {testMessage}
      </span>
    );
  }
  if (testResult === "error") {
    return (
      <span className="flex items-center gap-1 text-xs text-t-out">
        <X className="h-3.5 w-3.5" /> {testMessage}
      </span>
    );
  }
  return null;
}
