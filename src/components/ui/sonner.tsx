"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      // bottom-center stacks above the mobile tab bar / safe-area (§15.5/§16.10).
      // theme is left to the consumer (e.g. next-themes) so light mode works.
      position="bottom-center"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast bg-card border-2 border-border rounded-[var(--r)] shadow-[var(--sh-card)] text-ink text-[13.5px] font-sans",
          title: "font-semibold text-ink",
          description: "text-muted text-[12.5px]",
          actionButton:
            "bg-red text-white text-[12px] font-semibold rounded-full px-3 py-1",
          cancelButton:
            "bg-paper-2 text-muted text-[12px] font-semibold rounded-full px-3 py-1 border border-border",
          closeButton:
            "border border-border bg-card text-muted hover:text-ink hover:bg-elev rounded-[6px]",
          error: "text-red",
          success: "text-ok",
          warning: "text-warn",
          info: "text-blue",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
