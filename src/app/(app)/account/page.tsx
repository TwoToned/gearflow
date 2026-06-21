"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useProfile, refreshProfile } from "@/hooks/use-profile";
import { toast } from "sonner";
import { usePlatformBranding } from "@/lib/use-platform-name";

import { cn, focusRing } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PersonAvatar } from "@/components/ui/avatar";
import {
  Shield,
  KeyRound,
  Monitor,
  Smartphone,
  LogOut,
  Loader2,
  Fingerprint,
  Camera,
  Trash2,
  Plus,
  Pencil,
  Bell,
  ChevronRight,
  ShieldCheck,
  Check,
} from "lucide-react";
import { authClient, useSession } from "@/lib/auth-client";
import {
  updateProfile,
  getActiveSessions,
  revokeSession,
  revokeAllOtherSessions,
} from "@/server/user-profile";
import { FadeIn } from "@/components/ui/motion";

// ─── Local layout primitives ────────────────────────────────────────────────

/** A calm settings surface: card background, hard offset shadow, rounded panel. */
function SettingsCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--r-lg)] border border-line bg-card shadow-[var(--sh-card)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Section overline + optional one-line description. Calm by default (§5.2). */
function SectionLabel({
  label,
  description,
}: {
  label: string;
  description?: string;
}) {
  return (
    <div className="space-y-1">
      <p className="t-overline text-muted">{label}</p>
      {description && <p className="t-small text-faint">{description}</p>}
    </div>
  );
}

/** A friendly "fact" tile for the hero quick-facts strip. */
function HeroFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="t-overline text-faint">{label}</p>
      <p className="mt-0.5 truncate text-ui-text font-medium text-ink-2">{value}</p>
    </div>
  );
}

// ─── Device label parsing ────────────────────────────────────────────────────

/** Turn a raw user-agent into a friendly device + browser line. */
function describeDevice(ua: string | null | undefined): {
  label: string;
  isMobile: boolean;
} {
  if (!ua) return { label: "Unknown device", isMobile: false };
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);

  const os = /Windows/i.test(ua)
    ? "Windows"
    : /Macintosh|Mac OS X/i.test(ua)
      ? "macOS"
      : /iPhone|iPad|iPod/i.test(ua)
        ? "iOS"
        : /Android/i.test(ua)
          ? "Android"
          : /Linux/i.test(ua)
            ? "Linux"
            : null;

  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /OPR\/|Opera/i.test(ua)
      ? "Opera"
      : /Chrome\//i.test(ua)
        ? "Chrome"
        : /Firefox\//i.test(ua)
          ? "Firefox"
          : /Safari\//i.test(ua)
            ? "Safari"
            : null;

  const parts = [os, browser].filter(Boolean);
  return {
    label: parts.length ? parts.join(" · ") : "Unknown device",
    isMobile,
  };
}

export default function AccountPage() {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const { name: platformName } = usePlatformBranding();
  const [name, setName] = useState("");
  const [nameLoaded, setNameLoaded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Password change
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // 2FA
  const [show2FASetup, setShow2FASetup] = useState(false);
  const [totpURI, setTotpURI] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [verifyCode, setVerifyCode] = useState("");

  // Passkey rename
  const [renamePasskey, setRenamePasskey] = useState<{ id: string; name: string } | null>(null);
  const [deletePasskeyId, setDeletePasskeyId] = useState<string | null>(null);
  const [passkeyNewName, setPasskeyNewName] = useState("");

  const { data: profile } = useProfile(userId);

  const sessionsQuery = useServerQuery({
    queryKey: ["active-sessions"],
    queryFn: getActiveSessions,
  });

  const passkeysQuery = useServerQuery({
    queryKey: ["passkeys"],
    queryFn: async () => {
      const res = await authClient.passkey.listUserPasskeys();
      return res.data || [];
    },
  });

  // Set name once loaded
  if (profile && !nameLoaded) {
    setName(profile.name || "");
    setNameLoaded(true);
  }

  const updateProfileMutation = useServerMutation({
    mutationFn: () => updateProfile({ name }),
    onSuccess: () => {
      refreshProfile(userId);
      toast.success("Profile updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const uploadAvatarMutation = useServerMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/avatar", { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      refreshProfile(userId);
      toast.success("Profile picture updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const removeAvatarMutation = useServerMutation({
    mutationFn: async () => {
      const res = await fetch("/api/avatar", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to remove avatar");
    },
    onSuccess: () => {
      refreshProfile(userId);
      toast.success("Profile picture removed");
    },
    onError: (e) => toast.error(e.message),
  });

  const changePasswordMutation = useServerMutation({
    mutationFn: async () => {
      if (newPassword !== confirmPassword) throw new Error("Passwords don't match");
      if (newPassword.length < 8) throw new Error("Password must be at least 8 characters");
      const res = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: false,
      });
      if (res.error) throw new Error(res.error.message || "Failed to change password");
    },
    onSuccess: () => {
      toast.success("Password changed");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (e) => toast.error(e.message),
  });

  const revokeSessionMutation = useServerMutation({
    mutationFn: revokeSession,
    onSuccess: () => {
      sessionsQuery.refetch();
      toast.success("Session revoked");
    },
    onError: (e) => toast.error(e.message),
  });

  const revokeAllMutation = useServerMutation({
    mutationFn: revokeAllOtherSessions,
    onSuccess: () => {
      sessionsQuery.refetch();
      toast.success("All other sessions revoked");
    },
    onError: (e) => toast.error(e.message),
  });

  // 2FA setup
  const enable2FAMutation = useServerMutation({
    mutationFn: async () => {
      const res = await authClient.twoFactor.enable({
        password: currentPassword,
      });
      if (res.error) throw new Error(res.error.message || "Failed to enable 2FA");
      const uri = res.data?.totpURI || "";
      setTotpURI(uri);
      if (uri) {
        const QRCode = (await import("qrcode")).default;
        const dataUrl = await QRCode.toDataURL(uri, { width: 200, margin: 2 });
        setQrDataUrl(dataUrl);
      }
      return res.data;
    },
    onSuccess: () => {
      setShow2FASetup(true);
    },
    onError: (e) => toast.error(e.message),
  });

  const verify2FAMutation = useServerMutation({
    mutationFn: async () => {
      const res = await authClient.twoFactor.verifyTotp({
        code: verifyCode,
      });
      if (res.error) throw new Error(res.error.message || "Invalid code");
    },
    onSuccess: () => {
      refreshProfile(userId);
      toast.success("2FA enabled successfully");
      setShow2FASetup(false);
      setVerifyCode("");
      setCurrentPassword("");
      setTotpURI("");
      setQrDataUrl("");
    },
    onError: (e) => toast.error(e.message),
  });

  const disable2FAMutation = useServerMutation({
    mutationFn: async () => {
      const res = await authClient.twoFactor.disable({
        password: currentPassword,
      });
      if (res.error) throw new Error(res.error.message || "Failed to disable 2FA");
    },
    onSuccess: () => {
      refreshProfile(userId);
      toast.success("2FA disabled");
      setCurrentPassword("");
    },
    onError: (e) => toast.error(e.message),
  });

  // Passkey mutations
  const addPasskeyMutation = useServerMutation({
    mutationFn: async () => {
      const email = profile?.email || session?.user?.email || "unknown";
      const res = await authClient.passkey.addPasskey({
        name: `${platformName} - ${email}`,
      });
      if (res?.error) throw new Error(res.error.message || "Failed to add passkey");
    },
    onSuccess: () => {
      passkeysQuery.refetch();
      toast.success("Passkey registered");
    },
    onError: (e) => toast.error(e.message),
  });

  const deletePasskeyMutation = useServerMutation({
    mutationFn: async (id: string) => {
      const res = await authClient.passkey.deletePasskey({ id });
      if (res?.error) throw new Error(res.error.message || "Failed to delete passkey");
    },
    onSuccess: () => {
      passkeysQuery.refetch();
      toast.success("Passkey deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  const renamePasskeyMutation = useServerMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const res = await authClient.passkey.updatePasskey({ id, name });
      if (res?.error) throw new Error(res.error.message || "Failed to rename passkey");
    },
    onSuccess: () => {
      passkeysQuery.refetch();
      toast.success("Passkey renamed");
      setRenamePasskey(null);
    },
    onError: (e) => toast.error(e.message),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const passkeys = (passkeysQuery.data || []) as any[];

  const displayName = profile?.name || "Your account";
  const nameDirty = nameLoaded && name.trim() !== (profile?.name || "").trim();
  const memberSince = profile?.createdAt
    ? new Date(profile.createdAt).toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      })
    : null;
  const roleLabel = profile?.role === "admin" ? "Site admin" : "Member";

  return (
    <FadeIn className="mx-auto max-w-3xl space-y-8 pb-16">
      {/* ─── Hero ─────────────────────────────────────────────────────── */}
      <SettingsCard className="overflow-hidden">
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-6">
          <div className="group relative shrink-0 self-start sm:self-center">
            <PersonAvatar
              name={displayName}
              src={profile?.image || undefined}
              className="size-20 border-line shadow-[var(--sh-card)]"
            />
            <button
              type="button"
              aria-label="Change profile picture"
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "absolute inset-0 flex items-center justify-center rounded-full bg-scrim opacity-0 transition-opacity group-hover:opacity-100",
                focusRing,
              )}
            >
              {uploadAvatarMutation.isPending ? (
                <Loader2 className="size-5 animate-spin text-ink" />
              ) : (
                <Camera className="size-5 text-ink" />
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadAvatarMutation.mutate(file);
                e.target.value = "";
              }}
            />
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="t-title truncate text-ink">{displayName}</h1>
              {profile?.role === "admin" && (
                <Badge status="overbooked">Site admin</Badge>
              )}
            </div>
            {profile?.email && (
              <p className="truncate text-ui-text text-muted">{profile.email}</p>
            )}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1">
              <Button
                variant="line"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadAvatarMutation.isPending}
              >
                <Camera className="size-4" />
                {profile?.image ? "Change photo" : "Upload photo"}
              </Button>
              {profile?.image && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeAvatarMutation.mutate()}
                  disabled={removeAvatarMutation.isPending}
                >
                  <Trash2 className="size-4" />
                  Remove
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Quick facts strip */}
        <div className="grid grid-cols-2 gap-4 border-t border-line bg-paper-2/40 px-6 py-4 sm:grid-cols-3">
          <HeroFact label="Role" value={roleLabel} />
          {memberSince && <HeroFact label="Member since" value={memberSince} />}
          <HeroFact
            label="Two-factor"
            value={profile?.twoFactorEnabled ? "On" : "Off"}
          />
        </div>
      </SettingsCard>

      {/* ─── Profile ──────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionLabel
          label="Profile"
          description="How your name appears across the workspace."
        />
        <SettingsCard className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="displayName">Display name</Label>
              <Input
                id="displayName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
              />
            </div>
            <Button
              onClick={() => updateProfileMutation.mutate()}
              loading={updateProfileMutation.isPending}
              disabled={!nameDirty || !name.trim()}
              className="sm:w-auto"
            >
              <Check className="size-4" />
              Save changes
            </Button>
          </div>
        </SettingsCard>
      </section>

      {/* ─── Security ─────────────────────────────────────────────────── */}
      <section id="security" className="space-y-3">
        <SectionLabel
          label="Security"
          description="Your password, two-factor, and passkeys."
        />

        {/* Password */}
        <SettingsCard className="p-5 sm:p-6">
          <div className="space-y-1">
            <h3 className="t-heading text-ink">Password</h3>
            <p className="t-small text-faint">
              Use a strong password you don&apos;t reuse elsewhere.
            </p>
          </div>
          <div className="mt-4 space-y-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="currentPassword">Current password</Label>
              <Input
                id="currentPassword"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="grid gap-3.5 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="newPassword">New password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirmPassword">Confirm new password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end pt-1">
              <Button
                variant="line"
                onClick={() => changePasswordMutation.mutate()}
                loading={changePasswordMutation.isPending}
                disabled={!currentPassword || !newPassword}
              >
                <KeyRound className="size-4" />
                Change password
              </Button>
            </div>
          </div>
        </SettingsCard>

        {/* Two-factor */}
        <SettingsCard className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-[var(--r)] border border-line bg-paper-2">
                {profile?.twoFactorEnabled ? (
                  <ShieldCheck className="size-5 text-ok" />
                ) : (
                  <Shield className="size-5 text-muted" />
                )}
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="t-heading text-ink">Two-factor authentication</h3>
                  {profile?.twoFactorEnabled && <Badge status="ok">Enabled</Badge>}
                </div>
                <p className="t-small text-faint">
                  {profile?.twoFactorEnabled
                    ? "Your account is protected with an authenticator app."
                    : "Add a TOTP authenticator app for a second sign-in factor."}
                </p>
              </div>
            </div>
            <div className="shrink-0">
              {profile?.twoFactorEnabled ? (
                <Button
                  variant="line"
                  onClick={() => disable2FAMutation.mutate()}
                  loading={disable2FAMutation.isPending}
                  disabled={!currentPassword}
                >
                  Disable
                </Button>
              ) : (
                <Button
                  onClick={() => enable2FAMutation.mutate()}
                  loading={enable2FAMutation.isPending}
                  disabled={!currentPassword}
                >
                  <Shield className="size-4" />
                  Enable
                </Button>
              )}
            </div>
          </div>
          {!currentPassword && (
            <p className="mt-3 border-t border-line pt-3 t-small text-faint">
              Enter your current password above, then{" "}
              {profile?.twoFactorEnabled ? "disable" : "enable"} two-factor.
            </p>
          )}
        </SettingsCard>

        {/* Passkeys */}
        <SettingsCard className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h3 className="t-heading text-ink">Passkeys</h3>
              <p className="t-small text-faint">
                Sign in with Touch ID, Face ID, or a security key.
              </p>
            </div>
            <Button
              variant="line"
              size="sm"
              onClick={() => addPasskeyMutation.mutate()}
              loading={addPasskeyMutation.isPending}
            >
              <Plus className="size-4" />
              Add passkey
            </Button>
          </div>

          {passkeys.length === 0 ? (
            <div className="mt-4 rounded-[var(--r)] border border-dashed border-line bg-paper-2/40 px-4 py-6 text-center">
              <Fingerprint className="mx-auto size-6 text-faint" strokeWidth={1.5} />
              <p className="mt-2 t-small text-muted">No passkeys yet</p>
            </div>
          ) : (
            <ul className="mt-4 space-y-2">
              {passkeys.map((pk: { id: string; name?: string; createdAt?: string }) => (
                <li
                  key={pk.id}
                  className="flex items-center justify-between gap-3 rounded-[var(--r)] border border-line bg-paper-2/40 p-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Fingerprint className="size-4 shrink-0 text-muted" />
                    <div className="min-w-0">
                      <p className="truncate text-ui-text font-medium text-ink-2">
                        {pk.name || "Unnamed passkey"}
                      </p>
                      {pk.createdAt && (
                        <p className="t-micro text-faint">
                          Added {new Date(pk.createdAt).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9"
                      aria-label="Rename passkey"
                      onClick={() => {
                        setRenamePasskey({ id: pk.id, name: pk.name || "" });
                        setPasskeyNewName(pk.name || "");
                      }}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9"
                      aria-label="Delete passkey"
                      onClick={() => setDeletePasskeyId(pk.id)}
                    >
                      <Trash2 className="size-4 text-t-out" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SettingsCard>
      </section>

      {/* ─── Preferences ──────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionLabel
          label="Preferences"
          description="Tune what reaches your inbox."
        />
        <SettingsCard>
          <Link
            href="/account/notifications"
            className={cn(
              "flex items-center gap-3 rounded-[var(--r-lg)] p-5 transition-colors hover:bg-paper-2/40 sm:p-6",
              focusRing,
            )}
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[var(--r)] border border-line bg-paper-2">
              <Bell className="size-5 text-muted" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="t-heading text-ink">Notification preferences</p>
              <p className="t-small text-faint">
                Choose which in-app notifications also email you.
              </p>
            </div>
            <ChevronRight className="size-5 shrink-0 text-faint" />
          </Link>
        </SettingsCard>
      </section>

      {/* ─── Sessions ─────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionLabel
          label="Active sessions"
          description="Devices where you&rsquo;re currently signed in."
        />
        <SettingsCard className="p-5 sm:p-6">
          {sessionsQuery.isLoading ? (
            <div className="flex items-center gap-2 t-small text-faint">
              <Loader2 className="size-4 animate-spin" /> Loading sessions…
            </div>
          ) : (
            <ul className="space-y-2">
              {sessionsQuery.data?.map((s) => {
                const device = describeDevice(s.userAgent);
                const DeviceIcon = device.isMobile ? Smartphone : Monitor;
                return (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-3 rounded-[var(--r)] border border-line bg-paper-2/40 p-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <DeviceIcon className="size-4 shrink-0 text-muted" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-ui-text font-medium text-ink-2">
                            {device.label}
                          </span>
                          {s.isCurrent && <Badge status="ok">This device</Badge>}
                        </div>
                        <p className="t-micro text-faint">
                          {s.ipAddress || "Unknown IP"} ·{" "}
                          {new Date(s.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    {!s.isCurrent && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-9"
                        aria-label="Revoke session"
                        onClick={() => revokeSessionMutation.mutate(s.id)}
                      >
                        <LogOut className="size-4" />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-4 flex justify-end border-t border-line pt-4">
            <Button
              variant="line"
              size="sm"
              onClick={() => revokeAllMutation.mutate()}
              loading={revokeAllMutation.isPending}
            >
              <LogOut className="size-4" />
              Sign out all other sessions
            </Button>
          </div>
        </SettingsCard>
      </section>

      {/* ─── 2FA Setup Dialog ─────────────────────────────────────────── */}
      <Dialog open={show2FASetup} onOpenChange={setShow2FASetup}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set up two-factor authentication</DialogTitle>
            <DialogDescription>
              Scan this QR code with your authenticator app (Google Authenticator,
              Authy, etc.), then enter the 6-digit code to verify.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {totpURI && (
              <div className="space-y-3">
                {qrDataUrl && (
                  <div className="flex justify-center rounded-[var(--r)] bg-white p-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qrDataUrl} alt="2FA QR code" width={200} height={200} />
                  </div>
                )}
                <details className="text-center">
                  <summary
                    className={cn(
                      "cursor-pointer t-micro text-muted",
                      focusRing,
                    )}
                  >
                    Can&apos;t scan? Show manual entry key
                  </summary>
                  <p className="mt-2 break-all rounded-[var(--r)] bg-paper-2 p-2 font-mono t-micro text-ink-2">
                    {totpURI}
                  </p>
                </details>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="totpCode">Verification code</Label>
              <Input
                id="totpCode"
                placeholder="000000"
                inputMode="numeric"
                maxLength={6}
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ""))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="line" onClick={() => setShow2FASetup(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => verify2FAMutation.mutate()}
              loading={verify2FAMutation.isPending}
              disabled={verifyCode.length !== 6}
            >
              Verify &amp; enable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Rename Passkey Dialog ────────────────────────────────────── */}
      <Dialog
        open={!!renamePasskey}
        onOpenChange={(open) => !open && setRenamePasskey(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename passkey</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="passkeyName">Name</Label>
            <Input
              id="passkeyName"
              value={passkeyNewName}
              onChange={(e) => setPasskeyNewName(e.target.value)}
              placeholder="e.g. MacBook Touch ID"
            />
          </div>
          <DialogFooter>
            <Button variant="line" onClick={() => setRenamePasskey(null)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                renamePasskey &&
                renamePasskeyMutation.mutate({
                  id: renamePasskey.id,
                  name: passkeyNewName,
                })
              }
              loading={renamePasskeyMutation.isPending}
              disabled={!passkeyNewName.trim()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteDialog
        open={!!deletePasskeyId}
        onOpenChange={(open) => !open && setDeletePasskeyId(null)}
        title="Delete this passkey?"
        description="Removing this passkey signs out any device that relies on it for second-factor authentication. You'll still be able to sign in with your password or other factors."
        confirmLabel="Delete passkey"
        onConfirm={() => {
          if (deletePasskeyId) {
            deletePasskeyMutation.mutate(deletePasskeyId);
            setDeletePasskeyId(null);
          }
        }}
        pending={deletePasskeyMutation.isPending}
      />
    </FadeIn>
  );
}
