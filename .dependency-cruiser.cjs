/**
 * dependency-cruiser config (POLICY.md R-3.5): enforce acyclic module dependencies.
 * Run via `pnpm run depcruise`; wired into CI.
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment: "Circular dependencies make modules impossible to reason about in isolation.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      comment: "Orphaned modules are usually dead code (informational).",
      severity: "info",
      from: { orphan: true, pathNot: "\\.(d\\.ts|test\\.tsx?|spec\\.tsx?)$" },
      to: {},
    },
  ],
  options: {
    // Generated code is excluded from structure rules (POLICY.md R-0.5).
    exclude: { path: "node_modules|src/generated" },
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
    },
  },
};
