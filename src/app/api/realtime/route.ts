import { getSession } from "@/lib/auth-server";
import { getTheOrg } from "@/lib/single-org";
import { events } from "@/lib/events";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get("orgId");

  if (!orgId) {
    return new Response("orgId query parameter is required", { status: 400 });
  }

  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const org = await getTheOrg();
  if (!org || org.id !== orgId) {
    return new Response("Forbidden", { status: 403 });
  }

  const userId = session.user.id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let cleanedUp = false;

      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        unsub();
        clearInterval(heartbeat);
      };

      const unsub = events.onAny((event) => {
        if (cleanedUp) return;
        if (event.payload.orgId !== orgId) return;
        if (event.payload.actorId === userId) return;

        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          cleanup();
        }
      });

      const heartbeat = setInterval(() => {
        if (cleanedUp) return;
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          cleanup();
        }
      }, 15000);

      request.signal.addEventListener("abort", () => cleanup());
    },
    cancel() {
      // cleanup handled by abort listener above
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
