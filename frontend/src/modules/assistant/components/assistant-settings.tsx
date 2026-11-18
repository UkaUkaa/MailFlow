"use client";

import { ExternalLink, KeyRound, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Choice, SettingsCard, SettingsPage, SettingsRow } from "@/modules/settings";
import { ResponsiveDialog } from "@/shared/components/layout/responsive-dialog";
import { Button } from "@/shared/components/ui/button";
import { Field } from "@/shared/components/ui/field";
import { Input, NativeSelect } from "@/shared/components/ui/input";
import { useAssistant, useChooseModel, useConnectAssistant, useDisconnectAssistant } from "../api";
import { assistantErrorKey } from "../lib/errors";
import { AI_PROVIDERS, API_KEY_MAX, PROVIDER_INFO, type AiProvider } from "../types";

/** Provider, key and "get a key" link; the key is checked with the provider before it is kept. */
function ConnectForm({ initialProvider, onDone, onCancel }: { initialProvider: AiProvider; onDone: () => void; onCancel?: () => void }) {
  const t = useTranslations("assistant.settings");
  const te = useTranslations("assistant.errors");
  const tc = useTranslations("common");
  const keyId = useId();
  const connect = useConnectAssistant();
  const [provider, setProvider] = useState<AiProvider>(initialProvider);
  const [key, setKey] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const info = PROVIDER_INFO[provider];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!key.trim()) {
      setProblem(t("keyRequired"));
      return;
    }
    setProblem(null);
    connect.mutate(
      { provider, api_key: key.trim() },
      {
        onSuccess: () => {
          setKey("");
          toast.success(t("connected", { provider: t(`providers.${provider}`) }));
          onDone();
        },
        onError: (error) => setProblem(te(assistantErrorKey(error))),
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-4 p-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-[13px] font-medium text-foreground">{t("provider")}</p>
        <Choice
          label={t("provider")}
          options={AI_PROVIDERS}
          value={provider}
          names={(option) => t(`providers.${option}`)}
          disabled={connect.isPending}
          onChange={(next) => {
            setProvider(next);
            setProblem(null);
          }}
        />
      </div>
      <Field
        label={t("key")}
        htmlFor={keyId}
        error={problem}
        hint={t("keyHint")}
        aside={
          <a
            href={info.keyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1 text-[13px] text-accent underline-offset-4 hover:underline md:min-h-0"
          >
            {t("getKey", { provider: t(`providers.${provider}`) })}
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        }
      >
        <Input
          id={keyId}
          type="password"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="off"
          maxLength={API_KEY_MAX}
          placeholder={info.keyPlaceholder}
          value={key}
          aria-invalid={problem ? true : undefined}
          disabled={connect.isPending}
          onChange={(event) => {
            setKey(event.target.value);
            setProblem(null);
          }}
        />
      </Field>
      <p className="text-xs break-words text-foreground-muted">{t("consent", { provider: t(`providers.${provider}`) })}</p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel ? <Button onClick={onCancel}>{tc("cancel")}</Button> : null}
        <Button type="submit" variant="primary" loading={connect.isPending}>
          {connect.isPending ? t("checking") : t("connect")}
        </Button>
      </div>
    </form>
  );
}

/** Settings → AI replies: connect the user's own OpenAI, Anthropic or Gemini key. */
export function AssistantSettings() {
  const t = useTranslations("assistant.settings");
  const te = useTranslations("assistant.errors");
  const tc = useTranslations("common");
  const modelId = useId();
  const assistant = useAssistant();
  const chooseModel = useChooseModel();
  const disconnect = useDisconnectAssistant();
  const [replacing, setReplacing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const config = assistant.data;
  const provider = config?.provider ?? null;

  return (
    <SettingsPage title={t("title")} description={t("description")}>
      {assistant.isError ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-border bg-surface-raised p-4">
          <p className="text-sm text-foreground-muted">{tc("loadFailedDescription")}</p>
          <Button size="sm" onClick={() => void assistant.refetch()}>
            {tc("retry")}
          </Button>
        </div>
      ) : !config ? (
        <p className="text-sm text-foreground-muted">{tc("loading")}</p>
      ) : config.configured && provider && !replacing ? (
        <SettingsCard>
          <SettingsRow icon={Sparkles} title={t(`providers.${provider}`)} description={t("keyEnding", { hint: config.key_hint ?? "" })}>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setReplacing(true)}>
                <KeyRound aria-hidden />
                {t("replace")}
              </Button>
              <Button size="sm" variant="danger-ghost" onClick={() => setConfirmRemove(true)}>
                <Trash2 aria-hidden />
                {t("remove")}
              </Button>
            </div>
          </SettingsRow>
          <SettingsRow title={t("model")} titleId={`${modelId}-label`} description={t("modelDescription")}>
            <NativeSelect
              id={modelId}
              aria-labelledby={`${modelId}-label`}
              value={config.model ?? ""}
              disabled={chooseModel.isPending}
              onChange={(event) => chooseModel.mutate(event.target.value, { onError: (error) => toast.error(te(assistantErrorKey(error))) })}
              className="w-full sm:w-64"
            >
              {config.models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </NativeSelect>
          </SettingsRow>
        </SettingsCard>
      ) : (
        <SettingsCard>
          <ConnectForm
            initialProvider={provider ?? "openai"}
            onDone={() => setReplacing(false)}
            onCancel={replacing ? () => setReplacing(false) : undefined}
          />
        </SettingsCard>
      )}

      <section className="flex min-w-0 gap-3 rounded-lg border border-border bg-surface-raised p-4">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0 flex-1 space-y-2 text-[13px] break-words text-foreground-muted">
          <p className="text-sm font-semibold text-foreground">{t("privacyTitle")}</p>
          <p>{t("privacyKey")}</p>
          <p>{t("privacySent")}</p>
          <p>{t("privacyReview")}</p>
        </div>
      </section>

      <ResponsiveDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={t("removeTitle")}
        description={t("removeDescription")}
        closeLabel={tc("close")}
        footer={
          <>
            <Button onClick={() => setConfirmRemove(false)}>{tc("cancel")}</Button>
            <Button
              variant="danger"
              loading={disconnect.isPending}
              onClick={() =>
                disconnect.mutate(undefined, {
                  onSuccess: () => {
                    setConfirmRemove(false);
                    toast(t("removed"));
                  },
                  onError: () => toast.error(tc("genericError")),
                })
              }
            >
              {t("remove")}
            </Button>
          </>
        }
      />
    </SettingsPage>
  );
}
