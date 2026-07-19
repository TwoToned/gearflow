"use client";
// use-client: interactive client route (below-the-fold interactivity) (R-8.1.1)

import { RequirePermission } from "@/components/auth/require-permission";
import { ListPageLayout } from "@/components/layout/page-layouts";
import { FadeIn } from "@/components/ui/motion";
import { FleetRoi } from "@/components/roi/fleet-roi";

export default function FleetRoiPage() {
  return (
    <FadeIn>
      {/* Gated on `model` rather than a new resource: this is the fleet's financial
          view of the model catalogue, and anyone who can see replacement costs on a
          model can already see the capital side of it. */}
      <RequirePermission resource="model" action="read">
        <ListPageLayout
          title="Fleet ROI"
          description="What each model has earned against what it cost to own — including the gear that only ever ships inside a kit."
        >
          <FleetRoi />
        </ListPageLayout>
      </RequirePermission>
    </FadeIn>
  );
}
