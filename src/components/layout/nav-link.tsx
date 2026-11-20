"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * A plain <a> that navigates via useRouter instead of Next.js <Link>.
 * Avoids the "removeChild" DOM conflict from <Link>'s internal DOM
 * manipulation interacting with Base UI's useRender composition. NEVER
 * replace with a plain <Link> for nav items (DOM crash on navigation).
 *
 * Modified clicks (⌘/ctrl/shift/alt, middle button) keep their native
 * open-in-new-tab behaviour.
 */
export const NavLink = React.forwardRef<
  HTMLAnchorElement,
  React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }
>(function NavLink({ href, onClick, children, ...props }, ref) {
  const router = useRouter();
  return (
    <a
      ref={ref}
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        router.push(href);
      }}
      {...props}
    >
      {children}
    </a>
  );
});
