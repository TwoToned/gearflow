import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { MaintenanceForm } from "@/components/maintenance/maintenance-form";
import { FadeIn } from "@/components/ui/motion";

export default function NewMaintenancePage() {
  return (
    <FadeIn>
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm text-fg-3 mb-4">
          <Link href="/maintenance" className="hover:text-fg transition-colors">Maintenance</Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-fg">New Record</span>
        </div>
        <div>
          <h1 className="t-title text-fg">New Maintenance Record</h1>
          <p className="text-fg-3">
            Log a repair, inspection, or other maintenance work.
          </p>
        </div>
        <MaintenanceForm />
      </div>
    </FadeIn>
  );
}
