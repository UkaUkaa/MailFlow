"use client";

import { Settings2, Sparkles, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState, type KeyboardEvent } from "react";
import { Link } from "@/infrastructure/i18n/navigation";
import { Button } from "@/shared/components/ui/button";
import { Textarea } from "@/shared/components/ui/input";
import { useAssistant, useDraftReply } from "../api";
import { assistantErrorKey, languageName, type AssistantErrorKey } from "../lib/errors";
import { ASSISTANT_INSTRUCTION_MAX } from "../types";

/**
 * "Write with AI" inside the reply composer: a short note in, a full reply out, written by the
 * AI service the user connected with their own key. The draft replaces the editor's text (undo
 * brings it back); nothing is sent.
 */
export function AiReplyBar({
  sourceMessageId,
  onDraft,
  onClose,
}: {
  sourceMessageId: string;
  onDraft: (bodyHtml: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("assistant.composer");
  const te = useTranslations("assistant.errors");
  const tp = useTranslations("assistant.settings.providers");
  const tc = useTranslations("common");
  const locale = useLocale();
  const inputId = useId();
  const assistant = useAssistant();
  const draft = useDraftReply();
  const [note, setNote] = useState("");
  const [language, setLanguage] = useState<string | null>(null);
  const [problem, setProblem] = useState<AssistantErrorKey | null>(null);
  const config = assistant.data;

  const write = () => {
    if (draft.isPending) return;
    setProblem(null);
    draft.mutate(
      { sourceMessageId, instruction: note.trim() },
      {
        onSuccess: (result) => {
          setLanguage(languageName(result.language, locale));
          onDraft(result.body_html);
        },
        onError: (error) => setProblem(assistantErrorKey(error)),
      },
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Keep the composer's own shortcuts (send, close) away from the note.
    event.stopPropagation();
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      write();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  const shell = "mb-3 flex min-w-0 flex-col gap-2 rounded-md border border-border bg-accent-soft/40 p-3";
  const header = (
    <div className="flex min-w-0 items-center gap-2">
      <Sparkles className="size-4 shrink-0 text-accent" aria-hidden />
      <label htmlFor={inputId} className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
        {t("title")}
      </label>
      {config?.configured && config.provider ? (
        <span className="max-w-[45%] shrink-0 truncate text-xs text-foreground-muted">{tp(config.provider)}</span>
      ) : null}
      <Button variant="ghost" size="icon" aria-label={tc("close")} onClick={onClose} className="-my-1 -mr-1">
        <X />
      </Button>
    </div>
  );

  if (config && !config.configured) {
    return (
      <div data-composer-own-keys className={shell}>
        {header}
        <p className="text-[13px] break-words text-foreground-muted">{t("setupExplanation")}</p>
        <div className="flex justify-end">
          <Button asChild size="sm" variant="primary">
            <Link href="/settings/assistant">
              <Settings2 aria-hidden />
              {t("setup")}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div data-composer-own-keys className={shell}>
      {header}
      <Textarea
        id={inputId}
        autoFocus
        rows={2}
        value={note}
        maxLength={ASSISTANT_INSTRUCTION_MAX}
        placeholder={t("placeholder")}
        disabled={draft.isPending || !config}
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={onKeyDown}
        className="min-h-16 resize-none bg-surface-raised text-[15px] md:text-sm"
      />
      {problem ? (
        <p role="alert" className="text-[13px] break-words text-danger">
          {te(problem)}
        </p>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        <p aria-live="polite" className="min-w-0 flex-1 truncate text-xs text-foreground-muted">
          {draft.isPending ? t("writing") : language ? t("writtenIn", { language }) : t("hint")}
        </p>
        <Button size="sm" variant="primary" loading={draft.isPending} disabled={!config} onClick={write}>
          <Sparkles aria-hidden />
          {language ? t("rewrite") : t("write")}
        </Button>
      </div>
    </div>
  );
}
