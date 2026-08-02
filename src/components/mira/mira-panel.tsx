"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Loader2, Send, X, Trash2, Wrench, Check, Ban } from "lucide-react";
import { useMira } from "@/components/providers/mira-context-provider";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
import {
  getMiraConversation,
  sendMiraMessage,
  confirmMiraPendingAction,
  dismissMiraPendingAction,
  clearMiraConversation,
  type MiraConversationView,
} from "@/server/mira";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type MiraMessage = MiraConversationView["messages"][number];

/**
 * Mira's chat panel — a real, persisted, multi-turn conversation backed by an
 * LLM tool-calling loop (src/lib/mira/agent-loop.ts), not the old single
 * question/answer exchange. See FEATUREDOCS/68.
 *
 * `role: "tool"` messages are internal plumbing (a tool call's raw JSON
 * result) — rendered as a small collapsed trace chip, not a chat bubble.
 * `role: "assistant"` messages carrying a `pendingConfirmation` render a
 * Confirm/Dismiss card: confirming replays the EXACT operation/args Mira
 * already resolved (server-side, src/server/mira.ts), never by asking the
 * model to retry — see tool-defs.ts for why the model has no `confirm`
 * parameter to begin with.
 */
export function MiraPanel() {
  const mira = useMira();
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<MiraMessage[]>([]);
  const [loadedConversationId, setLoadedConversationId] = useState<string | null | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: conversation, isLoading: isLoadingConversation } = useServerQuery({
    queryKey: ["mira-conversation"],
    queryFn: () => getMiraConversation(),
    enabled: !!mira?.open,
  });

  useEffect(() => {
    if (!conversation || conversation.conversationId === loadedConversationId) return;
    setMessages(conversation.messages);
    setLoadedConversationId(conversation.conversationId);
  }, [conversation, loadedConversationId]);

  useEffect(() => {
    // jsdom (unit tests) doesn't implement Element.scrollTo — guard rather
    // than crash the effect (and the whole render) in that environment.
    const el = scrollRef.current;
    if (el && typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const ask = useServerMutation({
    mutationFn: (q: string) => sendMiraMessage(q, mira?.pageContext ?? null),
    onSuccess: (res) => {
      setMessages((prev) => [...prev, ...res.newMessages]);
      setQuestion("");
    },
  });

  const confirm = useServerMutation({
    mutationFn: (messageId: string) => confirmMiraPendingAction(messageId),
    onSuccess: (res, messageId) => {
      setMessages((prev) => [...prev.map((m) => (m.id === messageId ? { ...m, pendingConfirmation: null } : m)), ...res.newMessages]);
    },
  });

  const dismiss = useServerMutation({
    mutationFn: (messageId: string) => dismissMiraPendingAction(messageId),
    onSuccess: (_res, messageId) => {
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, pendingConfirmation: null } : m)));
    },
  });

  const clear = useServerMutation({
    mutationFn: () => clearMiraConversation(),
    onSuccess: () => {
      setMessages([]);
      setLoadedConversationId(null);
    },
  });

  if (!mira?.open) return null;

  function submit() {
    const q = question.trim();
    if (!q || ask.isPending) return;
    ask.mutate(q);
  }

  const busy = ask.isPending || confirm.isPending;

  return (
    <div className="fixed bottom-20 right-4 z-50 flex w-[min(420px,calc(100vw-2rem))] flex-col rounded-[var(--radius)] border-2 border-border bg-card shadow-[var(--sh-card)] md:bottom-4">
      <div className="flex items-center justify-between border-b border-border p-3">
        <span className="t-title text-sm text-ink">Ask Mira</span>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <Button type="button" variant="ghost" size="icon" aria-label="Clear conversation" disabled={clear.isPending} onClick={() => clear.mutate(undefined)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button type="button" variant="ghost" size="icon" aria-label="Close Mira" onClick={() => mira.setOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="max-h-[28rem] min-h-[10rem] space-y-3 overflow-y-auto p-3">
        {!isLoadingConversation && messages.length === 0 && (
          <p className="text-xs text-muted">Ask about the project you&apos;re viewing, or say &ldquo;list assets&rdquo;.</p>
        )}
        {messages.map((m) => (
          <MiraMessageRow
            key={m.id}
            message={m}
            onConfirm={() => confirm.mutate(m.id)}
            onDismiss={() => dismiss.mutate(m.id)}
            actionPending={confirm.isPending || dismiss.isPending}
          />
        ))}
        {ask.isPending && (
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <Loader2 className="h-3 w-3 animate-spin" /> Mira is thinking…
          </div>
        )}
        {ask.error && <p className="text-xs text-t-out">{ask.error.message}</p>}
      </div>

      <div className="flex items-center gap-2 border-t border-border p-3">
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="Ask a question…"
          aria-label="Ask Mira a question"
          disabled={busy}
        />
        <Button type="button" size="icon" aria-label="Send" onClick={submit} disabled={busy || !question.trim()}>
          {ask.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

function MiraMessageRow({
  message,
  onConfirm,
  onDismiss,
  actionPending,
}: {
  message: MiraMessage;
  onConfirm: () => void;
  onDismiss: () => void;
  actionPending: boolean;
}) {
  if (message.role === "tool") {
    return (
      <details className="rounded-[var(--r)] bg-paper-2 px-2 py-1 text-[11px] text-muted">
        <summary className="flex cursor-pointer items-center gap-1.5">
          <Wrench className="h-3 w-3 shrink-0" /> {message.toolName ?? "tool call"}
        </summary>
        <pre className="mt-1 whitespace-pre-wrap break-words text-[10px]">{message.content}</pre>
      </details>
    );
  }

  if (message.role === "user") {
    return <p className="text-xs font-medium text-ink">{message.content}</p>;
  }

  // assistant — content can be null when the turn was pure tool-calling with
  // no text yet (the tool trace rows around it tell that story instead).
  return (
    <div className="space-y-2">
      {message.content && (
        <div className="prose-mira text-xs text-muted [&_code]:rounded [&_code]:bg-paper-2 [&_code]:px-1 [&_code]:py-0.5 [&_p]:mb-1.5 [&_p:last-child]:mb-0 [&_ul]:mb-1.5 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:mb-1.5 [&_ol]:list-decimal [&_ol]:pl-4">
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>
      )}
      {message.pendingConfirmation && (
        <div className="rounded-[var(--r)] border border-border bg-paper-2 p-2.5 text-[11px]">
          <p className="mb-2 text-ink">{message.pendingConfirmation.summary}</p>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={actionPending} onClick={onConfirm}>
              <Check className="h-3.5 w-3.5" /> Confirm
            </Button>
            <Button type="button" size="sm" variant="line" disabled={actionPending} onClick={onDismiss}>
              <Ban className="h-3.5 w-3.5" /> Dismiss
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
