import { Compass } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/infrastructure/i18n/navigation";
import { EmptyState } from "@/shared/components/feedback/states";
import { Button } from "@/shared/components/ui/button";

export default function NotFound() {
  const t = useTranslations("common");
  return (
    <div className="flex min-h-dvh bg-background">
      <EmptyState
        icon={Compass}
        title={t("notFoundTitle")}
        description={t("notFoundDescription")}
        action={
          <Button asChild variant="primary">
            <Link href="/mail/inbox">{t("goToInbox")}</Link>
          </Button>
        }
      />
    </div>
  );
}
