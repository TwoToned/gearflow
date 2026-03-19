"use client";

import { KitForm } from "@/components/kits/kit-form";

export default function NewKitPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="t-title text-fg">New Kit</h1>
        <p className="text-[13px] text-fg-3">
          Create a new kit or case to group assets together.
        </p>
      </div>
      <KitForm />
    </div>
  );
}
