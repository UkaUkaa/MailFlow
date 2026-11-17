import { Suspense, type ReactNode } from "react";
import { AuthShell } from "@/modules/authentication";

export default function AuthLayout({ children }: { children: ReactNode }) {
  // Auth screens read the query string (tokens, `next`), which needs a Suspense boundary.
  return (
    <Suspense>
      <AuthShell>{children}</AuthShell>
    </Suspense>
  );
}
