"use client";
// use-client: interactive — form state, file upload, live preview (R-8.1.1)

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RotateCcw, Upload, X, Image as ImageIcon } from "lucide-react";
import { AuthShell } from "../auth-playful";
import { WizardRail } from "@/components/ui/wizard-rail";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { AppImage } from "@/components/ui/app-image";
import { useOrganization, refreshOrganization } from "@/hooks/use-organization";
import { updateOrganization, getOrganization } from "@/server/settings";
import { getCountry } from "@/lib/countries";
import type { OrgSettings, OrgBranding } from "@/lib/org-settings-types";
import {
  DEFAULT_PRIMARY_COLOR as DEFAULT_PRIMARY,
  DEFAULT_ACCENT_COLOR as DEFAULT_ACCENT,
  DEFAULT_DOCUMENT_COLOR as DEFAULT_DOCUMENT,
} from "@/lib/branding-defaults";
import { TOTAL_STEPS } from "./wizard-steps";
import { capture, AnalyticsEvent, type SetupStepId } from "@/lib/analytics";

interface OrgRecord {
  name?: string;
  settings?: OrgSettings;
}

interface BrandingFields {
  logoUrl: string;
  iconUrl: string;
  primaryColor: string;
  accentColor: string;
  documentColor: string;
  documentLogoMode: "logo" | "icon" | "none";
}

/** Everything already stored for this org, as the form's flat fields —
 *  mirrors `BrandingSettings`' own defaults exactly, so a wizard save and a
 *  Settings-page save agree on what "unchanged" means. */
function fieldsFromOrg(org: OrgRecord): BrandingFields {
  const b = org.settings?.branding ?? {};
  return {
    logoUrl: b.logoUrl || "",
    iconUrl: b.iconUrl || "",
    primaryColor: b.primaryColor || DEFAULT_PRIMARY,
    accentColor: b.accentColor || DEFAULT_ACCENT,
    documentColor: b.documentColor || DEFAULT_DOCUMENT,
    documentLogoMode: b.documentLogoMode || "icon",
  };
}

/** The `OrgBranding` object to persist — starts from whatever `OrgBranding`
 *  is already stored (`existingBranding`) so a field this screen doesn't
 *  expose (e.g. `showOrgNameOnDocuments`, Settings-page-only) survives a
 *  wizard save untouched, rather than the wizard's smaller field set
 *  silently replacing the whole sub-object and erasing it. A field at its
 *  default value is then omitted rather than written, same convention
 *  `BrandingSettings.buildBranding` uses, so an org that never touches this
 *  screen keeps a branding-free settings blob rather than one full of
 *  redundant defaults. Undefined when nothing differs from default (nothing
 *  to save). */
function buildBranding(existingBranding: OrgBranding | undefined, fields: BrandingFields): OrgBranding | undefined {
  const branding: OrgBranding = {
    ...existingBranding,
    primaryColor: fields.primaryColor !== DEFAULT_PRIMARY ? fields.primaryColor : undefined,
    accentColor: fields.accentColor !== DEFAULT_ACCENT ? fields.accentColor : undefined,
    documentColor: fields.documentColor !== DEFAULT_DOCUMENT ? fields.documentColor : undefined,
    logoUrl: fields.logoUrl || undefined,
    iconUrl: fields.iconUrl || undefined,
    documentLogoMode: fields.documentLogoMode !== "icon" ? fields.documentLogoMode : undefined,
  };
  const hasAny = Object.values(branding).some((v) => v !== undefined);
  return hasAny ? branding : undefined;
}

/** The `OrgSettings` patch to send, merged onto whatever's already stored
 *  (D5 — no draft state, an ordinary settings write against the live org). */
function buildSettingsPatch(existing: OrgSettings, fields: BrandingFields): OrgSettings {
  return { ...existing, branding: buildBranding(existing.branding, fields) };
}

/** Performs the actual write + cache refresh, split out of `handleSave`
 *  purely to keep that function's own cyclomatic complexity under the
 *  R-3.6/complexity-ratchet ceiling (see the identical note on
 *  `step-operating.tsx`'s `saveOperatingDetails`).
 *
 *  Re-fetches the org fresh (`getOrganization()`, not the `org` prop) right
 *  before merging: this screen now chains directly after step 2 (C2) rather
 *  than ending the wizard, and step 2's own save triggers only a
 *  fire-and-forget `refreshOrganization` (the shared-resource hook's
 *  `refresh` returns void by design — see its doc comment) — so the
 *  `useOrganization` cache this component reads for display can still be
 *  the pre-step-2-write snapshot when the operator saves quickly. Building
 *  the merge base from a guaranteed-current read (`getOrganization` derives
 *  the org from the session, same as every other org-settings read) closes
 *  that race rather than risking silently reverting country/currency/tax/
 *  contact fields step 2 just persisted. */
async function saveBranding(orgId: string, org: OrgRecord | undefined, fields: BrandingFields): Promise<void> {
  const fresh = (await getOrganization()) as OrgRecord;
  await updateOrganization({
    name: fresh.name ?? org?.name ?? "",
    settings: buildSettingsPatch(fresh.settings ?? {}, fields),
  });
  refreshOrganization(orgId);
}

function saveErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

/** The header preview's contact fields, derived from whatever's already
 *  stored on the org (set in step 2, C2/#1099) — split out purely to keep
 *  `StepBranding`'s own cyclomatic complexity under the R-3.6/
 *  complexity-ratchet ceiling (optional chaining counts as a decision point
 *  in this repo's eslint config, same as `??`/`||`/ternaries — see the
 *  identical note on `step-operating.tsx`). */
function orgContactFields(org: OrgRecord | undefined) {
  const settings = org?.settings ?? {};
  const { address, phone, email, abn: businessNumber, country } = settings;
  const businessNumberLabel = getCountry(country ?? "")?.businessNumberLabel ?? "Business number";
  return { businessNumberLabel, businessNumber, address, phone, email };
}

async function uploadBrandingImage(
  file: File,
  setUploading: (v: boolean) => void,
  setUrl: (url: string) => void,
  label: string,
): Promise<void> {
  if (file.size > 5 * 1024 * 1024) {
    toast.error("Image must be under 5MB");
    return;
  }
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
    // Use the original URL (not the thumbnail) — needed for PDF embedding,
    // same reasoning as BrandingSettings' own upload flow.
    setUrl(uploaded.url);
    toast.success(`${label} uploaded`);
  } catch (e) {
    toast.error(saveErrorMessage(e));
  } finally {
    setUploading(false);
  }
}

/**
 * `/setup` step 3 — C3 (#1101), "your brand". Writes `branding` through the
 * SAME `updateOrganization` server action the Settings page's
 * `BrandingSettings` uses (D5), merged onto whatever's already stored.
 *
 * Light-only (D8): `branding.logoUrl`/`iconUrl` are read exclusively by the
 * PDF pipeline (`build-document-data.ts`, the `tt-*.ts` report templates),
 * which renders onto white paper — there is exactly one background to
 * design for, so no dark-mode variant exists or is asked for here. The
 * sidebar/login/favicon dark-surface marks come from a DIFFERENT,
 * platform-level field (`SiteSettings.platformLogo`) — out of scope.
 *
 * "The preview is the point" (#1101): `HeaderPreview` below is a live HTML/CSS
 * approximation of the real quote-header block, not a fresh mock. The actual
 * PDF pipeline draws that header via `gearflow-page-header.ts`'s `pdfRender()`
 * directly onto a pdf-lib `PDFPage` (canvas/PDF draw calls — not callable from
 * a browser DOM preview), and the react-pdf spike's `Header` component
 * (`src/lib/react-pdf/components/header.tsx`) renders `@react-pdf/renderer`
 * primitives, which also don't render to the DOM. Neither is reusable here,
 * so `HeaderPreview` mirrors the SAME field set and layout logic
 * (`PageHeaderConfig` in `src/lib/pdfme/types.ts`) as plain HTML — honest to
 * what actually prints, not aspirational.
 */
export function StepBranding({
  orgId,
  onDone,
  onStepOutcome,
}: {
  orgId: string;
  onDone: () => void;
  /** D4 (#1108) — purely additive analytics tally; doesn't affect `onDone`. */
  onStepOutcome: (outcome: "completed" | "skipped") => void;
}) {
  const { data: org, isLoading } = useOrganization(orgId) as {
    data: OrgRecord | undefined;
    isLoading: boolean;
  };

  useEffect(() => {
    capture(AnalyticsEvent.SetupStepViewed, { step: "branding" satisfies SetupStepId });
  }, []);

  const [logoUrl, setLogoUrl] = useState("");
  const [iconUrl, setIconUrl] = useState("");
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_PRIMARY);
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT);
  const [documentColor, setDocumentColor] = useState(DEFAULT_DOCUMENT);
  const [documentLogoMode, setDocumentLogoMode] = useState<"logo" | "icon" | "none">("icon");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // One-shot hydration, same rationale as StepOperating: this screen owns the
  // form state from here — a later background refetch of `org` must never
  // silently overwrite what the operator is typing.
  useEffect(() => {
    if (hydrated || !org) return;
    const fields = fieldsFromOrg(org);
    setLogoUrl(fields.logoUrl); // eslint-disable-line react-hooks/set-state-in-effect
    setIconUrl(fields.iconUrl);
    setPrimaryColor(fields.primaryColor);
    setAccentColor(fields.accentColor);
    setDocumentColor(fields.documentColor);
    setDocumentLogoMode(fields.documentLogoMode);
    setHydrated(true);
  }, [org, hydrated]);

  async function handleSave() {
    setSaving(true);
    try {
      await saveBranding(orgId, org, {
        logoUrl,
        iconUrl,
        primaryColor,
        accentColor,
        documentColor,
        documentLogoMode,
      });
      toast.success("Saved.");
      capture(AnalyticsEvent.SetupStepCompleted, { step: "branding" satisfies SetupStepId });
      onStepOutcome("completed");
      onDone();
    } catch (e) {
      toast.error(saveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const contact = orgContactFields(org);

  return (
    <AuthShell accent="setup" annotation="the paper is the proof.">
      <WizardRail step={3} total={TOTAL_STEPS} />
      <p className="t-annotation text-[13px] text-red">Step 3 of {TOTAL_STEPS} · Your brand</p>
      <h1 className="t-title mt-1 text-ink">What your quotes look like.</h1>
      <p className="mt-1 text-sm text-muted">
        This is the logo that prints on your documents — not the icon shown in the app itself.
      </p>

      {isLoading && !hydrated ? (
        <div className="flex justify-center py-10">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-line-2 border-t-red" />
        </div>
      ) : (
        <div className="mt-6 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <LogoUploadField
              label="Logo"
              description="Wide logo, shown above the header when 'Logo' mode is picked."
              url={logoUrl}
              uploading={uploadingLogo}
              onFile={(file) => uploadBrandingImage(file, setUploadingLogo, setLogoUrl, "Logo")}
              onRemove={() => setLogoUrl("")}
            />
            <LogoUploadField
              label="Icon"
              description="Square icon, shown inline next to your company name."
              url={iconUrl}
              uploading={uploadingIcon}
              onFile={(file) => uploadBrandingImage(file, setUploadingIcon, setIconUrl, "Icon")}
              onRemove={() => setIconUrl("")}
            />
          </div>

          <DocumentLogoModeField value={documentLogoMode} onChange={setDocumentLogoMode} />

          <div className="grid gap-3 sm:grid-cols-3">
            <ColorField label="Primary" value={primaryColor} onChange={setPrimaryColor} defaultValue={DEFAULT_PRIMARY} />
            <ColorField label="Accent" value={accentColor} onChange={setAccentColor} defaultValue={DEFAULT_ACCENT} />
            <ColorField
              label="Document"
              value={documentColor}
              onChange={setDocumentColor}
              defaultValue={DEFAULT_DOCUMENT}
            />
          </div>

          <HeaderPreview
            orgName={org?.name ?? "Your Company"}
            {...contact}
            logoUrl={logoUrl}
            iconUrl={iconUrl}
            documentColor={documentColor}
            documentLogoMode={documentLogoMode}
          />

          <div className="flex items-center justify-between gap-3 pt-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                capture(AnalyticsEvent.SetupStepSkipped, { step: "branding" satisfies SetupStepId });
                onStepOutcome("skipped");
                onDone();
              }}
              className="text-sm text-muted hover:text-ink disabled:opacity-50"
            >
              Skip for now
            </button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
              Save and continue
            </Button>
          </div>
        </div>
      )}
    </AuthShell>
  );
}

/** Logo/icon upload tile — split out purely to keep the main component's
 *  own complexity down. A plain `<input type="file">` rather than a
 *  detached DOM element (unlike `BrandingSettings`' `uploadImage`) so it's
 *  driveable from a test without simulating a synthetic click handler. */
function LogoUploadField({
  label,
  description,
  url,
  uploading,
  onFile,
  onRemove,
}: {
  label: string;
  description: string;
  url: string;
  uploading: boolean;
  onFile: (file: File) => void;
  onRemove: () => void;
}) {
  const inputId = `brand-${label.toLowerCase()}-file`;
  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>{label}</Label>
      <div className="flex items-center gap-3">
        <div className="relative flex h-16 w-24 items-center justify-center rounded-[var(--r)] border-2 border-dashed border-line-2 bg-elev">
          {url ? (
            <>
              <AppImage src={url} alt={label} fill sizes="96px" className="rounded-[var(--r)] object-contain p-1" />
              <button
                type="button"
                onClick={onRemove}
                aria-label={`Remove ${label.toLowerCase()}`}
                className="absolute -right-1.5 -top-1.5 rounded-full bg-red p-0.5 text-white shadow-sm"
              >
                <X className="h-3 w-3" />
              </button>
            </>
          ) : (
            <ImageIcon className="h-6 w-6 text-fg-3" aria-hidden />
          )}
        </div>
        <label htmlFor={inputId} className="cursor-pointer">
          <span className="inline-flex items-center gap-1.5 rounded-[var(--r)] border-2 border-line-2 px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-elev">
            <Upload className="h-3.5 w-3.5" aria-hidden />
            {uploading ? "Uploading..." : url ? "Replace" : "Upload"}
          </span>
          <input
            id={inputId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) onFile(file);
            }}
            className="sr-only"
          />
        </label>
      </div>
      <p className="text-xs text-fg-3">{description}</p>
    </div>
  );
}

function DocumentLogoModeField({
  value,
  onChange,
}: {
  value: "logo" | "icon" | "none";
  onChange: (mode: "logo" | "icon" | "none") => void;
}) {
  const options: { mode: "icon" | "logo" | "none"; label: string }[] = [
    { mode: "icon", label: "Icon, inline" },
    { mode: "logo", label: "Logo, above header" },
    { mode: "none", label: "None" },
  ];
  return (
    <fieldset className="space-y-2">
      <legend className="t-label text-ink">On your documents</legend>
      <div className="flex flex-wrap items-center gap-4">
        {options.map((o) => (
          <label key={o.mode} className="flex items-center gap-1.5 text-sm text-ink-2">
            <input
              type="radio"
              name="documentLogoMode"
              value={o.mode}
              checked={value === o.mode}
              onChange={() => onChange(o.mode)}
              className="accent-red"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Colour swatch + hex field — same validation as `BrandingSettings`'
 *  private `ColorPicker` (swatch input + free-text hex, reset-to-default
 *  when it differs). Duplicated rather than shared: both are small,
 *  single-file helpers by existing convention in this codebase. */
function ColorField({
  label,
  value,
  onChange,
  defaultValue,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  defaultValue: string;
}) {
  const inputId = `brand-color-${label.toLowerCase()}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={inputId} className="text-[11px]">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <input
          id={inputId}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-10 cursor-pointer rounded-[var(--r)] border-2 border-line-2 bg-transparent p-0.5"
        />
        <input
          type="text"
          aria-label={`${label} hex value`}
          value={value.toUpperCase()}
          onChange={(e) => {
            const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
            if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange(v.toLowerCase());
          }}
          onBlur={() => {
            if (!/^#[0-9a-fA-F]{6}$/.test(value)) onChange(defaultValue);
          }}
          maxLength={7}
          className="w-full min-w-0 border-b border-line-2 bg-transparent px-0 py-0.5 font-mono text-xs text-ink-2 focus:outline-none"
        />
        {value !== defaultValue && (
          <button
            type="button"
            onClick={() => onChange(defaultValue)}
            aria-label={`Reset ${label.toLowerCase()} to default`}
            className="text-fg-3 hover:text-ink"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function headerDetailLines(props: {
  businessNumberLabel: string;
  businessNumber?: string;
  address?: string;
  phone?: string;
  email?: string;
}): string[] {
  const lines: string[] = [];
  if (props.address) lines.push(props.address);
  if (props.phone) lines.push(props.phone);
  if (props.email) lines.push(props.email);
  if (props.businessNumber) lines.push(`${props.businessNumberLabel}: ${props.businessNumber}`);
  return lines;
}

/** A live HTML/CSS approximation of the real quote-header block — same
 *  field set + layout logic as `PageHeaderConfig`, not a fresh mock (see the
 *  "the preview is the point" doc comment on `StepBranding`). Sample doc
 *  title/number/date since this screen has no real project data yet. */
function HeaderPreview({
  orgName,
  businessNumberLabel,
  businessNumber,
  address,
  phone,
  email,
  logoUrl,
  iconUrl,
  documentColor,
  documentLogoMode,
}: {
  orgName: string;
  businessNumberLabel: string;
  businessNumber?: string;
  address?: string;
  phone?: string;
  email?: string;
  logoUrl: string;
  iconUrl: string;
  documentColor: string;
  documentLogoMode: "logo" | "icon" | "none";
}) {
  const detailLines = headerDetailLines({ businessNumberLabel, businessNumber, address, phone, email });
  const showLogo = documentLogoMode === "logo" && !!logoUrl;
  const showIcon = documentLogoMode === "icon" && !!iconUrl;
  const today = new Date().toLocaleDateString();

  return (
    <div className="rounded-[var(--r)] border-2 border-line-2 bg-white p-5" data-testid="header-preview">
      <p className="mb-3 text-[11px] uppercase tracking-wide text-fg-3">Preview — how your quote header prints</p>
      <div className="flex items-start justify-between gap-4">
        <div className={showIcon ? "flex items-center gap-2.5" : "flex flex-col items-start gap-1.5"}>
          {showLogo && (
            /* eslint-disable-next-line @next/next/no-img-element -- data:/blob: preview URLs, same reasoning as AppImage's own doc comment */
            <img src={logoUrl} alt="Logo" className="mb-1 max-h-12 max-w-[160px] object-contain" />
          )}
          {showIcon && (
            /* eslint-disable-next-line @next/next/no-img-element -- data:/blob: preview URLs, same reasoning as AppImage's own doc comment */
            <img src={iconUrl} alt="Icon" className="h-9 w-9 flex-none object-contain" />
          )}
          <div>
            <p className="text-sm font-bold" style={{ color: documentColor }}>
              {orgName}
            </p>
            {detailLines.map((line) => (
              <p key={line} className="text-[11px] text-fg-3">
                {line}
              </p>
            ))}
          </div>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold" style={{ color: documentColor }}>
            QUOTE
          </p>
          <p className="text-[11px] text-fg-3">Q-2024-0001</p>
          <p className="text-[11px] text-fg-3">{today}</p>
        </div>
      </div>
    </div>
  );
}
