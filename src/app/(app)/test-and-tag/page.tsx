"use client";
// use-client: client navigation hooks (useRouter/useSearchParams) (R-8.1.1)

import { TestTagList } from "@/components/test-tag/test-tag-list";
import { RequirePermission } from "@/components/auth/require-permission";
import { FadeIn } from "@/components/ui/motion";

export default function TestAndTagPage() {
  return (
    <FadeIn>
      <RequirePermission resource="testTag" action="read">
        <TestTagList />
      </RequirePermission>
    </FadeIn>
  );
}
