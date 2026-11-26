import { Suspense } from "react";
import { ClientSheetHost } from "@/components/people/sheets/people-sheet-hosts";

/** Every page under /clients can open its create / edit sheet from the URL (`?new=1`, `?edit=1`): UX Phase 13. */
export default function ClientsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Suspense fallback={null}>
        <ClientSheetHost />
      </Suspense>
    </>
  );
}
