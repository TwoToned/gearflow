"use client";

import React from "react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Global error boundary that catches React rendering errors caused by
 * DOM manipulation mismatches (removeChild/insertBefore on null).
 * Auto-recovers by re-rendering the tree after a brief delay.
 */
export class GlobalErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState | null {
    // Only catch DOM manipulation errors — let others propagate
    if (
      error.message?.includes("removeChild") ||
      error.message?.includes("insertBefore") ||
      error.name === "NotFoundError"
    ) {
      return { hasError: true };
    }
    // Re-throw non-DOM errors
    throw error;
  }

  componentDidCatch(error: Error) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "GlobalErrorBoundary: caught DOM manipulation error, recovering…",
        error.message
      );
    }
  }

  componentDidUpdate(_prevProps: ErrorBoundaryProps, prevState: ErrorBoundaryState) {
    if (this.state.hasError && !prevState.hasError) {
      // Auto-recover after a tick so React can clean up
      setTimeout(() => {
        this.setState({ hasError: false });
      }, 0);
    }
  }

  render() {
    if (this.state.hasError) {
      // Render null so React unmounts the broken subtree.
      // The setTimeout in componentDidUpdate will clear hasError,
      // causing a clean remount of children on the next tick.
      return null;
    }
    return this.props.children;
  }
}
