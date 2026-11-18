import { Suspense, type ReactNode } from "react";
import { LegalShell } from "@/modules/legal";

export default function LegalLayout({ children }: { children: ReactNode }) {
  // The language switch reads the query string, which needs a Suspense boundary.
  return (
    <Suspense>
      <LegalShell>{children}</LegalShell>
    </Suspense>
  );
}
