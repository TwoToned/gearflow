import { NextResponse } from "next/server";
import { consumeDiscordLink } from "@/lib/services/discord-link-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/discord/verify?token=…  — unauthenticated. Renders a confirmation
 *      page with a button that POSTs back. The token is NOT consumed on GET, so
 *      email link-scanners (which issue GETs) can't burn a single-use token.
 * POST /api/discord/verify  (token in the form body) — atomically consumes the
 *      token and creates the account link.
 *
 * Self-contained HTML (mirrors src/app/api/crew/respond/[token]) — no app layout,
 * no session.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!token) {
    return htmlResponse("Invalid link", "This verification link is missing its token. Re-run <strong>/link</strong> in Discord.", "error");
  }
  const safe = escapeHtml(token);
  return htmlResponse(
    "Confirm your Discord link",
    `<p>Click below to connect your Discord account to your GearFlow crew profile.</p>
     <form method="POST" action="/api/discord/verify" style="margin-top:20px;">
       <input type="hidden" name="token" value="${safe}" />
       <button type="submit" style="background:#0f766e;color:#fff;border:none;padding:12px 20px;border-radius:8px;font-size:15px;cursor:pointer;">Confirm Discord link</button>
     </form>`,
    "info",
  );
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const token = form?.get("token");
  if (typeof token !== "string" || !token) {
    return htmlResponse("Invalid link", "This verification link is missing its token.", "error");
  }

  const result = await consumeDiscordLink(token);
  switch (result.status) {
    case "linked":
      return htmlResponse(
        "Discord linked",
        `<p>Thanks, <strong>${escapeHtml(result.crewName)}</strong> — your Discord account is now connected to GearFlow. You'll get access to your project channels shortly. You can close this page.</p>`,
        "success",
      );
    case "already_linked":
      return htmlResponse(
        "Already linked",
        "<p>This crew profile (or Discord account) is already linked. If you need to change it, ask an admin to unlink it first.</p>",
        "info",
      );
    case "invalid":
    default:
      return htmlResponse(
        "Link expired",
        "<p>This verification link is invalid, already used, or expired. Re-run <strong>/link</strong> in Discord to get a fresh one.</p>",
        "error",
      );
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlResponse(title: string, message: string, type: "success" | "error" | "info") {
  const colors = {
    success: { bg: "#f0fdf4", border: "#86efac", icon: "#22c55e" },
    error: { bg: "#fef2f2", border: "#fca5a5", icon: "#ef4444" },
    info: { bg: "#eff6ff", border: "#93c5fd", icon: "#3b82f6" },
  };
  const c = colors[type];
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — GearFlow</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f9fafb; margin: 0; padding: 40px 20px; }
    .card { max-width: 500px; margin: 0 auto; background: white; border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .status { background: ${c.bg}; border: 1px solid ${c.border}; border-radius: 8px; padding: 16px; margin-bottom: 20px; }
    .status h1 { color: ${c.icon}; margin: 0; font-size: 20px; }
    .message { color: #374151; line-height: 1.6; }
    .footer { text-align: center; color: #9ca3af; font-size: 12px; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="status"><h1>${title}</h1></div>
    <div class="message">${message}</div>
  </div>
  <p class="footer">GearFlow</p>
</body>
</html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
