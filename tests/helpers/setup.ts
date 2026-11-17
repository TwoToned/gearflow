/**
 * Vitest global setup file.
 *
 * This runs before all test suites. Use for global mocks,
 * environment setup, or shared test configuration.
 */

// Stub server-only modules so validation schemas that import
// from files with transitive server deps can still be tested.
// Add stubs here as needed when tests fail due to missing
// server-side modules.

// jsdom has no matchMedia. `useIsMobile` (and so every row ⋯ menu) calls it on
// mount; default to "not a phone" so a component test needs no per-file stub.
// A test that wants the phone layout mocks `@/hooks/use-mobile` instead.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
