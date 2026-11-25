"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { jobEditHref } from "@/lib/job-edit-url";

/** Opens the job edit sheet in place (`?edit=1`), keeping the current tab. */
export function useOpenJobEdit(): () => void {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return () => router.push(jobEditHref(pathname, searchParams));
}
