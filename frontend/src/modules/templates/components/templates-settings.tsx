"use client";

import { FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { SettingsPage } from "@/modules/settings";
import { ResponsiveDialog } from "@/shared/components/layout/responsive-dialog";
import { Button } from "@/shared/components/ui/button";
import { useDeleteTemplate, useTemplates } from "../api";
import type { Template } from "../types";
import { TemplateEditorDialog } from "./template-editor-dialog";

function textPreview(html: string): string {
  if (typeof DOMParser === "undefined") return "";
  return (new DOMParser().parseFromString(html, "text/html").body.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Settings → Templates: the list, and create / edit / delete. */
export function TemplatesSettings() {
  const t = useTranslations("templates");
  const tc = useTranslations("common");
  const templates = useTemplates();
  const remove = useDeleteTemplate();
  const [editing, setEditing] = useState<Template | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleting, setDeleting] = useState<Template | null>(null);

  const openEditor = (template: Template | null) => {
    setEditing(template);
    setEditorOpen(true);
  };

  const items = templates.data ?? [];

  return (
    <SettingsPage title={t("title")} description={t("description")}>
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => openEditor(null)}>
          <Plus aria-hidden />
          {t("new")}
        </Button>
      </div>

      {templates.isError ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-border bg-surface-raised p-4">
          <p className="text-sm text-foreground-muted">{tc("loadFailedDescription")}</p>
          <Button size="sm" onClick={() => void templates.refetch()}>
            {tc("retry")}
          </Button>
        </div>
      ) : templates.isPending ? (
        <p className="text-sm text-foreground-muted">{tc("loading")}</p>
      ) : items.length === 0 ? (
        <div className="flex min-w-0 flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong px-4 py-10 text-center">
          <FileText className="size-6 text-foreground-subtle" aria-hidden />
          <p className="max-w-sm text-sm break-words text-foreground-muted">{t("empty")}</p>
        </div>
      ) : (
        <ul aria-label={t("title")} className="min-w-0 rounded-lg border border-border bg-surface-raised">
          {items.map((template) => (
            <li key={template.id} className="flex min-w-0 items-center gap-2 border-b border-border py-2 pr-2 pl-4 last:border-b-0">
              <button
                type="button"
                onClick={() => openEditor(template)}
                className="flex min-h-11 min-w-0 flex-1 flex-col justify-center py-1 text-left"
              >
                <span className="truncate text-sm font-semibold text-foreground">{template.name}</span>
                <span className="truncate text-xs text-foreground-muted">
                  {template.subject || textPreview(template.body_html) || t("emptyBody")}
                </span>
              </button>
              <Button variant="ghost" size="icon" aria-label={t("editNamed", { name: template.name })} onClick={() => openEditor(template)}>
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("deleteNamed", { name: template.name })}
                onClick={() => setDeleting(template)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <TemplateEditorDialog open={editorOpen} onOpenChange={setEditorOpen} template={editing} />
      <ResponsiveDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? null : setDeleting(null))}
        title={t("deleteTitle")}
        description={deleting ? t("deleteDescription", { name: deleting.name }) : undefined}
        closeLabel={tc("close")}
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>{tc("cancel")}</Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                if (!deleting) return;
                remove.mutate(deleting.id, {
                  onSuccess: () => {
                    toast(t("deleted"));
                    setDeleting(null);
                  },
                  onError: () => toast.error(tc("genericError")),
                });
              }}
            >
              {t("delete")}
            </Button>
          </>
        }
      />
    </SettingsPage>
  );
}
