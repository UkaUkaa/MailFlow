"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "@/infrastructure/theme";
import { useSettings } from "../api";

/**
 * Applies the theme stored on the account once per session, so a user who
 * signs in on a new device gets their saved appearance. The URL decides the
 * language; the stored locale is only used by the server for emails.
 */
export function SettingsSync() {
  const settings = useSettings();
  const { theme, setTheme } = useTheme();
  const applied = useRef(false);
  const serverTheme = settings.data?.theme;

  useEffect(() => {
    if (applied.current || !serverTheme) return;
    applied.current = true;
    if (serverTheme !== theme) setTheme(serverTheme);
  }, [serverTheme, theme, setTheme]);

  return null;
}
