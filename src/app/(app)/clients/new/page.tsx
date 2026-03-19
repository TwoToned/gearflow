"use client";

import { ClientForm } from "@/components/clients/client-form";

export default function NewClientPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="t-title text-fg">New Client</h1>
        <p className="text-[13px] text-fg-3">
          Add a new client to your directory.
        </p>
      </div>
      <ClientForm />
    </div>
  );
}
