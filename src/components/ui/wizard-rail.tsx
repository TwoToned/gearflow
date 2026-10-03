import { cn } from "@/lib/utils";

/**
 * Flat five-pip progress rail for the org setup wizard (Phase C, #1068). Auth
 * pages follow the marketing/auth visual language (DESIGN.md §17), not the
 * numbered-circle `LifecycleStepper` (`src/components/ui/stepper.tsx`) used
 * for app-UI lifecycle status elsewhere — this is deliberately a separate,
 * simpler component rather than a reuse of that one (no labels, no
 * connectors, no click-through: see docs/designs/mockups/onboarding-mockup.html
 * screen 2's `.wiz-rail`/`.pip`, which this ports directly).
 */
export function WizardRail({ step, total }: { step: number; total: number }) {
  return (
    <div
      className="mb-6 flex gap-1.5"
      role="progressbar"
      aria-valuenow={step}
      aria-valuemin={1}
      aria-valuemax={total}
      aria-label={`Step ${step} of ${total}`}
    >
      {Array.from({ length: total }, (_, i) => {
        const n = i + 1;
        return (
          <span
            key={n}
            aria-hidden
            className={cn(
              "h-[3px] flex-1 rounded-full",
              n < step ? "bg-red-700" : n === step ? "bg-red" : "bg-line-2",
            )}
          />
        );
      })}
    </div>
  );
}
