import { LLMS_TXT } from "../llms-txt.generated";
import { OPENAPI_DOCUMENT } from "../openapi.generated";

/**
 * MCP resources (design §12): `llms.txt` and the OpenAPI spec, published as
 * MCP resources rather than tools — a client that already knows how to read
 * resources gets the same contract docs `GET /llms.txt` / `GET
 * /api/v1/openapi.json` serve, without an extra tool call. Same generated
 * constants the REST routes serve (src/lib/api/llms-txt.generated.ts,
 * openapi.generated.ts) — one source, two transports.
 */
export interface McpResourceDescriptor {
  uri: string;
  name: string;
  title: string;
  mimeType: string;
}

export const MCP_RESOURCES: readonly McpResourceDescriptor[] = [
  { uri: "rvlt-flow://llms.txt", name: "llms.txt", title: "Agent API summary (llms.txt)", mimeType: "text/plain" },
  { uri: "rvlt-flow://openapi.json", name: "openapi.json", title: "OpenAPI 3.1 contract", mimeType: "application/json" },
];

export function readMcpResource(uri: string): { mimeType: string; text: string } | null {
  switch (uri) {
    case "rvlt-flow://llms.txt":
      return { mimeType: "text/plain", text: LLMS_TXT };
    case "rvlt-flow://openapi.json":
      return { mimeType: "application/json", text: JSON.stringify(OPENAPI_DOCUMENT, null, 2) };
    default:
      return null;
  }
}
