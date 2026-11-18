"use client";

import { AlertCircle, Check, Mail, MoreHorizontal, Pencil, RefreshCw, Trash2, Unplug } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { usePathname, useRouter } from "@/infrastructure/i18n/navigation";
import { Skeleton } from "@/shared/components/feedback/skeleton";
import { EmptyState, ErrorState } from "@/shared/components/feedback/states";
import { ResponsiveDialog } from "@/shared/components/layout/responsive-dialog";
import { ResponsiveMenu, type MenuItem } from "@/shared/components/layout/responsive-menu";
import { Button } from "@/shared/components/ui/button";
import { Field } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { DEFAULT_ACCOUNT_COLOR, normalizeHexColor } from "@/shared/constants/account-colors";
import { isApiError } from "@/infrastructure/api-client";
import { cn } from "@/shared/lib/cn";
import { formatFullDate } from "@/shared/utils/format";
import {
  useAccounts,
  useDisconnectAccount,
  useReconnectAccount,
  useRemoveAccountAvatar,
  useSetAccountAvatar,
  useSyncNow,
  useUpdateAccount,
} from "../api";
import { accountAvatarUrl } from "../lib/avatar";
import { accountLabel, type Account } from "../types";
import { isPasswordProvider, providerLabelKey } from "../lib/providers";
import { AccountDot } from "./account-dot";
import { AppearancePicker, type AvatarChange } from "./appearance-picker";
import { ConnectSection } from "./connect-section";
import { ImapReconnectDialog } from "./imap-reconnect-dialog";

const KNOWN_ERRORS = ["access_denied", "invalid_state", "provider_not_configured", "already_connected", "provider_unavailable"] as const;

function StatusBadge({ account }: { account: Account }) {
  const t = useTranslations("accounts");
  const ok = account.status === "active";
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium",
        ok ? "bg-muted text-foreground-muted" : "bg-warning-soft text-warning",
      )}
    >
      {ok ? <Check className="size-3 shrink-0" aria-hidden /> : <AlertCircle className="size-3 shrink-0" aria-hidden />}
      <span className="truncate">{t(`status.${account.status}`)}</span>
    </span>
  );
}

function EditAccountDialog({ account, onClose }: { account: Account; onClose: () => void }) {
  const t = useTranslations("accounts");
  const tc = useTranslations("common");
  const update = useUpdateAccount();
  const setAvatar = useSetAccountAvatar();
  const removeAvatar = useRemoveAccountAvatar();
  const [name, setName] = useState(account.display_name ?? "");
  const [color, setColor] = useState(normalizeHexColor(account.color ?? "") ?? DEFAULT_ACCOUNT_COLOR);
  const [avatar, setAvatarChange] = useState<AvatarChange>({ kind: "keep" });
  const [saving, setSaving] = useState(false);

  // The preview of a newly chosen picture is an object URL; release it once it is replaced.
  const previewUrl = avatar.kind === "new" ? avatar.prepared.previewUrl : null;
  useEffect(() => (previewUrl ? () => URL.revokeObjectURL(previewUrl) : undefined), [previewUrl]);

  const save = async () => {
    setSaving(true);
    try {
      await update.mutateAsync({ accountId: account.id, display_name: name.trim() || undefined, color });
    } catch {
      toast.error(tc("genericError"));
      setSaving(false);
      return;
    }
    try {
      if (avatar.kind === "new") await setAvatar.mutateAsync({ accountId: account.id, image: avatar.prepared.blob });
      else if (avatar.kind === "remove") await removeAvatar.mutateAsync(account.id);
    } catch (error) {
      const reason = isApiError(error) && error.status === 413 ? "pictureTooLarge" : isApiError(error) && error.status === 422 ? "pictureUnsupported" : "pictureFailed";
      toast.error(t(reason));
      setSaving(false);
      return;
    }
    toast.success(t("updated"));
    onClose();
  };

  return (
    <ResponsiveDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("editTitle")}
      description={account.email_address}
      closeLabel={tc("close")}
      footer={
        <>
          <Button onClick={onClose}>{tc("cancel")}</Button>
          <Button variant="primary" loading={saving} onClick={() => void save()}>
            {tc("save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label={t("displayName")} htmlFor="account-name" hint={t("displayNameHint")}>
          <Input id="account-name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        </Field>
        <AppearancePicker
          color={color}
          onColorChange={setColor}
          currentImageUrl={accountAvatarUrl(account)}
          avatar={avatar}
          onAvatarChange={setAvatarChange}
          previewLabel={name.trim() || account.email_address}
        />
      </div>
    </ResponsiveDialog>
  );
}

function AccountRow({ account }: { account: Account }) {
  const t = useTranslations("accounts");
  const ts = useTranslations("sync");
  const tc = useTranslations("common");
  const locale = useLocale();
  const reconnect = useReconnectAccount();
  const disconnect = useDisconnectAccount();
  const syncNow = useSyncNow();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [enteringPassword, setEnteringPassword] = useState(false);

  const needsReauth = account.status === "needs_reauth";
  // An IMAP mailbox has no consent screen to go back to: it is reconnected with a new password.
  const usesPassword = isPasswordProvider(account.provider);
  const startReconnect = () => {
    if (usesPassword) setEnteringPassword(true);
    else reconnect.mutate({ accountId: account.id, locale }, { onError: () => toast.error(t("connectFailed")) });
  };

  const items: MenuItem[] = [
    {
      key: "sync",
      label: ts("syncNow"),
      icon: RefreshCw,
      disabled: account.status !== "active",
      onSelect: () =>
        syncNow.mutate(account.id, {
          onSuccess: () => toast.success(ts("started")),
          onError: () => toast.error(ts("failed")),
        }),
    },
    { key: "edit", label: t("edit"), icon: Pencil, onSelect: () => setEditing(true) },
    { key: "reconnect", label: t("reconnect"), icon: Unplug, onSelect: startReconnect },
    { key: "disconnect", label: t("disconnect"), icon: Trash2, destructive: true, onSelect: () => setConfirming(true) },
  ];

  const syncLine =
    account.sync.status === "running" || account.sync.status === "queued"
      ? ts("syncing")
      : account.sync.status === "error"
        ? ts("lastFailed")
        : account.sync.last_synced_at
          ? ts("lastSynced", { date: formatFullDate(account.sync.last_synced_at, locale) })
          : ts("never");

  return (
    <li className="flex min-w-0 flex-col gap-3 p-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface">
          <AccountDot color={account.color} imageUrl={accountAvatarUrl(account)} className="size-3" imageClassName="size-full rounded-none" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 truncate text-sm font-medium text-foreground">{accountLabel(account)}</span>
            <StatusBadge account={account} />
          </div>
          {account.display_name?.trim() ? (
            <p className="truncate text-[13px] text-foreground-muted">{account.email_address}</p>
          ) : null}
          <p className="mt-0.5 text-xs break-words text-foreground-subtle">
            {t(`providers.${providerLabelKey(account.provider)}`)} · {syncLine}
          </p>
        </div>
        <ResponsiveMenu
          title={accountLabel(account)}
          items={items}
          trigger={
            <Button variant="ghost" size="icon" aria-label={t("actionsFor", { account: accountLabel(account) })}>
              <MoreHorizontal />
            </Button>
          }
        />
      </div>
      {needsReauth ? (
        <div className="flex flex-col gap-3 rounded-md bg-warning-soft p-3 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 text-[13px] break-words text-foreground">{t(usesPassword ? "needsReauthMessageImap" : "needsReauthMessage")}</p>
          <Button variant="primary" size="sm" loading={reconnect.isPending} onClick={startReconnect}>
            {t("reconnect")}
          </Button>
        </div>
      ) : null}
      {editing ? <EditAccountDialog account={account} onClose={() => setEditing(false)} /> : null}
      {usesPassword ? (
        <ImapReconnectDialog account={account} open={enteringPassword} onOpenChange={setEnteringPassword} />
      ) : null}
      <ResponsiveDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("disconnectTitle")}
        description={t("disconnectDescription", { email: account.email_address })}
        closeLabel={tc("close")}
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>{tc("cancel")}</Button>
            <Button
              variant="danger"
              loading={disconnect.isPending}
              onClick={() =>
                disconnect.mutate(account.id, {
                  onSuccess: () => {
                    toast.success(t("disconnected"));
                    setConfirming(false);
                  },
                  onError: () => toast.error(tc("genericError")),
                })
              }
            >
              {t("disconnect")}
            </Button>
          </>
        }
      />
    </li>
  );
}

/** Settings → Connected accounts. */
export function ConnectedAccounts() {
  const t = useTranslations("accounts");
  const tc = useTranslations("common");
  const accounts = useAccounts();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const handled = useRef(false);

  const connected = searchParams.get("connected");
  const error = searchParams.get("error");
  const refetch = accounts.refetch;

  // Result of the OAuth round trip arrives as a query parameter; show it once and clean the URL.
  useEffect(() => {
    if (handled.current || (!connected && !error)) return;
    handled.current = true;
    if (connected) {
      toast.success(t("connected"));
      void refetch();
    } else if (error) {
      const known = KNOWN_ERRORS.find((code) => code === error);
      toast.error(t(`oauthErrors.${known ?? "unknown"}`));
    }
    router.replace(pathname);
  }, [connected, error, pathname, router, t, refetch]);

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="accounts-list-heading" className="flex flex-col gap-3">
        <h2 id="accounts-list-heading" className="text-sm font-semibold text-foreground">
          {t("listHeading")}
        </h2>
        {accounts.isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : accounts.isError ? (
          <ErrorState
            className="rounded-lg border border-border py-8"
            title={tc("loadFailedTitle")}
            description={tc("loadFailedDescription")}
            action={<Button onClick={() => void accounts.refetch()}>{tc("retry")}</Button>}
          />
        ) : accounts.data.length === 0 ? (
          <EmptyState
            className="rounded-lg border border-dashed border-border-strong py-8"
            icon={Mail}
            title={t("noneTitle")}
            description={t("noneDescription")}
          />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface-raised">
            {accounts.data.map((account) => (
              <AccountRow key={account.id} account={account} />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="accounts-connect-heading" className="flex flex-col gap-3">
        <h2 id="accounts-connect-heading" className="text-sm font-semibold text-foreground">
          {t("connectHeading")}
        </h2>
        <ConnectSection />
      </section>
    </div>
  );
}
