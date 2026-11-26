import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * `purpose: "crew-document"` is the only way into the reserved crew-documents folder: it needs
 * crew:update, takes PDFs and images only, and forces the folder; naming that folder directly, or an
 * unknown purpose, is refused. An ordinary upload is unchanged.
 */
const state = vi.hoisted(() => ({ permitted: true, uploads: [] as { folder: string; entityId: string }[] }));

vi.mock("@/env", () => ({ env: { UPLOAD_MAX_SIZE_MB: 5 } }));
vi.mock("@/lib/csrf", () => ({ validateCsrfOrigin: () => null }));
vi.mock("@/lib/auth-server", () => ({ requireOrganization: async () => ({ organizationId: "org1", session: { user: { id: "u1" } } }) }));
vi.mock("@/lib/org-context", () => ({
  requirePermission: async () => {
    if (!state.permitted) throw new Error("no");
    return { organizationId: "org1", userId: "u1", userName: "A" };
  },
}));
vi.mock("@/lib/storage", () => ({
  ensureBucket: async () => {},
  uploadToS3: async (_b: Buffer, o: { folder: string; entityId: string }) => {
    state.uploads.push({ folder: o.folder, entityId: o.entityId });
    return { storageKey: "k1", url: "/api/files/k1" };
  },
}));
vi.mock("@/lib/thumbnails", () => ({ generateThumbnail: async () => null, isImageMimeType: (m: string) => m.startsWith("image/"), thumbExtension: () => ".jpg" }));
vi.mock("file-type", () => ({ fileTypeFromBuffer: async () => undefined }));
vi.mock("@/lib/convex-client", () => ({ getConvexClient: async () => ({ mutation: async () => undefined }), toConvexDoc: (d: unknown) => d }));
vi.mock("../../../../../convex/_generated/api", () => ({ api: { fileUploads: { createIfMissing: "createIfMissing" } } }));

import { POST } from "../route";

function post(fields: Record<string, string>, type = "application/pdf") {
  const form = new FormData();
  form.append("file", new File(["%PDF"], "card.pdf", { type }));
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return POST(new NextRequest("https://flow.test/api/uploads", { method: "POST", body: form }));
}

beforeEach(() => {
  state.permitted = true;
  state.uploads = [];
});

describe("POST /api/uploads: the crew-document purpose", () => {
  it("forces the reserved folder for a permitted caller", async () => {
    const res = await post({ purpose: "crew-document", folder: "anything", entityId: "c1" });
    expect(res.status).toBe(200);
    expect(state.uploads).toEqual([{ folder: "crew-documents", entityId: "c1" }]);
  });

  it("needs crew:update, a PDF or image, and a known purpose", async () => {
    state.permitted = false;
    expect((await post({ purpose: "crew-document" })).status).toBe(403);
    state.permitted = true;
    expect((await post({ purpose: "crew-document" }, "application/msword")).status).toBe(400);
    expect((await post({ purpose: "something-else" })).status).toBe(400);
    expect(state.uploads).toEqual([]);
  });

  it("naming the reserved folder without the purpose is refused; an ordinary upload is unchanged", async () => {
    expect((await post({ folder: "crew-documents" })).status).toBe(400);
    expect((await post({ folder: "supplier-documents", entityId: "s1" })).status).toBe(200);
    expect(state.uploads).toEqual([{ folder: "supplier-documents", entityId: "s1" }]);
  });
});
