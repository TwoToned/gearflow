import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../../../../../convex/_generated/api";
import { getProjectById } from "@/lib/projects-read";
import { getCrewMemberById, getCrewRoleById } from "@/lib/crew-read";

/**
 * GET /api/crew/respond/[token]?action=accept|decline
 *
 * Public endpoint for crew members to respond to offers via email links.
 * The response token IS the auth — no session required.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const action = request.nextUrl.searchParams.get("action");

  if (!action || !["accept", "decline"].includes(action)) {
    return htmlResponse(
      "Invalid Request",
      "The link you followed is invalid. Please check the email and try again.",
      "error"
    );
  }

  // Token IS the bearer credential — service-only Convex lookup by responseToken.
  const convex = await getConvexClient();
  const assignment = await convex.query(api.crewAssignments.getByResponseToken, {
    responseToken: token,
  });

  if (!assignment) {
    return htmlResponse(
      "Link Expired",
      "This response link is no longer valid. The offer may have been withdrawn or already responded to.",
      "error"
    );
  }

  // Resolve the project + crew member / role (all Convex-only) for display.
  const project = await getProjectById(assignment.projectId);
  const crewMember = await getCrewMemberById(assignment.crewMemberId);
  const crewRole = assignment.crewRoleId
    ? await getCrewRoleById(assignment.crewRoleId)
    : null;
  const projectDisplayName = project?.name ?? "this project";

  // Check if already responded
  if (assignment.respondedAt) {
    const statusText =
      assignment.status === "ACCEPTED"
        ? "accepted"
        : assignment.status === "DECLINED"
          ? "declined"
          : assignment.status;
    return htmlResponse(
      "Already Responded",
      `You have already ${statusText} this offer for <strong>${projectDisplayName}</strong>.`,
      "info"
    );
  }

  // Check if assignment is still in OFFERED status
  if (assignment.status !== "OFFERED") {
    return htmlResponse(
      "Offer Updated",
      `This offer is no longer pending a response. Current status: <strong>${assignment.status}</strong>.`,
      "info"
    );
  }

  // Status-machine: ACCEPTED / DECLINED, stamp respondedAt, clear the single-use
  // token. Convex-only write (responseToken cleared via `clear`, not set).
  const newStatus = action === "accept" ? "ACCEPTED" : "DECLINED";
  await convex.mutation(api.crewAssignments.patchAssignment, {
    id: assignment.id,
    set: {
      status: newStatus,
      respondedAt: Date.now(),
      updatedAt: Date.now(),
    },
    clear: ["responseToken"], // Invalidate token after use
  });

  const crewName = `${crewMember?.firstName ?? ""} ${crewMember?.lastName ?? ""}`.trim();
  const projectName = `${project?.projectNumber ?? ""} — ${projectDisplayName}`;
  const roleName = crewRole?.name || "Crew";

  if (action === "accept") {
    return htmlResponse(
      "Offer Accepted",
      `<p>Thank you, <strong>${crewName}</strong>! You have accepted the <strong>${roleName}</strong> position for:</p>
       <p><strong>${projectName}</strong></p>
       <p>The team will be in touch with further details.</p>`,
      "success"
    );
  } else {
    return htmlResponse(
      "Offer Declined",
      `<p><strong>${crewName}</strong>, you have declined the <strong>${roleName}</strong> position for:</p>
       <p><strong>${projectName}</strong></p>
       <p>Thank you for letting us know.</p>`,
      "info"
    );
  }
}

function htmlResponse(
  title: string,
  message: string,
  type: "success" | "error" | "info"
) {
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
    .status h1 { color: ${c.icon}; margin: 0 0 8px; font-size: 20px; }
    .message { color: #374151; line-height: 1.6; }
    .footer { text-align: center; color: #9ca3af; font-size: 12px; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="status">
      <h1>${title}</h1>
    </div>
    <div class="message">${message}</div>
  </div>
  <p class="footer">GearFlow</p>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
