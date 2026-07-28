import { NextResponse } from "next/server";

/**
 * `/v1` versioning mechanics (design §13 compatibility policy): a path
 * prefix, an `X-RVLT-Flow-API-Version` response header, and an in-band
 * `warnings[]` channel — "the only deprecation channel an autonomous agent
 * reliably consumes." No operation is deprecated yet, so `warnings[]` has no
 * content to carry today; the header is the part that needs to exist from
 * day one so a future deprecation notice has somewhere to land without a
 * response-shape change. Applied uniformly across REST and MCP so neither
 * surface diverges from the other (design §10: "identical for REST and MCP").
 */
export const API_VERSION = "v1";
export const API_VERSION_HEADER = "X-RVLT-Flow-API-Version";

export function withApiVersionHeader(response: NextResponse): NextResponse {
  response.headers.set(API_VERSION_HEADER, API_VERSION);
  return response;
}
