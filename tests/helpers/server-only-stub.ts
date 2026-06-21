/**
 * No-op stub for the `server-only` package.
 *
 * `server-only` is a build-time guard: in a Next.js build it throws if a module
 * marked `import "server-only"` is pulled into a client bundle. It isn't a real
 * runtime dependency (not installed in node_modules), so importing it under
 * vitest's node environment throws "Cannot find package 'server-only'". The
 * integration suite exercises server-side modules directly (the whole point), so
 * we alias `server-only` to this empty module. See vitest.integration.config.ts.
 */
export {};
