"use client";

import Link from "next/link";
import { ModelForm } from "@/components/assets/model-form";
import { FadeIn } from "@/components/ui/motion";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export default function NewModelPage() {
  return (
    <FadeIn>
      <div className="mx-auto max-w-3xl space-y-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/assets/models" />}>Models</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>New model</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div>
          <h1 className="font-display text-page-title font-extrabold tracking-tight text-ink">New equipment model</h1>
          <p className="mt-1 text-ui-text text-muted">
            Create a model template that assets will be based on.
          </p>
        </div>
        <ModelForm />
      </div>
    </FadeIn>
  );
}
