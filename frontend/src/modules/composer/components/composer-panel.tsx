"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Minus, Paperclip, Send, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { accountLabel, useAccounts } from "@/modules/accounts";
import {
  AttachmentChip,
  AttachmentList,
  MAX_ATTACHMENT_FILES,
  MAX_ATTACHMENT_TOTAL_BYTES,
  type Attachment,
} from "@/modules/attachments";
import { isApiError } from "@/infrastructure/api-client";
import { ResponsiveDialog } from "@/shared/components/layout/responsive-dialog";
import { Button } from "@/shared/components/ui/button";
import { NativeSelect } from "@/shared/components/ui/input";
import { Tooltip } from "@/shared/components/ui/tooltip";
import { useDebouncedCallback } from "@/shared/hooks/use-debounced-callback";
import { cn } from "@/shared/lib/cn";
import type { Address } from "@/shared/types/address";
import { createDraft, deleteDraft, sendEmail, updateDraft } from "../api";
import { isValidEmail } from "../lib/recipients";
import { useVisualViewportVars } from "../lib/use-visual-viewport";
import type { ComposeSession, DraftRequest } from "../types";
import { RecipientsInput } from "./recipients-input";
import { EditorToolbar, RichTextArea, useRichTextEditor } from "./rich-text-editor";

type SaveState = "idle" | "saving" | "saved" | "error";
const AUTOSAVE_DELAY_MS = 1500;

export function ComposerPanel({ session, onClose }: { session: ComposeSession; onClose: () => void }) {
  const t = useTranslations("composer");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const accounts = useAccounts();
  const activeAccounts = (accounts.data ?? []).filter((account) => account.status === "active");

  const panelRef = useRef<HTMLDivElement>(null);
  useVisualViewportVars(panelRef);
  const fileInputId = useId();
  const fromId = useId();
  const subjectId = useId();

  const [accountId, setAccountId] = useState(session.accountId);
  const [to, setTo] = useState<Address[]>(session.to);
  const [cc, setCc] = useState<Address[]>(session.cc);
  const [bcc, setBcc] = useState<Address[]>(session.bcc);
  const [showCc, setShowCc] = useState(session.cc.length > 0 || session.bcc.length > 0);
  const [subject, setSubject] = useState(session.subject);
  const [bodyEmpty, setBodyEmpty] = useState(!session.bodyHtml);
  const [files, setFiles] = useState<File[]>([]);
  const [forwarded, setForwarded] = useState<Attachment[]>(session.forwardAttachments);
  const [includeQuote, setIncludeQuote] = useState(Boolean(session.quotedHtml));
  const [showQuote, setShowQuote] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmNoSubject, setConfirmNoSubject] = useState(false);

  // A mailbox without a Drafts folder cannot store drafts: nothing is autosaved for it, and
  // closing asks before throwing the message away instead of failing to save it.
  const draftsSupported = accounts.data?.find((account) => account.id === accountId)?.capabilities.drafts ?? true;

  const htmlRef = useRef(session.bodyHtml);
  const draftIdRef = useRef(session.draftId);
  const dirtyRef = useRef(false);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const closedRef = useRef(false);

  const fullBody = useCallback(
    () => htmlRef.current + (includeQuote && session.quotedHtml ? session.quotedHtml : ""),
    [includeQuote, session.quotedHtml],
  );

  const hasContent =
    to.length + cc.length + bcc.length > 0 || subject.trim() !== "" || !bodyEmpty || files.length > 0;

  const buildRequest = useCallback(
    (): DraftRequest | null =>
      accountId
        ? {
            account_id: accountId,
            to,
            cc,
            bcc,
            subject: subject.trim(),
            body_html: fullBody(),
            mode: session.mode,
            ...(session.sourceMessageId ? { source_message_id: session.sourceMessageId } : {}),
          }
        : null,
    [accountId, to, cc, bcc, subject, fullBody, session.mode, session.sourceMessageId],
  );

  // Always-fresh snapshot for the debounced autosave.
  const latest = useRef({ buildRequest, hasContent, draftsSupported });
  useEffect(() => {
    latest.current = { buildRequest, hasContent, draftsSupported };
  });

  /** Saves are serialized so a slow first save can never create two drafts. */
  const saveDraft = useCallback((): Promise<void> => {
    chainRef.current = chainRef.current.then(async () => {
      const request = latest.current.buildRequest();
      if (!request || !latest.current.hasContent || !dirtyRef.current || closedRef.current) return;
      if (!latest.current.draftsSupported) return;
      dirtyRef.current = false;
      setSaveState("saving");
      try {
        if (draftIdRef.current) {
          await updateDraft(draftIdRef.current, request);
        } else {
          draftIdRef.current = (await createDraft(request)).id;
        }
        setSaveState("saved");
      } catch {
        dirtyRef.current = true;
        setSaveState("error");
      }
    });
    return chainRef.current;
  }, []);

  const autosave = useDebouncedCallback(() => void saveDraft(), AUTOSAVE_DELAY_MS);
  const touch = useCallback(() => {
    dirtyRef.current = true;
    setError(null);
    autosave.run();
  }, [autosave]);

  const editor = useRichTextEditor({
    initialHtml: session.bodyHtml,
    placeholder: t("bodyPlaceholder"),
    ariaLabel: t("body"),
    onChange: (html, isEmpty) => {
      htmlRef.current = isEmpty ? "" : html;
      setBodyEmpty(isEmpty);
      touch();
    },
  });

  useEffect(() => {
    if (editor && session.mode !== "new" && session.mode !== "forward") editor.commands.focus("start");
  }, [editor, session.mode]);

  // Warn before a reload/close that would lose changes not yet stored as a draft.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current && latest.current.hasContent) event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const refreshMail = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["threads"] });
    void queryClient.invalidateQueries({ queryKey: ["folders"] });
  }, [queryClient]);

  const close = useCallback(async () => {
    autosave.cancel();
    const hadChanges = dirtyRef.current && latest.current.hasContent && latest.current.buildRequest() !== null;
    if (hadChanges && !latest.current.draftsSupported) {
      setConfirmDiscard(true);
      return;
    }
    if (hadChanges) {
      await saveDraft();
      if (dirtyRef.current) {
        toast.error(t("draftSaveFailed"));
        return;
      }
      toast(t("draftSaved"));
    }
    if (draftIdRef.current) refreshMail();
    closedRef.current = true;
    onClose();
  }, [autosave, saveDraft, refreshMail, onClose, t, setConfirmDiscard]);

  const discard = useCallback(async () => {
    autosave.cancel();
    closedRef.current = true;
    await chainRef.current;
    if (draftIdRef.current) {
      try {
        await deleteDraft(draftIdRef.current);
        refreshMail();
      } catch {
        toast.error(t("discardFailed"));
      }
    }
    onClose();
  }, [autosave, refreshMail, onClose, t]);

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0) + forwarded.reduce((sum, item) => sum + item.size, 0);

  const addFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (picked.length === 0) return;
    if (files.length + forwarded.length + picked.length > MAX_ATTACHMENT_FILES) {
      toast.error(t("tooManyFiles", { max: MAX_ATTACHMENT_FILES }));
      return;
    }
    if (totalBytes + picked.reduce((sum, file) => sum + file.size, 0) > MAX_ATTACHMENT_TOTAL_BYTES) {
      toast.error(t("filesTooLarge", { max: 25 }));
      return;
    }
    setFiles((current) => [...current, ...picked]);
    touch();
  };

  const send = async (allowEmptySubject = false) => {
    if (sending) return;
    const recipients = [...to, ...cc, ...bcc];
    if (!accountId) return setError(t("errors.noAccount"));
    if (recipients.length === 0) return setError(t("errors.noRecipients"));
    if (recipients.some((address) => !isValidEmail(address.email))) return setError(t("errors.invalidRecipients"));
    if (!subject.trim() && !allowEmptySubject) return setConfirmNoSubject(true);
    const request = buildRequest();
    if (!request) return;

    setError(null);
    setSending(true);
    autosave.cancel();
    await chainRef.current;
    try {
      await sendEmail(
        {
          ...request,
          ...(draftIdRef.current ? { draft_id: draftIdRef.current } : {}),
          ...(forwarded.length > 0 ? { forward_attachment_ids: forwarded.map((item) => item.id) } : {}),
        },
        files,
        session.key,
      );
      closedRef.current = true;
      dirtyRef.current = false;
      toast.success(t("sent"));
      refreshMail();
      onClose();
    } catch (cause) {
      setSending(false);
      const code = isApiError(cause) ? cause.code : "unknown";
      const known = ["payload_too_large", "provider_auth_required", "rate_limited", "provider_unavailable", "provider_rate_limited", "network_error"] as const;
      setError(t(`errors.send.${known.find((item) => item === code) ?? "unknown"}`));
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send();
    } else if (event.key === "Escape" && !event.defaultPrevented && !confirmDiscard && !confirmNoSubject) {
      event.stopPropagation();
      void close();
    }
  };

  const title = t(`title.${session.mode}`);
  const closeLabel = draftsSupported ? t("close") : tc("close");
  const saveLabel =
    saveState === "saving" ? t("saving") : saveState === "saved" ? t("saved") : saveState === "error" ? t("saveError") : "";

  const sendButton = (className?: string) => (
    <Button variant="primary" loading={sending} onClick={() => void send()} className={className}>
      <Send className="size-4" aria-hidden />
      {t("send")}
    </Button>
  );

  return (
    <>
      <div
        ref={panelRef}
        role="dialog"
        aria-label={title}
        onKeyDown={onKeyDown}
        className={cn(
          "fixed z-40 flex min-w-0 flex-col bg-surface-raised",
          // Phone: full screen, sized to the visual viewport so nothing hides behind the keyboard.
          "inset-x-0 top-[var(--vvt,0px)] h-[var(--vvh,100dvh)]",
          // Tablet and up: floating panel anchored bottom-right.
          "md:inset-x-auto md:top-auto md:right-6 md:bottom-0 md:w-[min(36rem,calc(100vw-6rem))] md:rounded-t-lg md:border md:border-b-0 md:border-border md:shadow-lg",
          minimized ? "md:h-12" : "md:h-[min(40rem,calc(100dvh-4rem))]",
        )}
      >
        <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-2 pt-safe md:h-12 md:pr-2 md:pl-4">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label={closeLabel} onClick={() => void close()}>
            <X />
          </Button>
          <button
            type="button"
            onClick={() => setMinimized((value) => !value)}
            tabIndex={-1}
            className="flex min-w-0 flex-1 items-baseline gap-2 text-left max-md:pointer-events-none"
          >
            <h2 className="min-w-0 truncate text-base font-semibold text-foreground md:text-sm">
              {minimized && subject.trim() ? subject : title}
            </h2>
            <span aria-live="polite" className="shrink-0 text-xs text-foreground-subtle">
              {saveLabel}
            </span>
          </button>
          {sendButton("md:hidden")}
          <div className="hidden items-center md:flex">
            <Tooltip label={minimized ? t("expand") : t("minimize")}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={minimized ? t("expand") : t("minimize")}
                onClick={() => setMinimized((value) => !value)}
              >
                {minimized ? <ChevronUp /> : <Minus />}
              </Button>
            </Tooltip>
            <Tooltip label={closeLabel}>
              <Button variant="ghost" size="icon" aria-label={closeLabel} onClick={() => void close()}>
                <X />
              </Button>
            </Tooltip>
          </div>
        </header>

        <div className={cn("flex min-h-0 flex-1 flex-col", minimized && "md:hidden")}>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
            {activeAccounts.length > 1 || !accountId ? (
              <div className="flex min-w-0 items-center gap-2 border-b border-border px-4 py-1.5">
                <label htmlFor={fromId} className="w-11 shrink-0 text-sm text-foreground-subtle">
                  {t("from")}
                </label>
                <NativeSelect
                  id={fromId}
                  value={accountId ?? ""}
                  onChange={(event) => {
                    setAccountId(event.target.value || null);
                    touch();
                  }}
                  className="min-w-0 flex-1 border-transparent bg-transparent px-0 hover:border-transparent"
                >
                  {!accountId ? <option value="">{t("chooseAccount")}</option> : null}
                  {activeAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.display_name ? `${accountLabel(account)} <${account.email_address}>` : account.email_address}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            ) : null}
            {!draftsSupported ? (
              <p role="note" className="border-b border-border bg-surface px-4 py-2 text-[13px] break-words text-foreground-muted">
                {t("draftsUnavailable")}
              </p>
            ) : null}

            <RecipientsInput
              label={t("to")}
              value={to}
              autoFocus={session.mode === "new" || session.mode === "forward"}
              onChange={(next) => {
                setTo(next);
                touch();
              }}
              removeLabel={(email) => t("removeRecipient", { email })}
              invalidLabel={t("invalidAddress")}
              trailing={
                <button
                  type="button"
                  aria-expanded={showCc}
                  onClick={() => setShowCc((value) => !value)}
                  className="inline-flex h-8 items-center gap-0.5 rounded-sm px-1.5 text-[13px] text-foreground-muted hover:text-foreground touch:h-10 touch:px-2"
                >
                  {t("ccBcc")}
                  <ChevronDown className={cn("size-3.5 transition-transform", showCc && "rotate-180")} aria-hidden />
                </button>
              }
            />
            {showCc ? (
              <>
                <RecipientsInput
                  label={t("cc")}
                  value={cc}
                  onChange={(next) => {
                    setCc(next);
                    touch();
                  }}
                  removeLabel={(email) => t("removeRecipient", { email })}
                  invalidLabel={t("invalidAddress")}
                />
                <RecipientsInput
                  label={t("bcc")}
                  value={bcc}
                  onChange={(next) => {
                    setBcc(next);
                    touch();
                  }}
                  removeLabel={(email) => t("removeRecipient", { email })}
                  invalidLabel={t("invalidAddress")}
                />
              </>
            ) : null}

            <div className="border-b border-border px-4">
              <label htmlFor={subjectId} className="sr-only">
                {t("subject")}
              </label>
              <input
                id={subjectId}
                value={subject}
                maxLength={998}
                placeholder={t("subject")}
                onChange={(event) => {
                  setSubject(event.target.value);
                  touch();
                }}
                className="h-11 w-full min-w-0 bg-transparent text-sm font-medium text-foreground outline-none placeholder:font-normal placeholder:text-foreground-subtle"
              />
            </div>

            <div className="px-4 py-3" onClick={() => editor?.isFocused || editor?.commands.focus()}>
              <RichTextArea editor={editor} />
            </div>

            {session.quotedHtml ? (
              <div className="mx-4 mb-3 rounded-md border border-border">
                <div className="flex min-w-0 items-center gap-2 px-3 py-1">
                  <button
                    type="button"
                    aria-expanded={showQuote}
                    disabled={!includeQuote}
                    onClick={() => setShowQuote((value) => !value)}
                    className="flex min-h-9 min-w-0 flex-1 items-center gap-1.5 text-left text-[13px] text-foreground-muted hover:text-foreground disabled:opacity-60 touch:min-h-11"
                  >
                    <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", showQuote && "rotate-180")} aria-hidden />
                    <span className="min-w-0 truncate">{includeQuote ? t("quotedIncluded") : t("quotedRemoved")}</span>
                  </button>
                  <Button
                    variant="link"
                    size="sm"
                    className="shrink-0 touch:min-h-11!"
                    onClick={() => {
                      setIncludeQuote((value) => !value);
                      setShowQuote(false);
                      touch();
                    }}
                  >
                    {includeQuote ? t("removeQuote") : t("restoreQuote")}
                  </Button>
                </div>
                {showQuote && includeQuote ? (
                  <iframe
                    title={t("quotedPreview")}
                    sandbox=""
                    srcDoc={`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: cid:"><body style="margin:12px;font:13px/1.5 system-ui,sans-serif;color:#5d5f6b;background:#fff;overflow-wrap:anywhere">${session.quotedHtml}</body>`}
                    className="block h-48 w-full rounded-b-md border-0 border-t border-border bg-white"
                  />
                ) : null}
              </div>
            ) : null}

            {files.length + forwarded.length > 0 ? (
              <div className="px-4 pb-3">
                <AttachmentList label={t("attachments")}>
                  {forwarded.map((attachment) => (
                    <li key={attachment.id}>
                      <AttachmentChip
                        filename={attachment.filename}
                        mimeType={attachment.mime_type}
                        size={attachment.size}
                        removeLabel={t("removeAttachment")}
                        onRemove={() => {
                          setForwarded((current) => current.filter((item) => item.id !== attachment.id));
                          touch();
                        }}
                      />
                    </li>
                  ))}
                  {files.map((file, index) => (
                    <li key={`${file.name}-${file.size}-${index}`}>
                      <AttachmentChip
                        filename={file.name}
                        mimeType={file.type || "application/octet-stream"}
                        size={file.size}
                        removeLabel={t("removeAttachment")}
                        onRemove={() => {
                          setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
                          touch();
                        }}
                      />
                    </li>
                  ))}
                </AttachmentList>
              </div>
            ) : null}
          </div>

          {error ? (
            <p role="alert" className="border-t border-border bg-danger-soft px-4 py-2 text-[13px] break-words text-danger">
              {error}
            </p>
          ) : null}

          <footer className="flex shrink-0 items-center gap-1 border-t border-border px-2 py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] md:px-3">
            {sendButton("mr-1 hidden md:inline-flex")}
            <EditorToolbar editor={editor} className="flex-1" />
            <input id={fileInputId} type="file" multiple hidden onChange={addFiles} />
            <Tooltip label={t("attach")}>
              <Button asChild variant="ghost" size="icon">
                <label
                  htmlFor={fileInputId}
                  role="button"
                  tabIndex={0}
                  aria-label={t("attach")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      document.getElementById(fileInputId)?.click();
                    }
                  }}
                >
                  <Paperclip />
                </label>
              </Button>
            </Tooltip>
            <Tooltip label={t("discard")}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("discard")}
                onClick={() => (hasContent || draftIdRef.current ? setConfirmDiscard(true) : void discard())}
              >
                <Trash2 />
              </Button>
            </Tooltip>
          </footer>
        </div>
      </div>

      <ResponsiveDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title={t("discardTitle")}
        description={t(draftsSupported ? "discardDescription" : "discardUnsavedDescription")}
        closeLabel={tc("close")}
        footer={
          <>
            <Button onClick={() => setConfirmDiscard(false)}>{t("keepEditing")}</Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmDiscard(false);
                void discard();
              }}
            >
              {t("discard")}
            </Button>
          </>
        }
      />
      <ResponsiveDialog
        open={confirmNoSubject}
        onOpenChange={setConfirmNoSubject}
        title={t("noSubjectTitle")}
        description={t("noSubjectDescription")}
        closeLabel={tc("close")}
        footer={
          <>
            <Button onClick={() => setConfirmNoSubject(false)}>{t("keepEditing")}</Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirmNoSubject(false);
                void send(true);
              }}
            >
              {t("sendAnyway")}
            </Button>
          </>
        }
      />
    </>
  );
}
