"use client";

import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import { useState } from "react";

interface Props {
  enabled: boolean;
  canUpdate: boolean;
  onToggle: (enabled: boolean) => void;
}

export function SSOStatusSection({ enabled, canUpdate, onToggle }: Props) {
  const [copied, setCopied] = useState(false);
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const loginUrl = `${baseUrl}/login`;

  const handleCopy = () => {
    navigator.clipboard.writeText(loginUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Enable SSO</p>
          <p className="text-sm text-muted-foreground">
            Allow members to sign in using your identity provider.
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          disabled={!canUpdate}
        />
      </div>

      {enabled && (
        <div className="rounded-md border p-3">
          <p className="text-xs font-medium text-muted-foreground mb-1">Organization Login URL</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-sm bg-muted px-2 py-1 rounded truncate">
              {loginUrl}
            </code>
            <Button variant="outline" size="sm" onClick={handleCopy}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Share this URL with your team for direct SSO access.
          </p>
        </div>
      )}
    </div>
  );
}
