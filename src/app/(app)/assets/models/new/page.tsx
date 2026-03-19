"use client";

import { ModelForm } from "@/components/assets/model-form";

export default function NewModelPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="t-title text-fg">New Equipment Model</h1>
        <p className="text-muted-foreground">
          Create a model template that assets will be based on.
        </p>
      </div>
      <ModelForm />
    </div>
  );
}
