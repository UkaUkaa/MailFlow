"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useUpdateSettings } from "@/modules/settings";
import { LanguageSwitch, LanguageToggle, ThemeCycle, ThemeSwitch } from "@/shared/components/layout/preferences";

/**
 * Language and theme controls of the navigation. The choice applies at once in the browser and
 * is also saved to the account (the same call Settings → Appearance makes), so the server
 * localizes the emails it sends.
 */
export function QuickPreferences({ variant, buttonClassName }: { variant: "rail" | "full"; buttonClassName?: string }) {
  const t = useTranslations("nav");
  const ta = useTranslations("settings.appearance");
  const tc = useTranslations("common");
  const update = useUpdateSettings();
  const onError = () => toast.error(tc("genericError"));
  const names = { system: ta("themes.system"), light: ta("themes.light"), dark: ta("themes.dark") };

  if (variant === "rail") {
    return (
      <>
        <LanguageToggle
          label={(language) => t("switchLanguage", { language })}
          onChange={(locale) => update.mutate({ locale }, { onError })}
          className={buttonClassName}
        />
        <ThemeCycle
          label={(theme) => t("switchTheme", { theme })}
          names={names}
          onChange={(theme) => update.mutate({ theme }, { onError })}
          className={buttonClassName}
        />
      </>
    );
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 px-0.5 pb-2">
      <LanguageSwitch label={ta("language")} onChange={(locale) => update.mutate({ locale }, { onError })} />
      <ThemeSwitch label={ta("theme")} names={names} onChange={(theme) => update.mutate({ theme }, { onError })} />
    </div>
  );
}
