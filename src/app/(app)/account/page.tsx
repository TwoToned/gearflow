"use client";

import { useState, useRef, useEffect } from "react";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useProfile, refreshProfile } from "@/hooks/use-profile";
import { toast } from "sonner";
import { usePlatformBranding } from "@/lib/use-platform-name";

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
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  Shield,
  KeyRound,
  Monitor,
  LogOut,
  Loader2,
  Fingerprint,
  Camera,
  Trash2,
  Plus,
  Pencil,
  Link2,
} from "lucide-react";
import { authClient, useSession } from "@/lib/auth-client";
import {
  updateProfile,
  getActiveSessions,
  revokeSession,
  revokeAllOtherSessions,
} from "@/server/user-profile";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/page-layouts";
import { FadeIn } from "@/components/ui/motion";

export default function AccountPage() {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const { name: platformName } = usePlatformBranding();
  const [name, setName] = useState("");
  const [nameLoaded, setNameLoaded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Available social providers (from server config)
  const [socialProviders, setSocialProviders] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/auth/social-providers", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : { providers: [] })
      .then((d) => setSocialProviders(d.providers || []))
      .catch(() => setSocialProviders([]));
  }, []);

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

  // Social login
  const handleLinkSocial = async (provider: "google" | "microsoft") => {
    try {
      await authClient.linkSocial({
        provider,
        callbackURL: "/account",
      });
    } catch {
      toast.error("Failed to link account");
    }
  };


  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const passkeys = (passkeysQuery.data || []) as any[];

  return (
    <FadeIn className="space-y-8 max-w-2xl">
      <PageHeader
        title="Your Account"
        description={profile?.name ? `Signed in as ${profile.name}` : "Update your personal details, security preferences, and active sessions."}
      />

      {/* Profile */}
      <section>
        <SectionHeader label="Profile" />
        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-4">
            <div className="relative group">
              <UserAvatar
                user={{ name: profile?.name, image: profile?.image }}
                size="xl"
              />
              <button
                type="button"
                className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <Camera className="h-5 w-5 text-white" />
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
            <div className="flex-1">
              <p className="font-medium">{profile?.name}</p>
              <p className="text-sm text-fg-3">{profile?.email}</p>
              {profile?.role === "admin" && (
                <Badge className="mt-1 bg-red-500/10 text-red-500 border-red-500/20">
                  Site Admin
                </Badge>
              )}
              <div className="flex gap-2 mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadAvatarMutation.isPending}
                >
                  {uploadAvatarMutation.isPending ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <Camera className="mr-1 h-3 w-3" />
                  )}
                  {profile?.image ? "Change" : "Upload"} Photo
                </Button>
                {profile?.image && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeAvatarMutation.mutate()}
                    disabled={removeAvatarMutation.isPending}
                  >
                    <Trash2 className="mr-1 h-3 w-3" />
                    Remove
                  </Button>
                )}
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name</Label>
            <Input
              id="displayName"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => updateProfileMutation.mutate()}
              disabled={updateProfileMutation.isPending}
            >
              {updateProfileMutation.isPending ? "Saving..." : "Update Profile"}
            </Button>
          </div>
        </div>
      </section>

      {/* Security — Password */}
      <section id="security">
        <SectionHeader label="Security" />
        <div className="mt-4 space-y-6">
          {/* Password Change */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Change Password</h3>
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current Password</Label>
              <Input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="newPassword">New Password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm New Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => changePasswordMutation.mutate()}
              disabled={
                changePasswordMutation.isPending ||
                !currentPassword ||
                !newPassword
              }
            >
              {changePasswordMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="mr-2 h-4 w-4" />
              )}
              Change Password
            </Button>
          </div>
        </div>
      </section>

      {/* Two-Factor Authentication */}
      <section>
        <SectionHeader label="Two-Factor Authentication" />
        <div className="mt-4 space-y-4">
          {profile?.twoFactorEnabled ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-green-500/10 text-green-500 border-green-500/20">
                  Enabled
                </Badge>
                <span className="text-sm text-fg-3">
                  Your account is protected with 2FA.
                </span>
              </div>
              <Button
                variant="outline"
                onClick={() => disable2FAMutation.mutate()}
                disabled={disable2FAMutation.isPending || !currentPassword}
              >
                Disable 2FA
              </Button>
              <p className="text-xs text-fg-3">
                Enter your current password in the Security section above, then click Disable 2FA.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-fg-3">
                Add an extra layer of security to your account using a TOTP authenticator app.
              </p>
              <Button
                variant="outline"
                onClick={() => enable2FAMutation.mutate()}
                disabled={enable2FAMutation.isPending || !currentPassword}
              >
                {enable2FAMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Shield className="mr-2 h-4 w-4" />
                )}
                Enable 2FA
              </Button>
              <p className="text-xs text-fg-3">
                Enter your current password in the Security section above, then click Enable 2FA.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Passkeys */}
      <section>
        <SectionHeader label="Passkeys" />
        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-fg-3">
              Use Touch ID, Face ID, or a security key for passwordless sign-in.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => addPasskeyMutation.mutate()}
              disabled={addPasskeyMutation.isPending}
            >
              {addPasskeyMutation.isPending ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Plus className="mr-1 h-3 w-3" />
              )}
              Add Passkey
            </Button>
          </div>
          {passkeys.length === 0 ? (
            <p className="text-sm text-fg-3 italic">
              No passkeys registered.
            </p>
          ) : (
            <div className="space-y-2">
              {passkeys.map((pk: { id: string; name?: string; createdAt?: string }) => (
                <div
                  key={pk.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <Fingerprint className="h-4 w-4 text-fg-3" />
                      <span className="text-sm font-medium">
                        {pk.name || "Unnamed Passkey"}
                      </span>
                    </div>
                    {pk.createdAt && (
                      <p className="text-xs text-fg-3 mt-0.5">
                        Added {new Date(pk.createdAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => {
                        setRenamePasskey({ id: pk.id, name: pk.name || "" });
                        setPasskeyNewName(pk.name || "");
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setDeletePasskeyId(pk.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Connected Accounts — only show if any social providers are enabled */}
      {socialProviders.length > 0 && (
        <section>
          <SectionHeader label="Connected Accounts" />
          <div className="mt-4 space-y-4">
            <p className="text-sm text-fg-3">
              Link social accounts for easier sign-in.
            </p>
            <div className="space-y-2">
              {socialProviders.includes("google") && (
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="flex items-center gap-3">
                    <svg className="h-5 w-5" viewBox="0 0 24 24">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                    <span className="text-sm">Google</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleLinkSocial("google")}
                  >
                    <Link2 className="mr-1 h-3 w-3" />
                    Connect
                  </Button>
                </div>
              )}
              {socialProviders.includes("microsoft") && (
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="flex items-center gap-3">
                    <svg className="h-5 w-5" viewBox="0 0 21 21">
                      <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                      <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                      <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                      <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
                    </svg>
                    <span className="text-sm">Microsoft</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleLinkSocial("microsoft")}
                  >
                    <Link2 className="mr-1 h-3 w-3" />
                    Connect
                  </Button>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Active Sessions */}
      <section>
        <SectionHeader label="Active Sessions" />
        <div className="mt-4 space-y-4">
          <p className="t-body text-fg-3">
            Devices where you&apos;re currently logged in.
          </p>
          {sessionsQuery.data?.map(
            (s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-md border p-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Monitor className="h-4 w-4 text-fg-3" />
                    <span className="text-sm font-medium">
                      {s.userAgent
                        ? s.userAgent.substring(0, 60) +
                          (s.userAgent.length > 60 ? "..." : "")
                        : "Unknown device"}
                    </span>
                    {s.isCurrent && (
                      <Badge className="bg-green-500/10 text-green-500 border-green-500/20 text-xs">
                        Current
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-fg-3">
                    {s.ipAddress || "Unknown IP"} -{" "}
                    {new Date(s.createdAt).toLocaleString()}
                  </div>
                </div>
                {!s.isCurrent && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => revokeSessionMutation.mutate(s.id)}
                  >
                    <LogOut className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ),
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => revokeAllMutation.mutate()}
            disabled={revokeAllMutation.isPending}
          >
            Sign out all other sessions
          </Button>
        </div>
      </section>

      {/* 2FA Setup Dialog */}
      <Dialog open={show2FASetup} onOpenChange={setShow2FASetup}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Up Two-Factor Authentication</DialogTitle>
            <DialogDescription>
              Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.),
              then enter the 6-digit code to verify.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {totpURI && (
              <div className="space-y-3">
                {qrDataUrl && (
                  <div className="flex justify-center p-4 bg-white rounded-md">
                    <img src={qrDataUrl} alt="2FA QR Code" width={200} height={200} />
                  </div>
                )}
                <details className="text-center">
                  <summary className="text-xs text-fg-3 cursor-pointer">
                    Can&apos;t scan? Show manual entry key
                  </summary>
                  <p className="mt-2 text-xs break-all font-mono bg-bg-inset p-2 rounded-md">
                    {totpURI}
                  </p>
                </details>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="totpCode">Verification Code</Label>
              <Input
                id="totpCode"
                placeholder="000000"
                maxLength={6}
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ""))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShow2FASetup(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => verify2FAMutation.mutate()}
              disabled={verify2FAMutation.isPending || verifyCode.length !== 6}
            >
              {verify2FAMutation.isPending ? "Verifying..." : "Verify & Enable"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Passkey Dialog */}
      <Dialog
        open={!!renamePasskey}
        onOpenChange={(open) => !open && setRenamePasskey(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Passkey</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="passkeyName">Name</Label>
            <Input
              id="passkeyName"
              value={passkeyNewName}
              onChange={(e) => setPasskeyNewName(e.target.value)}
              placeholder="e.g. MacBook Touch ID"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenamePasskey(null)}>
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
              disabled={renamePasskeyMutation.isPending || !passkeyNewName.trim()}
            >
              {renamePasskeyMutation.isPending ? "Saving..." : "Save"}
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
