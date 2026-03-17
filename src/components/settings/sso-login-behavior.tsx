"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TriangleAlert } from "lucide-react";
import type { OrgSSOSettings } from "@/lib/sso-types";

interface Props {
  allowPasswordLogin: boolean;
  enforceSSO: boolean;
  ssoTestedSuccessfully: boolean;
  canUpdate: boolean;
  onUpdate: (updates: Partial<OrgSSOSettings>) => void;
}

export function SSOLoginBehaviorSection({
  allowPasswordLogin,
  enforceSSO,
  ssoTestedSuccessfully,
  canUpdate,
  onUpdate,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Allow password login</p>
          <p className="text-xs text-muted-foreground">
            Let users sign in with email and password in addition to SSO.
          </p>
        </div>
        <Switch
          checked={allowPasswordLogin}
          onCheckedChange={(checked) => onUpdate({ allowPasswordLogin: checked })}
          disabled={!canUpdate || enforceSSO}
        />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Enforce SSO</p>
          <p className="text-xs text-muted-foreground">
            Require all users to authenticate via SSO. Password and social logins will be disabled.
          </p>
          {!ssoTestedSuccessfully && (
            <div className="flex items-center gap-1.5 mt-1 text-xs text-amber-500">
              <TriangleAlert className="h-3.5 w-3.5" />
              <span>Complete a successful SSO test login before enabling enforcement.</span>
            </div>
          )}
        </div>
        <Switch
          checked={enforceSSO}
          onCheckedChange={(checked) => {
            const updates: Partial<OrgSSOSettings> = { enforceSSO: checked };
            if (checked) {
              updates.allowPasswordLogin = false;
            }
            onUpdate(updates);
          }}
          disabled={!canUpdate || !ssoTestedSuccessfully}
        />
      </div>

      {enforceSSO && (
        <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
          <p className="text-xs text-amber-500">
            SSO enforcement is active. All users must sign in through your identity provider.
            Only organization owners can disable this setting.
          </p>
        </div>
      )}
    </div>
  );
}
