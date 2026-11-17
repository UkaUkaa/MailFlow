import type { ReactNode } from "react";
import { SettingsLayout } from "@/modules/settings";

export default function SettingsRouteLayout({ children }: { children: ReactNode }) {
  return <SettingsLayout>{children}</SettingsLayout>;
}
