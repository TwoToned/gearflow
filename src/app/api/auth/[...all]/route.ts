import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { withJwksResponseCache } from "@/lib/jwks-route-cache";

const handlers = toNextJsHandler(auth);

// GET /api/auth/jwks is memoized in-process + served with Cache-Control (#803):
// Convex fetches it to verify the token on every function call, and Better
// Auth's own handler is an uncached DB read per request. All other auth routes
// pass through untouched. See src/lib/jwks-route-cache.ts for the full policy.
export const GET = withJwksResponseCache(handlers.GET);
export const POST = handlers.POST;
