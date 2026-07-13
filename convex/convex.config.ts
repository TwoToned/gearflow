import { defineApp } from "convex/server";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import shardedCounter from "@convex-dev/sharded-counter/convex.config";

// Convex component registry (Phase 3 — browser-direct security baseline + gate #3).
//
// - rateLimiter: replaces the implicit throttling the server-action tier used to
//   give — once the browser calls mutations directly a runaway/abusive client can
//   hammer the public mutation surface with nothing in front of it. Consumed via
//   convex/lib/rateLimiter.ts.
// - shardedCounter (gate #3): removes hot-row OCC contention on the per-write
//   dashboard-counter delta path before high-write domains (warehouse/line-item/
//   asset) go browser-direct. Consumed via convex/lib/shardedCounter.ts.
const app = defineApp();
app.use(rateLimiter);
app.use(shardedCounter);

export default app;
