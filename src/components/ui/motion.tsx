"use client";

import { motion, type HTMLMotionProps, AnimatePresence } from "framer-motion";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

/**
 * Design system motion constants from DESIGN.md.
 * Easing: cubic-bezier(0.2, 0, 0, 1) — fast start, gentle settle.
 */
export const easing = [0.2, 0, 0, 1] as const;

export const duration = {
  micro: 0.1,
  short: 0.15,
  medium: 0.2,
  long: 0.3,
} as const;

/** Common animation variants */
export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: duration.medium, ease: easing },
};

export const fadeInUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 4 },
  transition: { duration: duration.medium, ease: easing },
};

export const stagger = {
  animate: { transition: { staggerChildren: 0.03 } },
};

export const staggerItem = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: duration.short, ease: easing } },
};

/** Reduced-motion safe wrapper — degrades animations to opacity-only */
export function MotionDiv({
  children,
  ...props
}: HTMLMotionProps<"div"> & { children: React.ReactNode }) {
  const prefersReduced = useReducedMotion();

  if (prefersReduced) {
    const { initial, animate, exit, transition, ...rest } = props;
    return (
      <motion.div
        {...rest}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0 }}
      >
        {children}
      </motion.div>
    );
  }

  return <motion.div {...props}>{children}</motion.div>;
}

/** Staggered list container */
export function StaggerList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const prefersReduced = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial="initial"
      animate="animate"
      variants={prefersReduced ? undefined : stagger}
    >
      {children}
    </motion.div>
  );
}

/** Staggered list item */
export function StaggerItem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const prefersReduced = useReducedMotion();

  return (
    <motion.div
      className={className}
      variants={prefersReduced ? { initial: { opacity: 1 }, animate: { opacity: 1 } } : staggerItem}
    >
      {children}
    </motion.div>
  );
}

export { AnimatePresence };
