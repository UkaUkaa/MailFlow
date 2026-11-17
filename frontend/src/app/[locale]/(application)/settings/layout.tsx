import type { ReactNode } from "react";
import { MailBackdrop } from "@/modules/inbox";
import { SettingsLayout } from "@/modules/settings";

/** Composes the settings dialog with the mail workspace that stays visible behind it. */
export default function SettingsRouteLayout({ children }: { children: ReactNode }) {
  return <SettingsLayout backdrop={<MailBackdrop />}>{children}</SettingsLayout>;
}
