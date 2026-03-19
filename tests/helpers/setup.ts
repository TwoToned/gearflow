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
