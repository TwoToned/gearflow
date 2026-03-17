import {
  Globe, Building2, Cloud, Lock, Shield, ShieldCheck,
  Key, KeyRound, Fingerprint, ServerCog,
} from "lucide-react";

// ─── Brand SVG Icons ──────────────────────────────────────────────────────────

function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 21 21" fill="none">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function OktaIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path d="M12 0C5.389 0 0 5.389 0 12s5.389 12 12 12 12-5.389 12-12S18.611 0 12 0zm0 18c-3.314 0-6-2.686-6-6s2.686-6 6-6 6 2.686 6 6-2.686 6-6 6z" fill="#007DC1" />
    </svg>
  );
}

function Auth0Icon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path d="M21.98 7.448L19.62 0H4.347L2.02 7.448c-1.352 4.312.03 9.206 3.815 12.015L12.007 24l6.157-4.552c3.755-2.81 5.182-7.688 3.815-12.015l-6.16 4.58 2.343 7.45-6.157-4.597-6.158 4.58 2.358-7.433-6.188-4.55 7.63-.045L12.008 0l2.356 7.404 7.615.044z" fill="#EB5424" />
    </svg>
  );
}

function OneLoginIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="11" fill="none" stroke="#24292F" strokeWidth="2" />
      <circle cx="12" cy="12" r="4" fill="#24292F" />
    </svg>
  );
}

function PingIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path d="M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.18L20 8.5v7L12 19.82 4 15.5v-7L12 4.18z" fill="#B3282D" />
    </svg>
  );
}

function JumpCloudIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" fill="#37C98E" />
    </svg>
  );
}

function AzureADIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path d="M5.483 11.38L12.007 2l6.524 9.38L12.007 22 5.483 11.38z" fill="#0078D4" />
      <path d="M12.007 2l6.524 9.38L12.007 22V2z" fill="#50E6FF" opacity="0.7" />
    </svg>
  );
}

function SAMLIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      <circle cx="12" cy="16" r="1" />
    </svg>
  );
}

function AuthentikIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path d="M13.96 9.01h-.84V7.492h-1.234v3.663H5.722c.34.517.538.982.538 1.152 0 .46-1.445 3.059-3.197 3.059C.8 15.427-.745 12.8.372 10.855a3.062 3.062 0 0 1 2.691-1.606c1.04 0 1.971.915 2.557 1.755V6.577a3.773 3.773 0 0 1 3.77-3.769h10.84C22.31 2.808 24 4.5 24 6.577v10.845a3.773 3.773 0 0 1-3.77 3.769h-1.6V17.5h-7.64v3.692h-1.6a3.773 3.773 0 0 1-3.77-3.769v-3.41h12.114v-6.52h-1.59v.893h-.84v-.893H13.96v1.516Zm-9.956 1.845c-.662-.703-1.578-.544-2.209 0-2.105 2.054 1.338 5.553 3.302 1.447a5.395 5.395 0 0 0-1.093-1.447Z" fill="#FD4B2D" />
    </svg>
  );
}

function AWSSSOIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="#FF9900" />
      <path d="M8 12l2.5 2.5L16 9" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Icon Registry ────────────────────────────────────────────────────────────

export const PROVIDER_ICONS = [
  { id: "microsoft", label: "Microsoft / Entra", Icon: MicrosoftIcon, keywords: ["microsoft", "entra", "azure", "ad", "office", "365"] },
  { id: "azure-ad", label: "Azure AD", Icon: AzureADIcon, keywords: ["azure", "ad", "entra", "microsoft"] },
  { id: "google", label: "Google Workspace", Icon: GoogleIcon, keywords: ["google", "workspace", "gsuite", "gmail"] },
  { id: "okta", label: "Okta", Icon: OktaIcon, keywords: ["okta"] },
  { id: "auth0", label: "Auth0", Icon: Auth0Icon, keywords: ["auth0", "auth"] },
  { id: "onelogin", label: "OneLogin", Icon: OneLoginIcon, keywords: ["onelogin", "one"] },
  { id: "ping", label: "Ping Identity", Icon: PingIcon, keywords: ["ping", "identity", "pingone"] },
  { id: "jumpcloud", label: "JumpCloud", Icon: JumpCloudIcon, keywords: ["jumpcloud", "jump", "cloud"] },
  { id: "authentik", label: "Authentik", Icon: AuthentikIcon, keywords: ["authentik", "self-hosted", "open-source"] },
  { id: "aws-sso", label: "AWS SSO / IAM", Icon: AWSSSOIcon, keywords: ["aws", "amazon", "iam", "sso"] },
  { id: "saml", label: "SAML (Generic)", Icon: SAMLIcon, keywords: ["saml", "generic"] },
  { id: "globe", label: "Globe", Icon: Globe, keywords: ["globe", "web", "generic", "custom"] },
  { id: "building", label: "Enterprise", Icon: Building2, keywords: ["building", "enterprise", "corporate"] },
  { id: "cloud", label: "Cloud", Icon: Cloud, keywords: ["cloud"] },
  { id: "lock", label: "Lock", Icon: Lock, keywords: ["lock", "secure"] },
  { id: "shield", label: "Shield", Icon: Shield, keywords: ["shield", "security"] },
  { id: "shield-check", label: "Shield Check", Icon: ShieldCheck, keywords: ["shield", "check", "verified"] },
  { id: "key", label: "Key", Icon: Key, keywords: ["key", "default"] },
  { id: "key-round", label: "Key Round", Icon: KeyRound, keywords: ["key", "round"] },
  { id: "fingerprint", label: "Fingerprint", Icon: Fingerprint, keywords: ["fingerprint", "biometric"] },
  { id: "server", label: "Server", Icon: ServerCog, keywords: ["server", "self-hosted", "custom"] },
] as const;

export function getIconComponent(iconId?: string) {
  const found = PROVIDER_ICONS.find((i) => i.id === iconId);
  return found?.Icon ?? Key;
}
