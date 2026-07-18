/**
 * In-memory fake email transport (POLICY.md R-8.10.4 — every adapter should
 * have a local/fake implementation for tests). Mirrors the `sendEmail()`
 * signature so tests can assert what WOULD be sent without hitting Resend, and
 * without depending on `NODE_ENV`/`RESEND_API_KEY` dev-mock behaviour.
 *
 * The production path (`src/lib/email.ts`) already no-ops to `{ id: "dev-mock" }`
 * when no API key is configured; this fake is the deterministic, inspectable
 * counterpart for unit/integration tests.
 */
import type { EmailAttachment } from "@/lib/email";

export interface FakeSentEmail {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}

export interface FakeEmailTransport {
  /** Drop-in for `sendEmail` — records the message and returns a stable id. */
  send: (msg: FakeSentEmail) => Promise<{ id: string }>;
  /** Everything captured so far, in send order. */
  readonly sent: readonly FakeSentEmail[];
  /** Most recent message, or undefined if nothing was sent. */
  last: () => FakeSentEmail | undefined;
  /** Reset captured state between tests. */
  clear: () => void;
}

export function createFakeEmailTransport(): FakeEmailTransport {
  const sent: FakeSentEmail[] = [];
  let counter = 0;
  return {
    send: async (msg) => {
      sent.push(msg);
      counter += 1;
      return { id: `fake-${counter}` };
    },
    get sent() {
      return sent;
    },
    last: () => sent[sent.length - 1],
    clear: () => {
      sent.length = 0;
    },
  };
}
