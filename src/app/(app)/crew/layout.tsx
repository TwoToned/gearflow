import { Suspense } from "react";
import { CrewSheetHost } from "@/components/people/sheets/people-sheet-hosts";

/** Every page under /crew can open its create / edit sheet from the URL (`?new=1`, `?edit=1`): UX Phase 13. */
export default function CrewLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Suspense fallback={null}>
        <CrewSheetHost />
      </Suspense>
    </>
  );
}
