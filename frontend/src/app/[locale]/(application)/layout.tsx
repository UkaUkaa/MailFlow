import { Suspense, type ReactNode } from "react";
import { ApplicationShell } from "./_shell/application-shell";

export default function ApplicationLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <ApplicationShell>{children}</ApplicationShell>
    </Suspense>
  );
}
