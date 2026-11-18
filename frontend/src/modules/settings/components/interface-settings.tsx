"use client";

import { Check, LayoutList, Palette, RotateCcw, Rows3, SquareUserRound, Text, Type, type LucideIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import { toast } from "sonner";
import { group, segment } from "@/shared/components/ui/segmented";
import { Avatar } from "@/shared/components/ui/avatar";
import { Button } from "@/shared/components/ui/button";
import { Switch } from "@/shared/components/ui/switch";
import { ACCOUNT_COLORS } from "@/shared/constants/account-colors";
import { cn } from "@/shared/lib/cn";
import {
  ACCENT_COLORS,
  ACCOUNT_TINTS,
  DEFAULT_INTERFACE,
  interfaceFrom,
  LIST_DENSITIES,
  PREVIEW_LINES,
  READER_TEXT_SIZES,
  type InterfacePreferences,
} from "@/shared/lib/interface-preferences";
import { useSettings, useUpdateSettings } from "../api";
import { SettingsCard, SettingsPage, SettingsRow } from "./settings-section";

/** Segmented control with the same look as the theme and language switches. */
function Choice<T extends string | number>({
  label,
  options,
  value,
  names,
  disabled,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T | undefined;
  names: (option: T) => string;
  disabled: boolean;
  onChange: (option: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className={cn(group, "w-full sm:w-auto")}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          disabled={disabled}
          onClick={() => onChange(option)}
          className={cn(segment, "disabled:opacity-50")}
        >
          <span className="truncate">{names(option)}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Two sample rows styled by the same `<html>` variants as the real message list, so every
 * choice on this page shows its effect at once, also on phones where the list is out of view.
 */
function ListPreview() {
  const t = useTranslations("settings.interface.preview");
  const format = useFormatter();
  const morning = format.dateTime(new Date(2026, 0, 1, 10, 24), { hour: "numeric", minute: "2-digit" });
  const rows = [
    { sender: t("sender1"), subject: t("subject1"), snippet: t("snippet1"), time: morning, unread: true, color: ACCOUNT_COLORS[0] },
    { sender: t("sender2"), subject: t("subject2"), snippet: t("snippet2"), time: t("time2"), unread: false, color: ACCOUNT_COLORS[2] },
  ];
  return (
    <figure className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface">
      <figcaption className="border-b border-border px-4 py-2 text-[11px] font-semibold tracking-wide text-foreground-subtle uppercase">
        {t("label")}
      </figcaption>
      <ul aria-hidden>
        {rows.map((row) => (
          <li
            key={row.sender}
            style={{ "--account-tint": row.color } as CSSProperties}
            className="account-tint flex min-h-[88px] min-w-0 py-3 pr-5 preview-none:min-h-[76px] compact:min-h-[60px] compact:py-2 compact:preview-none:min-h-[60px]"
          >
            <span className="flex w-[30px] shrink-0 justify-center pt-[11px]">
              {row.unread ? <span className="size-2 rounded-full bg-accent" /> : null}
            </span>
            <Avatar name={row.sender} colorKey={row.sender} className="mt-0.5 no-avatars:hidden" />
            <span className="ml-1 flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{row.sender}</span>
                <span className="shrink-0 text-[11px] text-foreground-muted tabular-nums">{row.time}</span>
              </span>
              <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{row.subject}</span>
              <span className="min-w-0 truncate text-[13px] text-foreground-muted preview-none:hidden preview-two:line-clamp-2 preview-two:whitespace-normal">
                {row.snippet}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

function SectionTitle({ icon: Icon, children }: { icon: LucideIcon; children: string }) {
  return (
    <h2 className="flex items-center gap-2 pt-2 text-xs font-semibold tracking-wide text-foreground-subtle uppercase">
      <Icon className="size-3.5" aria-hidden />
      {children}
    </h2>
  );
}

export function InterfaceSettings() {
  const t = useTranslations("settings.interface");
  const tc = useTranslations("common");
  const settings = useSettings();
  const update = useUpdateSettings();
  const current: InterfacePreferences | undefined = settings.data ? interfaceFrom(settings.data) : undefined;
  const disabled = !current;
  const onError = () => toast.error(tc("genericError"));
  const change = (patch: Partial<InterfacePreferences>) => update.mutate(patch, { onError });
  const isDefault = current
    ? (Object.keys(DEFAULT_INTERFACE) as (keyof InterfacePreferences)[]).every((key) => current[key] === DEFAULT_INTERFACE[key])
    : true;

  return (
    <SettingsPage title={t("title")} description={t("description")}>
      <ListPreview />

      <SectionTitle icon={LayoutList}>{t("listSection")}</SectionTitle>
      <SettingsCard>
        <SettingsRow icon={Rows3} title={t("density")} description={t("densityDescription")}>
          <Choice
            label={t("density")}
            options={LIST_DENSITIES}
            value={current?.list_density}
            names={(option) => t(`densities.${option}`)}
            disabled={disabled}
            onChange={(list_density) => change({ list_density })}
          />
        </SettingsRow>
        <SettingsRow icon={Text} title={t("previewLines")} description={t("previewLinesDescription")}>
          <Choice
            label={t("previewLines")}
            options={PREVIEW_LINES}
            value={current?.list_preview_lines}
            names={(option) => t(`previewOptions.${option}`)}
            disabled={disabled}
            onChange={(list_preview_lines) => change({ list_preview_lines })}
          />
        </SettingsRow>
        <SettingsRow icon={SquareUserRound} inline title={t("avatars")} titleId="interface-avatars-label" description={t("avatarsDescription")}>
          <Switch
            aria-labelledby="interface-avatars-label"
            checked={current?.show_avatars ?? true}
            disabled={disabled}
            onCheckedChange={(show_avatars) => change({ show_avatars })}
          />
        </SettingsRow>
        <SettingsRow icon={Palette} title={t("tint")} description={t("tintDescription")}>
          <Choice
            label={t("tint")}
            options={ACCOUNT_TINTS}
            value={current?.account_tint}
            names={(option) => t(`tints.${option}`)}
            disabled={disabled}
            onChange={(account_tint) => change({ account_tint })}
          />
        </SettingsRow>
      </SettingsCard>

      <SectionTitle icon={Palette}>{t("colorsSection")}</SectionTitle>
      <SettingsCard>
        <SettingsRow stacked title={t("accent")} description={t("accentDescription")}>
          <div role="group" aria-label={t("accent")} className="flex flex-wrap gap-2">
            {ACCENT_COLORS.map((accent) => {
              const selected = current?.accent_color === accent;
              return (
                <button
                  key={accent}
                  type="button"
                  data-accent={accent}
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => change({ accent_color: accent })}
                  className="inline-flex h-9 min-w-0 items-center gap-2 rounded-md border border-border bg-surface-raised py-1 pr-3 pl-1.5 text-[13px] font-medium text-foreground-muted transition-colors hover:text-foreground disabled:opacity-50 aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-foreground touch:h-11"
                >
                  <span aria-hidden className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                    {selected ? <Check className="size-3.5" strokeWidth={3} /> : null}
                  </span>
                  <span className="truncate">{t(`accents.${accent}`)}</span>
                </button>
              );
            })}
          </div>
        </SettingsRow>
      </SettingsCard>

      <SectionTitle icon={Type}>{t("readerSection")}</SectionTitle>
      <SettingsCard>
        <SettingsRow icon={Type} title={t("readerText")} description={t("readerTextDescription")}>
          <Choice
            label={t("readerText")}
            options={READER_TEXT_SIZES}
            value={current?.reader_text_size}
            names={(option) => t(`readerTexts.${option}`)}
            disabled={disabled}
            onChange={(reader_text_size) => change({ reader_text_size })}
          />
        </SettingsRow>
      </SettingsCard>

      <div className="flex justify-end">
        <Button
          variant="ghost"
          disabled={disabled || isDefault}
          onClick={() => update.mutate({ ...DEFAULT_INTERFACE }, { onError, onSuccess: () => toast.success(t("resetDone")) })}
        >
          <RotateCcw aria-hidden />
          {t("reset")}
        </Button>
      </div>
    </SettingsPage>
  );
}
