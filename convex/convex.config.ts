import { defineApp } from "convex/server";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";

// Convex component registry (Phase 3 — browser-direct security baseline).
//
// The rate limiter replaces the implicit throttling the server-action tier used to
// give: once the browser calls mutations directly, a runaway or abusive client can
// hammer the public mutation surface with nothing in front of it. `components.rateLimiter`
// is consumed via convex/lib/rateLimiter.ts.
const app = defineApp();
app.use(rateLimiter);

export default app;
