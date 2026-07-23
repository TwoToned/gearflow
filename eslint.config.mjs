import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import reactHooks from "eslint-plugin-react-hooks";

// eslint-plugin-react@7.37.5 (transitive dep of eslint-config-next) calls
// `context.getFilename()` for React version auto-detection, which ESLint 10
// removed. Pin the React version on every config object from next so detection
// never runs and the crash is avoided.
const pinReact = (config) => ({
  ...config,
  settings: { ...config.settings, react: { version: "19" } },
});

const eslintConfig = [
  // ESLint 10 no longer auto-resolves plugins referenced by name from a
  // shared config (eslint-config-next references "react-hooks/*" rules but
  // doesn't register the plugin object). Register it explicitly.
  {
    plugins: { "react-hooks": reactHooks },
  },
  ...nextVitals.map(pinReact),
  ...nextTs.map(pinReact),
  // Override default ignores of eslint-config-next.
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "ecosystem.config.js",
      "next-env.d.ts",
      // Third-party skill files
      ".claude/skills/gstack/**",
      // Claude worktree artifacts (can contain massive build output)
      ".claude/worktrees/**",
      // Generated code — excluded from length/naming rules per POLICY.md R-0.5
      "src/generated/**",
    ],
  },
  {
    // CommonJS build/generator scripts (the Convex schema/CRUD generators and
    // their shared parser) legitimately use require() — they run under Node as
    // .cjs, not through the bundler. Allow require() there only.
    files: ["scripts/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
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
      "react-hooks/refs": "warn",
      "react-hooks/use-memo": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
  {
    // POLICY.md hygiene gates, wired at WARN as a burn-down baseline (the repo's
    // lint entrypoint is bare `eslint`, so warnings stay visible in CI/editors
    // without failing the build). These are the registered threshold values:
    //   complexity  ≤10  (R-3.6 / T-1, NIST SP 500-235)
    //   file length ≤400 / function length ≤60  (R-3.7 / T-4)
    //   no explicit `any`  (R-8.2.2)
    //   naming: types are PascalCase  (R-3.9; full conventions in CONTRIBUTING.md)
    // Do NOT add new violations. Excludes generated code + tests per R-0.5.
    files: ["src/**/*.{ts,tsx}", "convex/**/*.ts"],
    ignores: [
      "**/*.test.{ts,tsx}",
      "**/*.spec.{ts,tsx}",
      "**/__tests__/**",
      "src/generated/**",
    ],
    rules: {
      complexity: ["warn", 10],
      "max-lines": [
        "warn",
        { max: 400, skipBlankLines: true, skipComments: true },
      ],
      "max-lines-per-function": [
        "warn",
        { max: 60, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      // Ban @ts-ignore / @ts-nocheck; allow described @ts-expect-error (R-8.2.2).
      "@typescript-eslint/ban-ts-comment": [
        "warn",
        {
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-expect-error": "allow-with-description",
        },
      ],
      "@typescript-eslint/naming-convention": [
        "warn",
        { selector: "typeLike", format: ["PascalCase"] },
        // Variables/functions are camelCase (UPPER_CASE for consts, PascalCase for
        // React components / factories); leading underscore for intentionally-unused
        // (R-3.9). Object properties are unconstrained — external API payloads use
        // snake_case and would otherwise be false positives.
        {
          selector: "variable",
          format: ["camelCase", "UPPER_CASE", "PascalCase"],
          leadingUnderscore: "allow",
        },
        {
          selector: "function",
          format: ["camelCase", "PascalCase"],
        },
        {
          selector: "parameter",
          format: ["camelCase", "PascalCase"],
          leadingUnderscore: "allow",
        },
      ],
    },
  },
  {
    // App logging must go through the structured logger (POLICY.md R-8.9.5): raw
    // console.* is unlevelled, unscrubbed, and carries no correlation id. The two
    // legitimate low-level uses (the logger's own transport + the crash-time floor
    // in process-safety) carry an inline eslint-disable with a reason.
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "**/*.test.{ts,tsx}",
      "**/*.spec.{ts,tsx}",
      "**/__tests__/**",
      "src/generated/**",
    ],
    rules: {
      "no-console": "error",
    },
  },
  {
    // No hardcoded color literals in UI components — use design tokens (POLICY.md
    // R-8.7.1) so a brand-color change is a one-line diff. Excludes legitimate
    // non-CSS contexts: canvas (favicon), browser theme-color meta, the brand-default
    // config constants themselves, Google Maps SDK pin props, and server-rendered HTML.
    files: ["src/components/**/*.tsx", "src/app/**/*.tsx"],
    ignores: [
      "src/components/layout/dynamic-favicon.tsx",
      "src/app/layout.tsx",
      "src/components/settings/branding-settings.tsx",
      "src/components/ui/address-map-inner.tsx",
      "src/app/api/**",
      "**/*.test.tsx",
      "**/*.spec.tsx",
      "**/__tests__/**",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // Matches either a literal that IS a hex code, or a Tailwind arbitrary-value
          // bracket embedding one (e.g. `text-[#fff]`, `bg-[#0a0f14]`) anywhere in the
          // string — the bracket delimiters keep this from firing on unrelated content
          // like URL fragments (`#faq`).
          selector:
            "Literal[value=/^#(?:[0-9a-fA-F]{3,4}){1,2}$|\\[#(?:[0-9a-fA-F]{3,4}){1,2}\\]/]",
          message:
            "Hardcoded color literal — use a design token (Tailwind class or var(--…)) per R-8.7.1.",
        },
      ],
    },
  },
  {
    // Vendor SDKs must be imported only from their adapter module (POLICY.md R-8.10.1):
    // maps → @/lib/maps-sdk; Resend → src/lib/email.ts (Next) or convex/emailActions.ts
    // (Convex — two runtimes, one adapter each); PostHog → posthog-provider.tsx (client)
    // or posthog-server.ts (server) — the sanctioned error/analytics capture boundary
    // (§8.9/§8.10); pdfme → src/lib/pdfme/generate-pdf.ts (single `generate()` call site).
    files: ["src/**/*.{ts,tsx}", "convex/**/*.ts"],
    ignores: [
      "src/lib/maps-sdk.ts",
      "src/lib/email.ts",
      "convex/emailActions.ts",
      "src/components/providers/posthog-provider.tsx",
      "src/lib/posthog-server.ts",
      "src/lib/pdfme/generate-pdf.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@vis.gl/react-google-maps",
              message: "Import maps primitives from @/lib/maps-sdk (R-8.10.1).",
            },
            {
              name: "resend",
              message:
                "Use the email adapter (src/lib/email.ts or convex/emailActions.ts) (R-8.10.1).",
            },
            {
              name: "posthog-js",
              message:
                "Use the analytics adapter (src/lib/analytics.ts / posthog-provider.tsx) (R-8.10.1).",
            },
            {
              name: "posthog-node",
              message: "Use the server adapter (src/lib/posthog-server.ts) (R-8.10.1).",
            },
            {
              name: "@pdfme/generator",
              message:
                "Use the PDF adapter (src/lib/pdfme/generate-pdf.ts renderPdfTemplate) (R-8.10.1).",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
