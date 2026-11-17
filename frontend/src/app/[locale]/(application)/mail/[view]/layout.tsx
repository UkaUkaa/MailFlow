import type { ReactNode } from "react";
import { MailWorkspace } from "@/modules/inbox";

export default function MailViewLayout({ children }: { children: ReactNode }) {
  return <MailWorkspace>{children}</MailWorkspace>;
}
