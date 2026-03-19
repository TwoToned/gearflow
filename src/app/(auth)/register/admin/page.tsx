"use client";

import { useState, useEffect, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { signUp } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Shield } from "lucide-react";
import { Suspense } from "react";
import { FadeIn } from "@/components/ui/motion";

function AdminRegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [verified, setVerified] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    async function verifyToken() {
      if (!token) {
        setChecking(false);
        return;
      }
      try {
        const res = await fetch(`/api/admin-register/verify?token=${token}`);
        if (res.ok) {
          setVerified(true);
        }
      } catch {
        // Invalid token
      }
      setChecking(false);
    }
    verifyToken();
  }, [token]);

  if (checking) {
    return (
      <div className="rounded-lg bg-bg-surface p-8 surface-ring text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-fg-3" />
      </div>
    );
  }

  if (!verified) {
    return (
      <div className="rounded-lg bg-bg-surface p-8 surface-ring text-center text-fg-3">
        Page not found.
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    try {
      const result = await signUp.email({ name, email, password });
      if (result.error) {
        toast.error(result.error.message || "Registration failed");
        return;
      }

      // Promote to site admin via API
      await fetch("/api/admin-register/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email }),
      });

      toast.success("Account created as Site Admin");
      router.push("/onboarding");
    } catch {
      toast.error("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg bg-bg-surface p-6 surface-ring sm:p-8">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-destructive text-destructive-foreground">
          <Shield className="h-5 w-5" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight">Site Admin Registration</h2>
        <p className="text-sm text-fg-3">
          Create a site administrator account.
        </p>
        <Badge className="mx-auto mt-2 bg-red-500/10 text-red-500 border-red-500/20">
          Site Admin Account
        </Badge>
      </div>
      <div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Full name</Label>
            <Input
              id="name"
              type="text"
              placeholder="Jane Smith"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="admin@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Min. 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Admin Account
          </Button>
        </form>
      </div>
    </div>
  );
}

export default function AdminRegisterPage() {
  return (
    <FadeIn>
    <Suspense
      fallback={
        <div className="rounded-lg bg-bg-surface p-8 surface-ring text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-fg-3" />
        </div>
      }
    >
      <AdminRegisterForm />
    </Suspense>
    </FadeIn>
  );
}
