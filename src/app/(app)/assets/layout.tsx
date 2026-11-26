import { Suspense } from "react";
import { ModelSheetHost } from "@/components/assets/model-sheet-host";

/** Every page under /assets can open the model create/edit sheet from the URL (`?new-model=1`, `?edit-model=<id>`). */
export default function AssetsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Suspense fallback={null}>
        <ModelSheetHost />
      </Suspense>
    </>
  );
}
