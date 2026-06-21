"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { RotateCcw, Upload, X, Image as ImageIcon } from "lucide-react";

import { useServerMutation } from "@/hooks/use-server-mutation";
import { refreshOrganization } from "@/hooks/use-organization";
import { useActiveOrganization } from "@/lib/auth-client";
import { updateOrganization, type OrgSettings, type OrgBranding } from "@/server/settings";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface BrandingSettingsProps {
  orgName: string;
  settings: OrgSettings;
  onBrandingChange?: (branding: OrgBranding | undefined) => void;
}

const DEFAULT_PRIMARY = "#0d4f4f";
const DEFAULT_ACCENT = "#10b981";
const DEFAULT_DOCUMENT = "#0d4f4f";

export function BrandingSettings({ orgName, settings, onBrandingChange }: BrandingSettingsProps) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const branding = settings.branding || {};

  const [primaryColor, setPrimaryColor] = useState(branding.primaryColor || DEFAULT_PRIMARY);
  const [accentColor, setAccentColor] = useState(branding.accentColor || DEFAULT_ACCENT);
  const [documentColor, setDocumentColor] = useState(branding.documentColor || DEFAULT_DOCUMENT);

  // Sync from server when settings change
  useEffect(() => {
    const b = settings.branding || {};
    setPrimaryColor(b.primaryColor || DEFAULT_PRIMARY);
    setAccentColor(b.accentColor || DEFAULT_ACCENT);
    setDocumentColor(b.documentColor || DEFAULT_DOCUMENT);
  }, [settings.branding]);

  const [logoUrl, setLogoUrl] = useState(branding.logoUrl || "");
  const [iconUrl, setIconUrl] = useState(branding.iconUrl || "");
  const [documentLogoMode, setDocumentLogoMode] = useState<"logo" | "icon" | "none">(branding.documentLogoMode || "icon");
  const [showOrgName, setShowOrgName] = useState(branding.showOrgNameOnDocuments !== false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingIcon, setUploadingIcon] = useState(false);

  useEffect(() => {
    setLogoUrl(settings.branding?.logoUrl || "");
    setIconUrl(settings.branding?.iconUrl || "");
    setDocumentLogoMode(settings.branding?.documentLogoMode || "icon");
    setShowOrgName(settings.branding?.showOrgNameOnDocuments !== false);
  }, [settings.branding]);

  function buildBranding() {
    const newBranding: OrgBranding = {
      primaryColor: primaryColor !== DEFAULT_PRIMARY ? primaryColor : undefined,
      accentColor: accentColor !== DEFAULT_ACCENT ? accentColor : undefined,
      documentColor: documentColor !== DEFAULT_DOCUMENT ? documentColor : undefined,
      logoUrl: logoUrl || undefined,
      iconUrl: iconUrl || undefined,
      documentLogoMode: documentLogoMode !== "icon" ? documentLogoMode : undefined,
      showOrgNameOnDocuments: showOrgName === false ? false : undefined,
    };
    const hasBranding = newBranding.primaryColor || newBranding.accentColor || newBranding.documentColor || newBranding.logoUrl || newBranding.iconUrl || newBranding.documentLogoMode || newBranding.showOrgNameOnDocuments === false;
    return hasBranding ? newBranding : undefined;
  }

  async function uploadImage(type: "logo" | "icon") {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        toast.error("Image must be under 5MB");
        return;
      }

      const setUploading = type === "logo" ? setUploadingLogo : setUploadingIcon;
      setUploading(true);

      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("folder", "branding");
        fd.append("entityId", "org");

        const res = await fetch("/api/uploads", { method: "POST", body: fd });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Upload failed");
        }
        const uploaded = await res.json();
        // Use original URL (not thumbnail) — needed for PDF embedding
        const url = uploaded.url;

        if (type === "logo") setLogoUrl(url);
        else setIconUrl(url);

        toast.success(`${type === "logo" ? "Logo" : "Icon"} uploaded`);
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    };
    input.click();
  }

  const mutation = useServerMutation({
    mutationFn: () => {
      return updateOrganization({
        name: orgName,
        settings: {
          ...settings,
          branding: buildBranding(),
        },
      });
    },
    onSuccess: () => {
      onBrandingChange?.(buildBranding());
      refreshOrganization(orgId);
      toast.success("Branding saved");
    },
    onError: (e) => toast.error(e.message),
  });

  const hasChanges =
    primaryColor !== (branding.primaryColor || DEFAULT_PRIMARY) ||
    accentColor !== (branding.accentColor || DEFAULT_ACCENT) ||
    documentColor !== (branding.documentColor || DEFAULT_DOCUMENT) ||
    logoUrl !== (branding.logoUrl || "") ||
    iconUrl !== (branding.iconUrl || "") ||
    documentLogoMode !== (branding.documentLogoMode || "icon") ||
    showOrgName !== (branding.showOrgNameOnDocuments !== false);

  return (
    <div className="space-y-4">
      {/* Logo & Icon */}
      <div className="grid gap-4 sm:grid-cols-2">
        <LogoUpload
          label="Logo"
          description="Displayed in PDF headers and documents (recommended: 300×80px)"
          url={logoUrl}
          uploading={uploadingLogo}
          onUpload={() => uploadImage("logo")}
          onRemove={() => setLogoUrl("")}
        />
        <LogoUpload
          label="Icon"
          description="Square icon for compact display (recommended: 128×128px)"
          url={iconUrl}
          uploading={uploadingIcon}
          onUpload={() => uploadImage("icon")}
          onRemove={() => setIconUrl("")}
        />
      </div>

      {/* Document Logo Mode */}
      {(logoUrl || iconUrl) && (
        <div className="space-y-2">
          <Label>Document Branding</Label>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="documentLogoMode"
                value="icon"
                checked={documentLogoMode === "icon"}
                onChange={() => setDocumentLogoMode("icon")}
                className="accent-primary"
              />
              Icon (inline next to company name)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="documentLogoMode"
                value="logo"
                checked={documentLogoMode === "logo"}
                onChange={() => setDocumentLogoMode("logo")}
                className="accent-primary"
              />
              Logo (above header)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="documentLogoMode"
                value="none"
                checked={documentLogoMode === "none"}
                onChange={() => setDocumentLogoMode("none")}
                className="accent-primary"
              />
              None
            </label>
          </div>
          <p className="text-xs text-fg-3">
            Choose how your branding appears on PDF documents.
          </p>
        </div>
      )}

      {/* Show Org Name toggle */}
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showOrgName}
            onChange={(e) => setShowOrgName(e.target.checked)}
            className="accent-primary"
          />
          Show organisation name on documents
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <ColorPicker
          label="Primary Color"
          description="Buttons, links, sidebar accents"
          value={primaryColor}
          onChange={setPrimaryColor}
          defaultValue={DEFAULT_PRIMARY}
        />
        <ColorPicker
          label="Accent Color"
          description="Secondary highlights"
          value={accentColor}
          onChange={setAccentColor}
          defaultValue={DEFAULT_ACCENT}
        />
        <ColorPicker
          label="Document Color"
          description="PDF headings, borders, branding"
          value={documentColor}
          onChange={setDocumentColor}
          defaultValue={DEFAULT_DOCUMENT}
        />
      </div>

      {/* Preview */}
      <div className="flex items-center gap-3 rounded-md border p-3">
        <span className="text-xs text-fg-3">Preview:</span>
        <div className="flex items-center gap-2">
          <div
            className="h-6 w-6 rounded-md border"
            style={{ backgroundColor: primaryColor }}
            title="Primary"
          />
          <div
            className="h-6 w-6 rounded-md border"
            style={{ backgroundColor: accentColor }}
            title="Accent"
          />
          <div
            className="h-6 w-6 rounded-md border"
            style={{ backgroundColor: documentColor }}
            title="Document"
          />
        </div>
        <button
          className="rounded-md px-2 py-1 text-xs font-medium text-white"
          style={{ backgroundColor: primaryColor }}
        >
          Sample Button
        </button>
        <span
          className="text-sm font-semibold"
          style={{ color: documentColor }}
        >
          Document Heading
        </span>
      </div>

      <div className="flex justify-end">
        <Button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !hasChanges}
        >
          {mutation.isPending ? "Saving..." : "Save Branding"}
        </Button>
      </div>
    </div>
  );
}

function LogoUpload({
  label,
  description,
  url,
  uploading,
  onUpload,
  onRemove,
}: {
  label: string;
  description: string;
  url: string;
  uploading: boolean;
  onUpload: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        <div className="relative flex h-16 w-24 items-center justify-center rounded-md border border-dashed border-input bg-bg-inset/30">
          {url ? (
            <>
              <img
                src={url}
                alt={label}
                className="h-full w-full rounded-md object-contain p-1"
              />
              <button
                type="button"
                onClick={onRemove}
                className="absolute -right-1.5 -top-1.5 rounded-full bg-destructive p-0.5 text-destructive-foreground shadow-sm hover:bg-destructive/90"
              >
                <X className="h-3 w-3" />
              </button>
            </>
          ) : (
            <ImageIcon className="h-6 w-6 text-fg-3" />
          )}
        </div>
        <Button
          variant="line"
          size="sm"
          onClick={onUpload}
          disabled={uploading}
        >
          <Upload className="mr-1.5 h-3.5 w-3.5" />
          {uploading ? "Uploading..." : url ? "Replace" : "Upload"}
        </Button>
      </div>
      <p className="text-xs text-fg-3">{description}</p>
    </div>
  );
}

function ColorPicker({
  label,
  description,
  value,
  onChange,
  defaultValue,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (v: string) => void;
  defaultValue: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
        />
        <input
          type="text"
          value={value.toUpperCase()}
          onChange={(e) => {
            let v = e.target.value;
            if (!v.startsWith("#")) v = "#" + v;
            if (/^#[0-9a-fA-F]{0,6}$/.test(v)) {
              onChange(v.toLowerCase());
            }
          }}
          onBlur={() => {
            if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
              onChange(defaultValue);
            }
          }}
          className="w-20 font-mono text-sm bg-transparent border-b border-input px-0 py-0.5 text-fg-3 focus:text-fg focus:outline-none"
          maxLength={7}
        />
        {value !== defaultValue && (
          <button
            type="button"
            onClick={() => onChange(defaultValue)}
            className="ml-auto text-fg-3 hover:text-fg"
            title="Reset to default"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <p className="text-xs text-fg-3">{description}</p>
    </div>
  );
}
