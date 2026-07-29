import { NextResponse } from "next/server";

/**
 * `/v1` versioning mechanics (design §13 compatibility policy): a path
 * prefix, an `X-RVLT-Flow-API-Version` response header, and an in-band
 * `warnings[]` channel — "the only deprecation channel an autonomous agent
 * reliably consumes." Every `dispatch()` success envelope carries
 * `warnings: string[]` (dispatcher.ts); it's always empty today because no
 * operation is deprecated yet, but the channel exists from day one so a
 * future deprecation notice has somewhere to land without a response-shape
 * change. Applied uniformly across REST and MCP so neither surface diverges
 * from the other (design §10: "identical for REST and MCP").
 */
export const API_VERSION = "v1";
export const API_VERSION_HEADER = "X-RVLT-Flow-API-Version";

/** The one place the production base URL is spelled out for API consumers —
 *  OpenAPI's `servers[0].url` and every generated/rendered SDK snippet. */
export const API_BASE_URL = "https://flow.rvlt.app";

export function withApiVersionHeader(response: NextResponse): NextResponse {
  response.headers.set(API_VERSION_HEADER, API_VERSION);
  return response;
}
