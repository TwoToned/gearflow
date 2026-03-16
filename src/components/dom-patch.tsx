"use client";

import { useEffect } from "react";

/**
 * Patches Node.prototype.removeChild and Node.prototype.insertBefore
 * to gracefully handle cases where React tries to manipulate a DOM node
 * that has already been removed (by browser extensions, theme switching,
 * or hydration mismatches).
 *
 * This fixes the recurring "Cannot read properties of null (reading 'removeChild')"
 * TypeError in Next.js + React 19.
 */
export function DomPatch() {
  useEffect(() => {
    // Only patch once
    if (
      (Node.prototype.removeChild as unknown as { __patched?: boolean })
        .__patched
    ) {
      return;
    }

    const originalRemoveChild = Node.prototype.removeChild;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Node.prototype.removeChild = function <T extends Node>(child: T): T {
      if (child.parentNode !== this) {
        if (process.env.NODE_ENV === "development") {
          console.warn(
            "DomPatch: removeChild called on a node that is not a child. Ignoring.",
            { parent: this, child }
          );
        }
        return child;
      }
      return originalRemoveChild.call(this, child) as T;
    };
    (Node.prototype.removeChild as unknown as { __patched: boolean }).__patched =
      true;

    const originalInsertBefore = Node.prototype.insertBefore;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Node.prototype.insertBefore = function <T extends Node>(
      newNode: T,
      referenceNode: Node | null
    ): T {
      if (referenceNode && referenceNode.parentNode !== this) {
        if (process.env.NODE_ENV === "development") {
          console.warn(
            "DomPatch: insertBefore called with a reference node that is not a child. Ignoring.",
            { parent: this, newNode, referenceNode }
          );
        }
        return newNode;
      }
      return originalInsertBefore.call(this, newNode, referenceNode) as T;
    };
  }, []);

  return null;
}
