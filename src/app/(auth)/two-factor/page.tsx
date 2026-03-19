"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Shield, KeyRound } from "lucide-react";
import { FadeIn } from "@/components/ui/motion";

export default function TwoFactorPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [useBackupCode, setUseBackupCode] = useState(false);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (useBackupCode) {
        const res = await authClient.twoFactor.verifyBackupCode({
          code,
        });
        if (res.error) {
          toast.error(res.error.message || "Invalid backup code");
          return;
        }
      } else {
        const res = await authClient.twoFactor.verifyTotp({
          code,
        });
        if (res.error) {
          toast.error(res.error.message || "Invalid code");
          return;
        }
      }

      router.push("/dashboard");
    } catch {
      toast.error("Verification failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <FadeIn>
    <div className="rounded-lg bg-bg-surface p-6 surface-ring sm:p-8">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Shield className="h-5 w-5" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight">Two-Factor Authentication</h2>
        <p className="text-sm text-fg-3">
          {useBackupCode
            ? "Enter one of your backup codes"
            : "Enter the 6-digit code from your authenticator app"}
        </p>
      </div>
      <div>
        <form onSubmit={handleVerify} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="code">
              {useBackupCode ? "Backup Code" : "Verification Code"}
            </Label>
            <Input
              id="code"
              type="text"
              placeholder={useBackupCode ? "xxxxxxxx" : "000000"}
              value={code}
              onChange={(e) =>
                setCode(
                  useBackupCode
                    ? e.target.value
                    : e.target.value.replace(/\D/g, ""),
                )
              }
              maxLength={useBackupCode ? 20 : 6}
              autoComplete="one-time-code"
              autoFocus
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Verify
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full text-sm"
            onClick={() => {
              setUseBackupCode(!useBackupCode);
              setCode("");
            }}
          >
            <KeyRound className="mr-2 h-4 w-4" />
            {useBackupCode
              ? "Use authenticator code instead"
              : "Use a backup code instead"}
          </Button>
        </form>
      </div>
    </div>
    </FadeIn>
  );
}
