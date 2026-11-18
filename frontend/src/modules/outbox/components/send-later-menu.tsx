"use client";

import { CalendarClock, Clock, Sunrise } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { ResponsiveDialog } from "@/shared/components/layout/responsive-dialog";
import { ResponsiveMenu, type MenuItem } from "@/shared/components/layout/responsive-menu";
import { Button } from "@/shared/components/ui/button";
import { Field } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { formatScheduleDate } from "@/shared/utils/format";
import {
  fromLocalInputValue,
  latestSchedule,
  scheduleProblem,
  schedulePresets,
  toLocalInputValue,
  type ScheduleProblem,
  type SchedulePresetId,
} from "../lib/schedule-presets";

const PRESET_ICONS: Record<SchedulePresetId, typeof Clock> = {
  laterToday: Clock,
  tomorrowMorning: Sunrise,
  mondayMorning: Sunrise,
};

/**
 * Chooses when a message is sent: quick presets or an exact date and time, all in the browser's
 * time zone. A dropdown from tablet up and a bottom sheet on phones; the exact time is asked in
 * a dialog (a sheet on phones). Used by the composer and to reschedule from the Scheduled view.
 */
export function SendLaterMenu({
  trigger,
  title,
  confirmLabel,
  onSelect,
  onOpenChange,
  align,
}: {
  trigger: ReactNode;
  title: string;
  /** Label of the button that confirms an exact date and time. */
  confirmLabel: string;
  onSelect: (sendAt: Date) => void;
  /** Reports whether any part of the picker (menu or dialog) is open. */
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "end";
}) {
  const t = useTranslations("outbox.sendLater");
  const tc = useTranslations("common");
  const locale = useLocale();
  const inputId = useId();
  // The presets are relative to the moment the menu opens, not to the first render.
  const [now, setNow] = useState(() => new Date());
  const [menuOpen, setMenuOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<ScheduleProblem | null>(null);

  // Choosing "Pick date & time" closes the menu and opens the dialog, so the two are reported
  // as one surface.
  const anyOpen = menuOpen || customOpen;
  useEffect(() => {
    onOpenChange?.(anyOpen);
  }, [anyOpen, onOpenChange]);

  const openCustom = () => {
    setNow(new Date());
    setValue("");
    setProblem(null);
    setCustomOpen(true);
  };

  const items: MenuItem[] = [
    ...schedulePresets(now).map((preset) => ({
      key: preset.id,
      label: t(`presets.${preset.id}`),
      hint: formatScheduleDate(preset.at, locale, now),
      icon: PRESET_ICONS[preset.id],
      onSelect: () => onSelect(preset.at),
    })),
    { key: "custom", label: t("custom"), icon: CalendarClock, onSelect: openCustom },
  ];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // A form inside a portal still bubbles through the React tree to the composer.
    event.stopPropagation();
    const sendAt = fromLocalInputValue(value);
    const found = scheduleProblem(sendAt, new Date());
    setProblem(found);
    if (found || !sendAt) return;
    setCustomOpen(false);
    onSelect(sendAt);
  };

  return (
    <>
      <ResponsiveMenu
        trigger={trigger}
        title={title}
        items={items}
        align={align}
        onOpenChange={(open) => {
          if (open) setNow(new Date());
          setMenuOpen(open);
        }}
      />
      <ResponsiveDialog
        open={customOpen}
        onOpenChange={setCustomOpen}
        title={t("customTitle")}
        description={t("customDescription")}
        closeLabel={tc("close")}
      >
        <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-4">
          <Field label={t("customLabel")} htmlFor={inputId} error={problem ? t(`problems.${problem}`) : undefined}>
            <Input
              id={inputId}
              type="datetime-local"
              required
              autoFocus
              value={value}
              min={toLocalInputValue(now)}
              max={toLocalInputValue(latestSchedule(now))}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `${inputId}-error` : undefined}
              onChange={(event) => {
                setValue(event.target.value);
                setProblem(null);
              }}
            />
          </Field>
          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <Button onClick={() => setCustomOpen(false)}>{tc("cancel")}</Button>
            <Button type="submit" variant="primary">
              {confirmLabel}
            </Button>
          </div>
        </form>
      </ResponsiveDialog>
    </>
  );
}
