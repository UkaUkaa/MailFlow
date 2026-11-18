"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Maximize2, Minimize2, Paperclip, Send, Trash2, X } from "lucide-react";
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
import { SendLaterMenu } from "@/modules/outbox";
import { ResponsiveDialog } from "@/shared/components/layout/responsive-dialog";
import { Button } from "@/shared/components/ui/button";
import { NativeSelect } from "@/shared/components/ui/input";
import { Tooltip } from "@/shared/components/ui/tooltip";
import { useDebouncedCallback } from "@/shared/hooks/use-debounced-callback";
import { useMediaQuery } from "@/shared/hooks/use-media-query";
import { cn } from "@/shared/lib/cn";
import type { Address } from "@/shared/types/address";
import { createDraft, deleteDraft, sendEmail, updateDraft } from "../api";
import { isValidEmail } from "../lib/recipients";
import { useVisualViewportVars } from "../lib/use-visual-viewport";
import { sendErrorKey } from "../lib/send-errors";
import type { ComposeSession, DraftRequest, SendResult } from "../types";
import { RecipientsInput } from "./recipients-input";
import { EditorToolbar, RichTextArea, useRichTextEditor } from "./rich-text-editor";

type SaveState = "idle" | "saving" | "saved" | "error";
const AUTOSAVE_DELAY_MS = 1500;

/** Small bordered square button of the composer's window controls. */
const square = "md:size-7 md:rounded-sm md:border md:border-border-strong";

/**
 * The composer has three presentations of one form:
 * - phone: a full-screen sheet sized to the visual viewport;
 * - tablet and wider: a document-like page that takes over the list and reading panes (the
 *   navigation rail stays);
 * - replies and forwards on desktop (≥ 1024px): a panel docked at the bottom right of the
 *   reading pane, which can be expanded to the page and docked again.
 */
export function ComposerPanel({
  session,
  onClose,
  onSent,
}: {
  session: ComposeSession;
  onClose: () => void;
  /** Called after the server accepted the send, with the composer's state for a possible undo. */
  onSent: (result: SendResult, snapshot: ComposeSession) => void;
}) {
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

  // Docked vs. page is an interaction difference, so it is decided in script (the panel is
  // client-only); phone vs. page is plain CSS.
  const desktop = useMediaQuery("(min-width: 64rem)");
  const [expanded, setExpanded] = useState(false);
  const dockable = session.mode !== "new" && desktop;
  const docked = dockable && !expanded;

  const [accountId, setAccountId] = useState(session.accountId);
  const [to, setTo] = useState<Address[]>(session.to);
  const [cc, setCc] = useState<Address[]>(session.cc);
  const [bcc, setBcc] = useState<Address[]>(session.bcc);
  // One "To, Cc, Bcc" line until the recipients get focus (or there is a copy to show).
  const [recipientsOpen, setRecipientsOpen] = useState(session.cc.length > 0 || session.bcc.length > 0);
  const [subject, setSubject] = useState(session.subject);
  const [bodyEmpty, setBodyEmpty] = useState(!session.bodyHtml);
  const [files, setFiles] = useState<File[]>(session.files ?? []);
  const [forwarded, setForwarded] = useState<Attachment[]>(session.forwardAttachments);
  const [includeQuote, setIncludeQuote] = useState(Boolean(session.quotedHtml));
  const [showQuote, setShowQuote] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmNoSubject, setConfirmNoSubject] = useState(false);
  // The send-later picker is rendered through portals, but its keys still bubble to this panel.
  const [scheduleOpen, setScheduleOpen] = useState(false);
  /** The time chosen in "Send later" while the "no subject" question is open. */
  const pendingSendAt = useRef<Date | null>(null);

  // A mailbox without a Drafts folder cannot store drafts: nothing is autosaved for it, and
  // closing asks before throwing the message away instead of failing to save it.
  const draftsSupported = accounts.data?.find((account) => account.id === accountId)?.capabilities.drafts ?? true;

  const htmlRef = useRef(session.bodyHtml);
  const draftIdRef = useRef(session.draftId);
  const dirtyRef = useRef(Boolean(session.unsaved));
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

  const send = async (allowEmptySubject = false, sendAt: Date | null = null) => {
    if (sending) return;
    pendingSendAt.current = sendAt;
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
      const result = await sendEmail(
        {
          ...request,
          ...(draftIdRef.current ? { draft_id: draftIdRef.current } : {}),
          ...(forwarded.length > 0 ? { forward_attachment_ids: forwarded.map((item) => item.id) } : {}),
          ...(sendAt ? { send_at: sendAt.toISOString() } : {}),
        },
        files,
        session.key,
      );
      closedRef.current = true;
      dirtyRef.current = false;
      onClose();
      // Everything needed to put this composer back if the send is undone.
      onSent(result, {
        ...session,
        accountId,
        to,
        cc,
        bcc,
        subject,
        bodyHtml: htmlRef.current,
        quotedHtml: includeQuote ? session.quotedHtml : null,
        draftId: draftIdRef.current,
        forwardAttachments: forwarded,
        files,
      });
    } catch (cause) {
      setSending(false);
      setError(t(`errors.send.${sendErrorKey(cause)}`));
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !scheduleOpen) {
      event.preventDefault();
      void send();
    }
  };
  // Capture phase: the rich-text editor consumes Escape, so a bubbling handler never sees it
  // while the caret is in the message body.
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !event.defaultPrevented && !confirmDiscard && !confirmNoSubject && !scheduleOpen) {
      event.preventDefault();
      event.stopPropagation();
      void close();
    }
  };

  const title = t(`title.${session.mode}`);
  const closeLabel = draftsSupported ? t("close") : tc("close");
  const saveLabel =
    saveState === "saving" ? t("saving") : saveState === "saved" ? t("saved") : saveState === "error" ? t("saveError") : "";
  const sendShortcut = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ Enter" : "Ctrl Enter";
  const chooseFrom = activeAccounts.length > 1 || !accountId;

  // Split button: send now, or open the "Send later" choices from the adjoining half.
  const sendButton = (
    <div className="flex shrink-0 items-center gap-px">
      <Tooltip label={t("send")} shortcut={sendShortcut}>
        <Button variant="primary" size={docked ? "sm" : "md"} loading={sending} onClick={() => void send()} className="shrink-0 rounded-r-none">
          <Send className="size-4" aria-hidden />
          {t("send")}
        </Button>
      </Tooltip>
      <SendLaterMenu
        title={t("sendLater")}
        confirmLabel={t("scheduleSend")}
        onSelect={(sendAt) => void send(false, sendAt)}
        onOpenChange={setScheduleOpen}
        trigger={
          <Button
            variant="primary"
            size="icon"
            aria-label={t("scheduleLabel")}
            disabled={sending}
            className={cn("shrink-0 rounded-l-none", !docked && "h-9 w-8 touch:size-11")}
          >
            <ChevronDown />
          </Button>
        }
      />
    </div>
  );

  const closeButton = (
    <Tooltip label={closeLabel} shortcut="Esc">
      <Button variant="ghost" size="icon" aria-label={closeLabel} onClick={() => void close()} className={cn("shrink-0", square)}>
        <X />
      </Button>
    </Tooltip>
  );

  const attachButton = (className?: string) => (
    <Tooltip label={t("attach")}>
      <Button asChild variant="ghost" size="icon" className={className}>
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
  );

  const discardButton = (className?: string) => (
    <Tooltip label={t("discard")}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("discard")}
        className={className}
        onClick={() => (hasContent || draftIdRef.current ? setConfirmDiscard(true) : void discard())}
      >
        <Trash2 />
      </Button>
    </Tooltip>
  );

  const fromOptions = (
    <>
      {!accountId ? <option value="">{t("chooseAccount")}</option> : null}
      {activeAccounts.map((account) => (
        <option key={account.id} value={account.id}>
          {account.display_name ? `${accountLabel(account)} <${account.email_address}>` : account.email_address}
        </option>
      ))}
    </>
  );
  const onFromChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setAccountId(event.target.value || null);
    touch();
  };

  const subjectInput = (className: string) => (
    <>
      <label htmlFor={subjectId} className="sr-only">
        {t("subject")}
      </label>
      <input
        id={subjectId}
        value={subject}
        maxLength={998}
        placeholder={t("subject")}
        autoFocus={session.mode === "new"}
        onChange={(event) => {
          setSubject(event.target.value);
          touch();
        }}
        className={cn("w-full min-w-0 bg-transparent font-semibold text-foreground outline-none placeholder:text-foreground-subtle", className)}
      />
    </>
  );

  const recipient = { removeLabel: (email: string) => t("removeRecipient", { email }), invalidLabel: t("invalidAddress") };

  return (
    <>
      <div
        ref={panelRef}
        role="dialog"
        aria-label={title}
        data-layout={docked ? "docked" : "page"}
        onKeyDown={onKeyDown}
        onKeyDownCapture={onKeyDownCapture}
        className={cn(
          "fixed z-40 flex min-w-0 flex-col",
          docked
            ? "right-3 bottom-3 h-[380px] max-h-[calc(100dvh-5rem)] w-[520px] overflow-hidden rounded-lg border border-border bg-surface-raised shadow-lg animate-pop-in"
            : // Sized to the visual viewport so nothing hides behind an on-screen keyboard; from
              // `md` it starts after the navigation column instead of covering it.
              "inset-x-0 top-[var(--vvt,0px)] h-[var(--vvh,100dvh)] bg-background md:left-[var(--nav-offset)]",
        )}
      >
        {docked ? (
          <header className="flex h-12 shrink-0 items-center gap-2 pr-3 pl-4">
            <div className="min-w-0 flex-1">{subjectInput("h-8 text-sm text-ellipsis")}</div>
            <span aria-live="polite" className="shrink-0 text-xs text-foreground-subtle">
              {saveLabel}
            </span>
            <Tooltip label={t("expand")}>
              <Button variant="ghost" size="icon" aria-label={t("expand")} onClick={() => setExpanded(true)} className={square}>
                <Maximize2 />
              </Button>
            </Tooltip>
            {closeButton}
          </header>
        ) : (
          <header className="flex h-14 shrink-0 items-center gap-1 px-2 pt-safe md:gap-2 md:px-4">
            {closeButton}
            {dockable ? (
              <Tooltip label={t("dock")}>
                <Button variant="ghost" size="icon" aria-label={t("dock")} onClick={() => setExpanded(false)} className={square}>
                  <Minimize2 />
                </Button>
              </Tooltip>
            ) : null}
            <div className="flex min-w-0 flex-1 items-baseline gap-2 px-1">
              <h2 className="min-w-0 truncate text-base font-semibold text-foreground md:sr-only">{title}</h2>
              <span aria-live="polite" className="shrink-0 text-xs text-foreground-subtle">
                {saveLabel}
              </span>
            </div>
            {attachButton("max-md:hidden")}
            {discardButton("max-md:hidden")}
            {chooseFrom ? (
              <NativeSelect
                aria-label={t("from")}
                value={accountId ?? ""}
                onChange={onFromChange}
                className="w-auto max-w-[16rem] border-transparent bg-transparent text-foreground-muted hover:border-transparent max-md:hidden"
              >
                {fromOptions}
              </NativeSelect>
            ) : null}
            {sendButton}
          </header>
        )}

        <div className="scrollbar-thin min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
          <div className={cn("w-full min-w-0", docked ? "px-4 pb-3" : "px-4 pt-1 pb-4 md:max-w-[44rem] md:px-8 md:pt-6 lg:max-w-[750px] lg:pl-[78px]")}>
            {chooseFrom ? (
              <div className={cn("flex min-w-0 items-center gap-2", !docked && "md:hidden")}>
                <label htmlFor={fromId} className="w-11 shrink-0 text-sm text-foreground-subtle">
                  {t("from")}
                </label>
                <NativeSelect
                  id={fromId}
                  value={accountId ?? ""}
                  onChange={onFromChange}
                  className="min-w-0 flex-1 border-transparent bg-transparent px-0 hover:border-transparent"
                >
                  {fromOptions}
                </NativeSelect>
              </div>
            ) : null}
            {!draftsSupported ? (
              <p role="note" className="mb-2 rounded-md bg-muted px-3 py-2 text-[13px] break-words text-foreground-muted">
                {t("draftsUnavailable")}
              </p>
            ) : null}

            {docked ? null : <div className="pb-1">{subjectInput("h-12 text-lg md:h-14 md:text-[22px]")}</div>}

            <div onFocus={() => setRecipientsOpen(true)}>
              <RecipientsInput
                label={t("to")}
                value={to}
                hideLabel={!recipientsOpen && to.length === 0}
                placeholder={recipientsOpen ? undefined : t("recipientsPlaceholder")}
                autoFocus={session.mode === "forward"}
                onChange={(next) => {
                  setTo(next);
                  touch();
                }}
                {...recipient}
              />
              {recipientsOpen ? (
                <>
                  <RecipientsInput
                    label={t("cc")}
                    value={cc}
                    onChange={(next) => {
                      setCc(next);
                      touch();
                    }}
                    {...recipient}
                  />
                  <RecipientsInput
                    label={t("bcc")}
                    value={bcc}
                    onChange={(next) => {
                      setBcc(next);
                      touch();
                    }}
                    {...recipient}
                  />
                </>
              ) : null}
            </div>

            <div className="py-3" onClick={() => editor?.isFocused || editor?.commands.focus()}>
              <RichTextArea editor={editor} />
            </div>

            {session.quotedHtml ? (
              <div className="mb-3 rounded-md border border-border">
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
            ) : null}
          </div>
        </div>

        {error ? (
          <p role="alert" className="border-t border-border bg-danger-soft px-4 py-2 text-[13px] break-words text-danger">
            {error}
          </p>
        ) : null}

        {/*
          Formatting stays one tap away at every size: a selection-only toolbar would be
          unreachable on touch screens. On the docked panel the bar also carries the actions.
        */}
        <footer
          className={cn(
            "flex shrink-0 items-center gap-1 border-t border-border px-2 py-1.5",
            docked ? "pr-3" : "pb-[max(0.375rem,env(safe-area-inset-bottom))] md:px-6 lg:pl-[70px]",
          )}
        >
          <EditorToolbar editor={editor} className="flex-1" />
          <input id={fileInputId} type="file" multiple hidden onChange={addFiles} />
          {attachButton(docked ? undefined : "md:hidden")}
          {discardButton(docked ? undefined : "md:hidden")}
          {docked ? sendButton : null}
        </footer>
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
                void send(true, pendingSendAt.current);
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
