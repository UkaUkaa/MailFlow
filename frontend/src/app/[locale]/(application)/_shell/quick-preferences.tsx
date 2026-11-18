"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useUpdateSettings } from "@/modules/settings";
import { navIcon, navLabel, navRow } from "@/shared/components/layout/nav-row";
import { LanguageToggle, ThemeCycle } from "@/shared/components/layout/preferences";

/**
 * Language and theme rows of the navigation column, the same two rows in both of its states.
 * The choice applies at once in the browser and is also saved to the account (the same call
 * Settings → Appearance makes), so the server localizes the emails it sends.
 */
export function QuickPreferences({ expanded }: { expanded: boolean }) {
  const t = useTranslations("nav");
  const ta = useTranslations("settings.appearance");
  const tc = useTranslations("common");
  const update = useUpdateSettings();
  const onError = () => toast.error(tc("genericError"));
  const names = { system: ta("themes.system"), light: ta("themes.light"), dark: ta("themes.dark") };
  const row = { className: navRow, iconClassName: navIcon, labelClassName: navLabel, expanded };

  return (
    <>
      <LanguageToggle
        label={(language) => t("switchLanguage", { language })}
        text={(language) => t("languageRow", { language })}
        onChange={(locale) => update.mutate({ locale }, { onError })}
        {...row}
      />
      <ThemeCycle
        label={(theme) => t("switchTheme", { theme })}
        text={(theme) => t("themeRow", { theme })}
        names={names}
        onChange={(theme) => update.mutate({ theme }, { onError })}
        {...row}
      />
    </>
  );
}
