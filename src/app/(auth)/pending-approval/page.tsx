import Link from "next/link";
import { Clock } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function PendingApprovalPage() {
  return (
    <Card>
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
          <Clock className="h-6 w-6" />
        </div>
        <CardTitle className="text-xl">Pending Approval</CardTitle>
        <CardDescription>Your account is awaiting administrator review</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground text-center">
          You&apos;ve successfully authenticated, but an administrator needs to approve your
          access to this organization. You&apos;ll receive an email notification once your
          request has been reviewed.
        </p>
      </CardContent>
      <CardFooter className="justify-center">
        <Link
          href="/login"
          className="text-sm text-primary hover:underline"
        >
          Back to sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
