import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Third-party skill files
      ".claude/skills/gstack/**",
      // Claude worktree artifacts (can contain massive build output)
      ".claude/worktrees/**",
    ],
  },
  {
    // Next 16 bundles the React Compiler-aware eslint-plugin-react-hooks,
    // which promoted several heuristic rules to "error". These flag patterns
    // that are intentional in this codebase (effects that sync external state,
    // narrowing-based component factories, etc.) and fixing them requires
    // behavioural refactors that carry real regression risk. Downgrade them to
    // "warn" so they stay visible in editors/CI logs without failing the build.
    // The non-heuristic correctness rules (react-hooks/refs, rules-of-hooks,
    // exhaustive-deps) remain errors.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/static-components": "warn",
    },
  },
];

export default eslintConfig;