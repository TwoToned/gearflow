// Ambient type for Vite/Vitest's `import.meta.glob`, used by convex-test
// (convex/rbac.test.ts) to load all Convex modules into the in-memory backend.
//
// Declared locally instead of referencing `vite/client` because those ambient
// types don't resolve under CI's pnpm hoisting (the Type Check job can't find
// `vite/client`), even though Vitest performs the actual transform at runtime.
// This merges with the lib's global `ImportMeta` interface.
interface ImportMeta {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}
