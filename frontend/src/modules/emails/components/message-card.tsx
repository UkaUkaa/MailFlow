"use client";

import { ChevronDown, Forward, ImageOff, MoreHorizontal, Pencil, Reply, ReplyAll, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { AttachmentChip, AttachmentList } from "@/modules/attachments";
import { useComposer, useDeleteDraft } from "@/modules/composer";
import { ResponsiveDialog } from "@/shared/components/layout/responsive-dialog";
import { ResponsiveMenu, type MenuItem } from "@/shared/components/layout/responsive-menu";
import { Avatar } from "@/shared/components/ui/avatar";
import { Button } from "@/shared/components/ui/button";
import { Tooltip } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/cn";
import { addressLabel, type Address } from "@/shared/types/address";
import { formatFullDate, formatListDate, formatMessageDate } from "@/shared/utils/format";
import type { Message } from "../types";
import { EmailFrame } from "./email-frame";

/** One message of a conversation: a bordered card one tonal step above the reading pane. */
const card = "min-w-0 rounded-lg border border-border bg-surface-raised";
/** Compact bordered pill button used on the draft card. */
const pill = "h-8 rounded-full px-3.5 touch:h-11";

function AddressLine({ label, addresses }: { label: string; addresses: Address[] }) {
  if (addresses.length === 0) return null;
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="w-12 shrink-0 text-foreground-subtle">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">
        {addresses.map((address, index) => (
          <span key={`${address.email}-${index}`}>
            {address.name ? `${address.name} <${address.email}>` : address.email}
            {index < addresses.length - 1 ? ", " : ""}
          </span>
        ))}
      </dd>
    </div>
  );
}

/** A stored draft inside a conversation: tag, recipient and the two things that can be done with it. */
function DraftCard({ message, onDeleted }: { message: Message; onDeleted?: () => void }) {
  const t = useTranslations("reader");
  const tc = useTranslations("common");
  const composer = useComposer();
  const deleteDraft = useDeleteDraft();
  const [confirming, setConfirming] = useState(false);
  const recipients = [...message.to, ...message.cc].map(addressLabel).join(", ");

  return (
    <article className={cn(card, "p-4 md:p-5")} aria-label={t("draft")}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-3">
        <span aria-hidden className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border-strong text-foreground-muted">
          <Pencil className="size-3.5" />
        </span>
        <span className="shrink-0 rounded-[4px] border border-border-strong px-1.5 text-[11px] leading-[18px] font-semibold tracking-wide text-foreground-muted uppercase">
          {t("draft")}
        </span>
        <span className="min-w-24 flex-1 truncate text-xs text-foreground-muted">
          {recipients ? t.rich("toRecipients", { recipients, r: (chunks) => <span className="text-accent">{chunks}</span> }) : t("noRecipients")}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" size="sm" className={cn(pill, "text-danger")} onClick={() => setConfirming(true)}>
            <Trash2 className="size-3.5" aria-hidden />
            {t("deleteDraft")}
          </Button>
          <Button variant="secondary" size="sm" className={cn(pill, "text-accent")} onClick={() => composer.editDraft(message.id)}>
            <Pencil className="size-3.5" aria-hidden />
            {t("editDraft")}
          </Button>
        </span>
      </div>
      <p className={cn("mt-3 line-clamp-2 text-sm break-words text-foreground-muted", !message.snippet && "italic")}>
        {message.snippet || t("emptyBody")}
      </p>
      <ResponsiveDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("deleteDraftTitle")}
        description={t("deleteDraftDescription")}
        closeLabel={tc("close")}
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>{tc("cancel")}</Button>
            <Button
              variant="danger"
              loading={deleteDraft.isPending}
              onClick={() =>
                deleteDraft.mutate(message.id, {
                  onSuccess: () => {
                    setConfirming(false);
                    toast(t("draftDeleted"));
                    onDeleted?.();
                  },
                  onError: () => toast.error(tc("genericError")),
                })
              }
            >
              {t("deleteDraft")}
            </Button>
          </>
        }
      />
    </article>
  );
}

export function MessageCard({
  message,
  defaultExpanded,
  alwaysShowImages,
  onDraftDeleted,
}: {
  message: Message;
  defaultExpanded: boolean;
  alwaysShowImages: boolean;
  /** Called after a draft card removed its draft (the conversation may now be empty). */
  onDraftDeleted?: () => void;
}) {
  const t = useTranslations("reader");
  const locale = useLocale();
  const composer = useComposer();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showDetails, setShowDetails] = useState(false);
  const [imagesAllowed, setImagesAllowed] = useState(false);

  if (message.is_draft) return <DraftCard message={message} onDeleted={onDraftDeleted} />;

  const sender = addressLabel(message.from);
  const recipients = [...message.to, ...message.cc];
  const recipientSummary = recipients.map(addressLabel).join(", ");
  const attachments = message.attachments.filter((attachment) => !attachment.is_inline);
  const allowImages = alwaysShowImages || imagesAllowed;
  const multiple = recipients.length > 1;

  const menu: MenuItem[] = [
    { key: "reply", label: t("reply"), icon: Reply, onSelect: () => composer.reply(message, "reply") },
    { key: "reply_all", label: t("replyAll"), icon: ReplyAll, onSelect: () => composer.reply(message, "reply_all") },
    { key: "forward", label: t("forward"), icon: Forward, onSelect: () => composer.reply(message, "forward") },
  ];

  if (!expanded) {
    return (
      <article className={card}>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          aria-label={t("expandMessage", { sender })}
          className="flex min-h-14 w-full min-w-0 items-center gap-2.5 rounded-lg px-4 py-3 text-left -outline-offset-2 hover:bg-muted/50 md:px-5"
        >
          <Avatar name={sender} colorKey={message.from.email} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="min-w-0 truncate text-sm font-semibold text-foreground">{sender}</span>
              <time dateTime={message.sent_at} className="ml-auto shrink-0 text-xs text-foreground-subtle">
                {formatListDate(message.sent_at, locale)}
              </time>
            </span>
            <span className="truncate text-[13px] text-foreground-muted">{message.snippet}</span>
          </span>
        </button>
      </article>
    );
  }

  return (
    <article className={cn(card, "p-4 md:p-5")} aria-label={t("messageFrom", { sender })}>
      <header className="flex min-w-0 items-start gap-2.5">
        <Avatar name={sender} colorKey={message.from.email} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-x-2">
            <span className="min-w-0 truncate text-sm font-semibold text-foreground">{sender}</span>
            <time
              dateTime={message.sent_at}
              title={formatFullDate(message.sent_at, locale)}
              className="ml-auto shrink-0 text-xs text-foreground-subtle"
            >
              {formatMessageDate(message.sent_at, locale)}
            </time>
          </div>
          <button
            type="button"
            onClick={() => setShowDetails((value) => !value)}
            aria-expanded={showDetails}
            className="-my-1 flex max-w-full min-w-0 items-center gap-1 py-1 text-left text-xs text-foreground-muted touch:min-h-9"
          >
            <span className="min-w-0 truncate">
              {recipientSummary
                ? t.rich("toRecipients", { recipients: recipientSummary, r: (chunks) => <span className="text-accent">{chunks}</span> })
                : message.from.email}
            </span>
            <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", showDetails && "rotate-180")} aria-hidden />
            <span className="sr-only">{t("toggleDetails")}</span>
          </button>
        </div>
        <ResponsiveMenu
          title={t("messageActions")}
          items={menu}
          trigger={
            <Button variant="ghost" size="icon" aria-label={t("messageActions")} className="-mt-1 -mr-2 shrink-0">
              <MoreHorizontal />
            </Button>
          }
        />
      </header>

      {showDetails ? (
        <dl className="mt-3 flex flex-col gap-1 rounded-md bg-muted p-3 text-[13px] text-foreground-muted">
          <AddressLine label={t("from")} addresses={[message.from]} />
          <AddressLine label={t("to")} addresses={message.to} />
          <AddressLine label={t("cc")} addresses={message.cc} />
          <AddressLine label={t("bcc")} addresses={message.bcc} />
          <AddressLine label={t("replyTo")} addresses={message.reply_to} />
        </dl>
      ) : null}

      {message.has_remote_images && !allowImages ? (
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-muted px-3 py-2 text-[13px] text-foreground-muted">
          <ImageOff className="size-4 shrink-0" aria-hidden />
          <span className="min-w-40 flex-1 break-words">{t("imagesBlocked")}</span>
          <Button variant="link" size="sm" onClick={() => setImagesAllowed(true)} className="touch:min-h-9!">
            {t("showImages")}
          </Button>
        </div>
      ) : null}

      <div className="mt-4 min-w-0">
        {message.body_html ? (
          <EmailFrame html={message.body_html} allowRemoteImages={allowImages} title={t("messageFrom", { sender })} />
        ) : message.body_text ? (
          <pre className="font-sans text-sm leading-[22px] break-words whitespace-pre-wrap text-foreground">
            {message.body_text}
          </pre>
        ) : (
          <p className="text-sm text-foreground-subtle italic">{t("emptyBody")}</p>
        )}

        {attachments.length > 0 ? (
          <div className="mt-4">
            <AttachmentList label={t("attachments", { count: attachments.length })}>
              {attachments.map((attachment) => (
                <li key={attachment.id}>
                  <AttachmentChip
                    filename={attachment.filename}
                    mimeType={attachment.mime_type}
                    size={attachment.size}
                    downloadId={attachment.id}
                    downloadLabel={t("download")}
                  />
                </li>
              ))}
            </AttachmentList>
          </div>
        ) : null}
      </div>

      {/* Phones reply from the bar fixed under the conversation, and from the menu above. */}
      <footer className="-mr-2 -mb-2 mt-3 hidden items-center justify-end gap-2 md:flex">
        <Tooltip label={t("reply")}>
          <Button variant="ghost" size="icon" aria-label={t("reply")} onClick={() => composer.reply(message, "reply")}>
            <Reply />
          </Button>
        </Tooltip>
        {multiple ? (
          <Tooltip label={t("replyAll")}>
            <Button variant="ghost" size="icon" aria-label={t("replyAll")} onClick={() => composer.reply(message, "reply_all")}>
              <ReplyAll />
            </Button>
          </Tooltip>
        ) : null}
        <Tooltip label={t("forward")}>
          <Button variant="ghost" size="icon" aria-label={t("forward")} onClick={() => composer.reply(message, "forward")}>
            <Forward />
          </Button>
        </Tooltip>
      </footer>
    </article>
  );
}
