"use client";

import { motion, useReducedMotion } from "framer-motion";
import { type ReactNode } from "react";

const EASE: [number, number, number, number] = [0.2, 0, 0, 1];

// Staggered list container
export function StaggerList({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: {
            staggerChildren: reduce ? 0 : 0.03,
            delayChildren: reduce ? 0 : delay,
          },
        },
      }}
    >
      {children}
    </motion.div>
  );
}

// Individual stagger item
export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      variants={{
        hidden: reduce ? { opacity: 1 } : { opacity: 0, y: 8 },
        visible: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.25, ease: EASE },
        },
      }}
    >
      {children}
    </motion.div>
  );
}

// Fade in on mount
export function FadeIn({ children, className, delay = 0, duration = 0.3 }: { children: ReactNode; className?: string; delay?: number; duration?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? { opacity: 1 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : duration, delay: reduce ? 0 : delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

// Animated number counter
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const reduce = useReducedMotion();

  if (reduce || typeof value !== "number") {
    return <span className={className}>{value}</span>;
  }

  return (
    <motion.span
      className={className}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
      key={value}
    >
      {value}
    </motion.span>
  );
}

// Surface hover lift (wrap interactive cards)
export function SurfaceLift({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      whileHover={reduce ? {} : { y: -1, transition: { duration: 0.2, ease: EASE } }}
      whileTap={reduce ? {} : { scale: 0.98 }}
    >
      {children}
    </motion.div>
  );
}

// Tab content crossfade
export function TabFade({ children, className, layoutId }: { children: ReactNode; className?: string; layoutId?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      layoutId={layoutId}
      initial={reduce ? { opacity: 1 } : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reduce ? { opacity: 1 } : { opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      {children}
    </motion.div>
  );
}
