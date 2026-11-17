"use client";

import { ImageOff, Languages, SunMoon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { LanguageSwitch, ThemeSwitch } from "@/shared/components/layout/preferences";
import { Switch } from "@/shared/components/ui/switch";
import { useSettings, useUpdateSettings } from "../api";
import { SettingsCard, SettingsPage, SettingsRow } from "./settings-section";

export function AppearanceSettings() {
  const t = useTranslations("settings.appearance");
  const tc = useTranslations("common");
  const settings = useSettings();
  const update = useUpdateSettings();
  const onError = () => toast.error(tc("genericError"));

  return (
    <SettingsPage title={t("title")} description={t("description")}>
      <SettingsCard flat>
        <SettingsRow icon={SunMoon} title={t("theme")} description={t("themeDescription")}>
          <ThemeSwitch
            label={t("theme")}
            showNames
            className="w-full sm:w-auto"
            names={{ system: t("themes.system"), light: t("themes.light"), dark: t("themes.dark") }}
            onChange={(theme) => update.mutate({ theme }, { onError })}
          />
        </SettingsRow>
        <SettingsRow icon={Languages} title={t("language")} description={t("languageDescription")}>
          <LanguageSwitch
            label={t("language")}
            showNames
            className="w-full sm:w-auto"
            onChange={(locale) => update.mutate({ locale }, { onError })}
          />
        </SettingsRow>
        <SettingsRow icon={ImageOff} inline title={t("remoteImages")} titleId="remote-images-label" description={t("remoteImagesDescription")}>
          <Switch
            aria-labelledby="remote-images-label"
            checked={settings.data?.load_remote_images ?? false}
            disabled={!settings.data}
            onCheckedChange={(checked) => update.mutate({ load_remote_images: checked }, { onError })}
          />
        </SettingsRow>
      </SettingsCard>
    </SettingsPage>
  );
}
