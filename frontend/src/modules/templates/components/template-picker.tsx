"use client";

import { FilePlus2, FileText } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { useSession } from "@/infrastructure/authentication";
import { ResponsiveMenu, type MenuItem } from "@/shared/components/layout/responsive-menu";
import type { Address } from "@/shared/types/address";
import { useTemplates } from "../api";
import { fillHtml, fillText, placeholderValues } from "../lib/fill";
import type { TemplateInput } from "../types";
import { TemplateEditorDialog } from "./template-editor-dialog";

export interface FilledTemplate {
  subject: string;
  bodyHtml: string;
}

/**
 * The composer's template menu: pick a template to insert (placeholders filled for the first
 * recipient), or save what is being written as a new template.
 */
export function TemplatePicker({
  trigger,
  recipient,
  canSave,
  getCurrent,
  onInsert,
  onOpenChange,
}: {
  trigger: ReactNode;
  recipient: Address | null;
  /** Whether there is anything to save as a template. */
  canSave: boolean;
  /** What the composer holds now, read when "Save as template" is chosen. */
  getCurrent: () => { subject: string; bodyHtml: string };
  onInsert: (template: FilledTemplate) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations("templates");
  const locale = useLocale();
  // Already cached by the session guard; read softly so the picker never needs it to render.
  const session = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const templates = useTemplates(menuOpen);
  const [saveOpen, setSaveOpen] = useState(false);
  const [initial, setInitial] = useState<TemplateInput | undefined>(undefined);

  const setOpen = (open: boolean) => {
    setMenuOpen(open);
    onOpenChange?.(open || saveOpen);
  };

  const list = templates.data ?? [];
  const items: MenuItem[] = [
    ...list.map((template) => ({
      key: template.id,
      label: template.name,
      icon: FileText,
      onSelect: () => {
        const values = placeholderValues({ recipient, myName: session.data?.display_name ?? "", locale, now: new Date() });
        onInsert({ subject: fillText(template.subject, values), bodyHtml: fillHtml(template.body_html, values) });
      },
    })),
    ...(list.length === 0
      ? [{ key: "empty", label: templates.isPending ? t("picker.loading") : t("picker.empty"), disabled: true, onSelect: () => undefined }]
      : []),
    {
      key: "save",
      label: t("picker.saveCurrent"),
      icon: FilePlus2,
      disabled: !canSave,
      onSelect: () => {
        const current = getCurrent();
        setInitial({ name: current.subject.trim(), subject: current.subject.trim(), body_html: current.bodyHtml });
        setSaveOpen(true);
        onOpenChange?.(true);
      },
    },
  ];

  return (
    <>
      <ResponsiveMenu trigger={trigger} title={t("picker.title")} items={items} align="start" onOpenChange={setOpen} />
      <TemplateEditorDialog
        open={saveOpen}
        onOpenChange={(open) => {
          setSaveOpen(open);
          onOpenChange?.(open);
        }}
        initial={initial}
      />
    </>
  );
}
