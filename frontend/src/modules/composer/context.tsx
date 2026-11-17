"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useAccounts } from "@/modules/accounts";
import type { Message } from "@/modules/emails";
import { addressLabel } from "@/shared/types/address";
import { formatFullDate } from "@/shared/utils/format";
import { fetchDraft } from "./api";
import { prefixSubject, quoteMessage, replyRecipients } from "./lib/prefill";
import type { ComposeMode, ComposeSession } from "./types";

// Tiptap and the composer UI are only downloaded when the user first composes.
const ComposerPanel = dynamic(() => import("./components/composer-panel").then((module) => module.ComposerPanel), {
  ssr: false,
});

interface ComposerApi {
  isOpen: boolean;
  compose: () => void;
  reply: (message: Message, mode: Exclude<ComposeMode, "new">) => void;
  editDraft: (draftId: string) => void;
}

const ComposerContext = createContext<ComposerApi | null>(null);

export function useComposer(): ComposerApi {
  const value = useContext(ComposerContext);
  if (!value) throw new Error("useComposer must be used inside ComposerProvider");
  return value;
}

function newKey(): string {
  return crypto.randomUUID();
}

export function ComposerProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("composer");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const accounts = useAccounts();
  const [session, setSession] = useState<ComposeSession | null>(null);

  const filterAccountId = searchParams.get("account");
  const accountList = accounts.data;

  const defaultAccountId = useCallback((): string | null => {
    const active = (accountList ?? []).filter((account) => account.status === "active");
    return active.find((account) => account.id === filterAccountId)?.id ?? active[0]?.id ?? null;
  }, [accountList, filterAccountId]);

  const compose = useCallback(() => {
    setSession({
      key: newKey(),
      mode: "new",
      accountId: defaultAccountId(),
      to: [],
      cc: [],
      bcc: [],
      subject: "",
      bodyHtml: "",
      quotedHtml: null,
      sourceMessageId: null,
      draftId: null,
      forwardAttachments: [],
    });
  }, [defaultAccountId]);

  const reply = useCallback(
    (message: Message, mode: Exclude<ComposeMode, "new">) => {
      const own = accountList?.find((account) => account.id === message.account_id)?.email_address ?? null;
      const recipients = replyRecipients(message, mode, own);
      const formattedDate = formatFullDate(message.sent_at, locale);
      setSession({
        key: newKey(),
        mode,
        accountId: message.account_id,
        to: recipients.to,
        cc: recipients.cc,
        bcc: [],
        subject: prefixSubject(message.subject, mode),
        bodyHtml: "",
        quotedHtml: quoteMessage(message, mode, {
          wroteLine: t("quote.wrote", { date: formattedDate, sender: addressLabel(message.from) }),
          forwardedHeader: t("quote.forwarded"),
          from: t("quote.from"),
          date: t("quote.date"),
          subject: t("quote.subject"),
          to: t("quote.to"),
          formattedDate,
        }),
        sourceMessageId: message.id,
        draftId: null,
        forwardAttachments: mode === "forward" ? message.attachments.filter((attachment) => !attachment.is_inline) : [],
      });
    },
    [accountList, locale, t],
  );

  const editDraft = useCallback(
    (draftId: string) => {
      fetchDraft(draftId)
        .then((draft) =>
          setSession({
            key: newKey(),
            mode: draft.mode,
            accountId: draft.account_id,
            to: draft.to,
            cc: draft.cc,
            bcc: draft.bcc,
            subject: draft.subject,
            bodyHtml: draft.body_html,
            quotedHtml: null,
            sourceMessageId: draft.source_message_id ?? null,
            draftId: draft.id,
            forwardAttachments: [],
          }),
        )
        .catch(() => toast.error(t("draftLoadFailed")));
    },
    [t],
  );

  const value = useMemo<ComposerApi>(
    () => ({ isOpen: session !== null, compose, reply, editDraft }),
    [session, compose, reply, editDraft],
  );

  return (
    <ComposerContext value={value}>
      {children}
      {session ? <ComposerPanel key={session.key} session={session} onClose={() => setSession(null)} /> : null}
    </ComposerContext>
  );
}
