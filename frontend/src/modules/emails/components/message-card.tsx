"use client";

import { ChevronDown, Forward, ImageOff, MoreHorizontal, Pencil, Reply, ReplyAll } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { AttachmentChip, AttachmentList } from "@/modules/attachments";
import { useComposer } from "@/modules/composer";
import { ResponsiveMenu, type MenuItem } from "@/shared/components/layout/responsive-menu";
import { Avatar } from "@/shared/components/ui/avatar";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/cn";
import { addressLabel, type Address } from "@/shared/types/address";
import { formatFullDate, formatListDate, formatMessageDate } from "@/shared/utils/format";
import type { Message } from "../types";
import { EmailFrame } from "./email-frame";

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

export function MessageCard({
  message,
  defaultExpanded,
  alwaysShowImages,
}: {
  message: Message;
  defaultExpanded: boolean;
  alwaysShowImages: boolean;
}) {
  const t = useTranslations("reader");
  const locale = useLocale();
  const composer = useComposer();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showDetails, setShowDetails] = useState(false);
  const [imagesAllowed, setImagesAllowed] = useState(false);

  const sender = addressLabel(message.from);
  const recipients = [...message.to, ...message.cc];
  const recipientSummary = recipients.map(addressLabel).join(", ");
  const attachments = message.attachments.filter((attachment) => !attachment.is_inline);
  const allowImages = alwaysShowImages || imagesAllowed;

  const menu: MenuItem[] = [
    { key: "reply", label: t("reply"), icon: Reply, onSelect: () => composer.reply(message, "reply") },
    { key: "reply_all", label: t("replyAll"), icon: ReplyAll, onSelect: () => composer.reply(message, "reply_all") },
    { key: "forward", label: t("forward"), icon: Forward, onSelect: () => composer.reply(message, "forward") },
  ];

  if (!expanded) {
    return (
      <article className="border-b border-border last:border-b-0">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          aria-label={t("expandMessage", { sender })}
          className="flex min-h-14 w-full min-w-0 items-center gap-3 py-3 text-left hover:bg-muted/50"
        >
          <Avatar name={sender} className="size-8" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className={cn("min-w-0 truncate text-sm", message.is_read ? "text-foreground" : "font-semibold text-foreground")}>
                {sender}
              </span>
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
    <article className="border-b border-border py-4 last:border-b-0" aria-label={t("messageFrom", { sender })}>
      <header className="flex min-w-0 items-start gap-3">
        <Avatar name={sender} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-x-2">
            <span className="min-w-0 truncate text-sm font-semibold text-foreground">{sender}</span>
            {message.is_draft ? (
              <span className="rounded-sm bg-warning-soft px-1.5 py-0.5 text-xs font-medium text-warning">{t("draft")}</span>
            ) : null}
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
            className="group -my-1 flex max-w-full min-w-0 items-center gap-1 py-1 text-left text-[13px] text-foreground-muted hover:text-foreground touch:min-h-9"
          >
            <span className="min-w-0 truncate">
              {recipientSummary ? t("toRecipients", { recipients: recipientSummary }) : message.from.email}
            </span>
            <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", showDetails && "rotate-180")} aria-hidden />
            <span className="sr-only">{t("toggleDetails")}</span>
          </button>
        </div>
        {message.is_draft ? (
          <Button variant="soft" size="sm" onClick={() => composer.editDraft(message.id)}>
            <Pencil className="size-4" aria-hidden />
            {t("editDraft")}
          </Button>
        ) : (
          <ResponsiveMenu
            title={t("messageActions")}
            items={menu}
            trigger={
              <Button variant="ghost" size="icon" aria-label={t("messageActions")} className="-mr-2 shrink-0">
                <MoreHorizontal />
              </Button>
            }
          />
        )}
      </header>

      {showDetails ? (
        <dl className="mt-3 flex flex-col gap-1 rounded-md bg-surface p-3 text-[13px] text-foreground-muted">
          <AddressLine label={t("from")} addresses={[message.from]} />
          <AddressLine label={t("to")} addresses={message.to} />
          <AddressLine label={t("cc")} addresses={message.cc} />
          <AddressLine label={t("bcc")} addresses={message.bcc} />
          <AddressLine label={t("replyTo")} addresses={message.reply_to} />
        </dl>
      ) : null}

      {message.has_remote_images && !allowImages ? (
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-surface px-3 py-2 text-[13px] text-foreground-muted">
          <ImageOff className="size-4 shrink-0" aria-hidden />
          <span className="min-w-40 flex-1 break-words">{t("imagesBlocked")}</span>
          <Button variant="link" size="sm" onClick={() => setImagesAllowed(true)} className="touch:min-h-9!">
            {t("showImages")}
          </Button>
        </div>
      ) : null}

      <div className="mt-4 min-w-0 md:pl-12">
        {message.body_html ? (
          <EmailFrame html={message.body_html} allowRemoteImages={allowImages} title={t("messageFrom", { sender })} />
        ) : message.body_text ? (
          <pre className="font-sans text-[15px] leading-relaxed break-words whitespace-pre-wrap text-foreground">
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
    </article>
  );
}
