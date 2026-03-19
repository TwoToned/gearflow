import { useState, useEffect } from "react";

/**
 * Hook that respects the user's prefers-reduced-motion setting.
 * Per DESIGN.md: All animations MUST respect prefers-reduced-motion.
 * When enabled, animations degrade to instant transitions (opacity only, no transforms).
 */
export function useReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReduced(mql.matches);

    const handler = (e: MediaQueryListEvent) => setPrefersReduced(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return prefersReduced;
}
