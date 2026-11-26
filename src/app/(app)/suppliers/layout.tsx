import { Suspense } from "react";
import { SupplierSheetHost } from "@/components/people/sheets/people-sheet-hosts";

/** Every page under /suppliers can open its create / edit sheet from the URL (`?new=1`, `?edit=1`): UX Phase 13. */
export default function SuppliersLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Suspense fallback={null}>
        <SupplierSheetHost />
      </Suspense>
    </>
  );
}
