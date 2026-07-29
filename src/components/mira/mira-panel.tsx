"use client";

import { useState } from "react";
import { Loader2, Send, X } from "lucide-react";
import { useMira } from "@/components/providers/mira-context-provider";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { askMira } from "@/server/mira";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Exchange {
  question: string;
  answer: string;
}

/**
 * Mira's minimal chat panel (Phase 8, #1004) — the first real UI consumer of
 * `useMira()`. Deliberately small: a question box and a running transcript,
 * no streaming, no markdown rendering. The point of this phase is that Mira
 * is a real MCP/dispatch consumer with page context flowing in automatically
 * (see src/hooks/use-mira-page-context.ts) — a richer assistant UI is future
 * work once a real LLM sits behind `askMira` (src/server/mira.ts).
 *
 * Code-split at its mount point (mira-launcher.tsx uses `next/dynamic`) per
 * mira-context-provider.tsx's own note: the provider stays trivial so it
 * never delays paint, and the actual panel — this file — is the "heavy"
 * part deferred until Mira is opened.
 */
export function MiraPanel() {
  const mira = useMira();
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<Exchange[]>([]);

  const ask = useServerMutation({
    mutationFn: (q: string) => askMira(q, mira?.pageContext ?? null),
    onSuccess: (res, q) => {
      setHistory((h) => [...h, { question: q, answer: res.answer }]);
      setQuestion("");
    },
  });

  if (!mira?.open) return null;

  function submit() {
    const q = question.trim();
    if (!q || ask.isPending) return;
    ask.mutate(q);
  }

  return (
    <div className="fixed bottom-20 right-4 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col rounded-[var(--radius)] border-2 border-border bg-card shadow-[var(--sh-card)] md:bottom-4">
      <div className="flex items-center justify-between border-b border-border p-3">
        <span className="t-title text-sm text-ink">Ask Mira</span>
        <Button type="button" variant="ghost" size="icon" aria-label="Close Mira" onClick={() => mira.setOpen(false)}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="max-h-80 space-y-3 overflow-y-auto p-3">
        {history.length === 0 && (
          <p className="text-xs text-muted">
            Ask about the project you&apos;re viewing, or say &ldquo;list assets&rdquo;.
          </p>
        )}
        {history.map((exchange, i) => (
          <div key={i} className="space-y-1">
            <p className="text-xs font-medium text-ink">{exchange.question}</p>
            <p className="text-xs text-muted">{exchange.answer}</p>
          </div>
        ))}
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
          disabled={ask.isPending}
        />
        <Button type="button" size="icon" aria-label="Send" onClick={submit} disabled={ask.isPending || !question.trim()}>
          {ask.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
