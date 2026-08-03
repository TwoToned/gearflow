"use client";
// use-client: interactive form (react-hook-form + client validation) (R-8.1.1)

import { useEffect, useState } from "react";
import { useForm, Controller, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Eye, EyeOff, CheckCircle2, XCircle, Unplug, Sparkles } from "lucide-react";

import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation, type ServerMutationResult } from "@/hooks/use-server-mutation";
import { getMiraSettings, saveMiraSettings, disconnectMiraOpenRouter } from "@/server/mira-settings";
import { miraSettingsSchema, DEFAULT_MIRA_MODEL, type MiraSettingsFormValues } from "@/lib/validations/mira-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { FormSection, SettingsCard } from "@/components/layout/page-layouts";
import { RequirePermission } from "@/components/auth/require-permission";

export default function MiraSettingsPage() {
  const [showKey, setShowKey] = useState(false);

  const { data: settings, isLoading, refetch } = useServerQuery({
    queryKey: ["mira-settings"],
    queryFn: () => getMiraSettings(),
  });

  const form = useForm<MiraSettingsFormValues>({
    resolver: zodResolver(miraSettingsSchema),
    defaultValues: { openRouterApiKey: "", model: DEFAULT_MIRA_MODEL, baseUrl: "", writeAccessEnabled: false },
  });

  // Re-seed the form when the settings doc loads/changes — the stored API key
  // itself is never sent back to the browser (src/server/mira-settings.ts),
  // only whether one is configured. baseUrl isn't a secret, so it DOES
  // round-trip normally.
  useEffect(() => {
    if (!settings) return;
    form.reset({ openRouterApiKey: "", model: settings.model || DEFAULT_MIRA_MODEL, baseUrl: settings.baseUrl, writeAccessEnabled: settings.writeAccessEnabled });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed only when the underlying doc changes
  }, [settings?.model, settings?.baseUrl, settings?.writeAccessEnabled]);

  const saveMutation = useServerMutation({
    mutationFn: (data: MiraSettingsFormValues) => saveMiraSettings(data),
    onSuccess: () => {
      toast.success("Mira settings saved");
      form.setValue("openRouterApiKey", "");
      setShowKey(false);
      void refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const disconnectMutation = useServerMutation({
    mutationFn: () => disconnectMiraOpenRouter(),
    onSuccess: () => {
      toast.success("Disconnected Mira's API key");
      void refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const hasApiKey = settings?.hasApiKey === true;
  const usingCustomBackend = !!settings?.baseUrl;

  return (
    <div className="space-y-8">
      <FormSection
        title="Mira AI Assistant"
        description="Give Mira real language-model reasoning: her own API key and model, brought by this org — OpenRouter by default, or any OpenAI-compatible backend of your own."
      >
        <SettingsCard>
          <div className="flex items-center gap-2">
            {hasApiKey ? (
              <Badge status="ok">
                <CheckCircle2 className="h-3.5 w-3.5" /> Connected{usingCustomBackend ? " — custom endpoint" : " — OpenRouter"}
              </Badge>
            ) : (
              <Badge status="neutral">
                <XCircle className="h-3.5 w-3.5" /> Not connected
              </Badge>
            )}
          </div>

          {!isLoading && (
            <MiraSettingsForm
              form={form}
              hasApiKey={hasApiKey}
              showKey={showKey}
              setShowKey={setShowKey}
              saveMutation={saveMutation}
              disconnectMutation={disconnectMutation}
            />
          )}
        </SettingsCard>
      </FormSection>
    </div>
  );
}

/** The form body — split out from the page so its several independent
 *  conditional bits (masked-key toggle, per-field errors, the disconnect
 *  button) score their own complexity instead of stacking onto the page's. */
function MiraSettingsForm({
  form,
  hasApiKey,
  showKey,
  setShowKey,
  saveMutation,
  disconnectMutation,
}: {
  form: UseFormReturn<MiraSettingsFormValues>;
  hasApiKey: boolean;
  showKey: boolean;
  setShowKey: (updater: (v: boolean) => boolean) => void;
  saveMutation: ServerMutationResult<unknown, MiraSettingsFormValues>;
  disconnectMutation: ServerMutationResult<unknown, void>;
}) {
  return (
    <form className="mt-4 space-y-5" onSubmit={form.handleSubmit((data) => saveMutation.mutate(data))}>
      <div className="space-y-2">
        <Label htmlFor="openRouterApiKey">API key</Label>
        <div className="flex items-center gap-2">
          <Input
            id="openRouterApiKey"
            type={showKey ? "text" : "password"}
            placeholder={hasApiKey ? "•••••••••••••••••••• (leave blank to keep the current key)" : "sk-or-v1-…"}
            {...form.register("openRouterApiKey")}
          />
          <Button type="button" variant="ghost" size="icon" aria-label={showKey ? "Hide key" : "Show key"} onClick={() => setShowKey((v) => !v)}>
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
        {form.formState.errors.openRouterApiKey && <p className="t-micro text-destructive">{form.formState.errors.openRouterApiKey.message}</p>}
        <p className="t-micro text-fg-3">
          Using OpenRouter (the default below)? Create a key at{" "}
          <a className="underline" href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">
            openrouter.ai/keys
          </a>
          . Using your own backend instead? Paste whatever key it expects. This org&apos;s own key pays for its own
          Mira usage — nothing is shared across orgs.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="baseUrl">Base URL (optional)</Label>
        <Input id="baseUrl" placeholder="https://openrouter.ai/api/v1 (default)" {...form.register("baseUrl")} />
        {form.formState.errors.baseUrl && <p className="t-micro text-destructive">{form.formState.errors.baseUrl.message}</p>}
        <p className="t-micro text-fg-3">
          Leave blank to use OpenRouter. Or point Mira at any OpenAI-compatible chat-completions endpoint you run or
          pay for instead — Azure OpenAI, a self-hosted vLLM/Ollama/LM Studio server, etc. Must implement{" "}
          <code className="rounded bg-paper-2 px-1 py-0.5 t-micro">POST {"{baseUrl}"}/chat/completions</code> with the
          same request/response shape as OpenAI&apos;s API.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="model">Model</Label>
        <Input id="model" placeholder={DEFAULT_MIRA_MODEL} {...form.register("model")} />
        {form.formState.errors.model && <p className="t-micro text-destructive">{form.formState.errors.model.message}</p>}
        <p className="t-micro text-fg-3">
          A model slug your backend understands and that supports tool calling — e.g.{" "}
          <code className="rounded bg-paper-2 px-1 py-0.5 t-micro">anthropic/claude-sonnet-4.5</code>,{" "}
          <code className="rounded bg-paper-2 px-1 py-0.5 t-micro">openai/gpt-5</code>, or{" "}
          <code className="rounded bg-paper-2 px-1 py-0.5 t-micro">google/gemini-2.5-pro</code> on OpenRouter, or
          whatever your own backend calls its deployment.
        </p>
      </div>

      <div className="flex items-start justify-between gap-4 rounded-[var(--r)] border border-border p-3">
        <div className="space-y-1">
          <Label htmlFor="writeAccessEnabled" className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" /> Let Mira make changes
          </Label>
          <p className="t-micro text-fg-3">
            Off: Mira can only read data and answer questions. On: Mira may also create/update projects, assets, crew
            assignments, etc. — always as the asking member, never with more access than their own role already
            grants, and every high-risk action (delete, financial void, warehouse dispatch, bulk changes) still stops
            and asks a human to confirm before it runs. Flipping this re-provisions every member&apos;s Mira key
            immediately.
          </p>
        </div>
        <Controller
          control={form.control}
          name="writeAccessEnabled"
          render={({ field }) => <Switch id="writeAccessEnabled" checked={field.value} onCheckedChange={field.onChange} />}
        />
      </div>

      <RequirePermission resource="orgSettings" action="update">
        <div className="flex items-center gap-2">
          <Button type="submit" loading={saveMutation.isPending}>
            Save
          </Button>
          {hasApiKey && (
            <Button type="button" variant="line" loading={disconnectMutation.isPending} onClick={() => disconnectMutation.mutate(undefined)}>
              <Unplug className="h-4 w-4" /> Disconnect
            </Button>
          )}
        </div>
      </RequirePermission>
    </form>
  );
}
