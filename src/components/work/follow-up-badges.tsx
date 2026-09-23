import { cn } from "@/lib/utils";
import { intentStyles } from "@/lib/status-colors";

/**
 * The source badge on an automated follow-up row (follow-up automation design
 * §8.7, work-layer §8.1's `auto` badge). `auto` says the system made it; `soon`
 * marks a loop whose deadline is under a week away — the same flag that makes
 * it push-eligible. Colours come from `status-colors.ts` intents only.
 */
export function FollowUpBadges({ urgent }: { urgent: boolean }) {
  return (
    <>
      <span
        className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium", intentStyles.neutral.pill)}
        title="Created by follow-up automation — it closes itself when the quote is accepted or declined."
      >
        auto
      </span>
      {urgent && (
        <span
          className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium", intentStyles.warning.pill)}
          title="The job needs deciding within a week."
        >
          soon
        </span>
      )}
    </>
  );
}
