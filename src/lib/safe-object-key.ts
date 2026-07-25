/**
 * Keys that reach the prototype chain (`__proto__`/`constructor`/`prototype`) when
 * used as a dynamic property name, e.g. `obj[key] = value`. Guard any bracket
 * assignment whose key traces back to user/remote input with
 * `DANGEROUS_OBJECT_KEYS.includes(key)` directly at the guard site — CodeQL's
 * prototype-pollution sanitizer recognition needs the array-membership check
 * inline at the point of use, not hidden behind a wrapper function call.
 */
export const DANGEROUS_OBJECT_KEYS: readonly string[] = ["__proto__", "constructor", "prototype"];
