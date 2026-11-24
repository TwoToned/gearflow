/** One row of Home's setup panel: a fact derived from real org state, and where it is fixed. */
export interface SetupPanelItem {
  key: string;
  label: string;
  href: string;
  /** The destination word (`Settings`, `Locations`). */
  where: string;
  done: boolean;
  /** A done row's real fact, e.g. the first model's name. */
  meta?: string;
}

/** One half of the panel ("Finish setup" or "Get started"), with its own dismissal. */
export interface SetupPanelHalf {
  items: SetupPanelItem[];
  /** Its reads are still in flight (the slot keeps its height meanwhile). */
  loading: boolean;
  /** Loaded, not dismissed, and not complete. */
  visible: boolean;
  /** Resolves to the dismissal row id it created, or null when already dismissed. */
  dismiss: () => Promise<string | null>;
  /** The exact reverse of one `dismiss()`. */
  undismiss: (id: string) => Promise<void>;
}
