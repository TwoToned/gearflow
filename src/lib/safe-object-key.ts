const DANGEROUS_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * True if `key` would reach the prototype chain (`__proto__`/`constructor`/`prototype`)
 * when used as a dynamic property name, e.g. `obj[key] = value`. Guard any bracket
 * assignment whose key traces back to user/remote input with this before writing.
 */
export function isDangerousObjectKey(key: string): boolean {
  return DANGEROUS_OBJECT_KEYS.has(key);
}
