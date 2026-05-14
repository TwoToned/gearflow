"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ModelForm } from "@/components/assets/model-form";
import { FadeIn } from "@/components/ui/motion";

export default function NewModelPage() {
  return (
    <FadeIn>
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center gap-2 text-sm text-fg-3 mb-4">
          <Link href="/assets" className="hover:text-fg transition-colors">Assets</Link>
          <ChevronRight className="h-3 w-3" />
          <Link href="/assets/models" className="hover:text-fg transition-colors">Models</Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-fg">New Model</span>
        </div>
        <div>
          <h1 className="t-title text-fg">New Equipment Model</h1>
          <p className="t-body text-fg-3">
            Create a model template that assets will be based on.
          </p>
        </div>
        <ModelForm />
      </div>
    </FadeIn>
  );
}
