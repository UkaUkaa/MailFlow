"use client";

import { useTranslations } from "next-intl";
import { useId, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { isApiError } from "@/infrastructure/api-client";
import { ResponsiveDialog } from "@/shared/components/layout/responsive-dialog";
import { EditorToolbar, RichTextArea, useRichTextEditor } from "@/shared/components/editor/rich-text-editor";
import { Button } from "@/shared/components/ui/button";
import { Field, Label } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { useCreateTemplate, useUpdateTemplate } from "../api";
import { PLACEHOLDERS } from "../lib/fill";
import { TEMPLATE_NAME_MAX, TEMPLATE_SUBJECT_MAX, type Template, type TemplateInput } from "../types";

function EditorForm({
  template,
  initial,
  onDone,
  onCancel,
}: {
  template: Template | null;
  initial: TemplateInput;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("templates");
  const tc = useTranslations("common");
  const nameId = useId();
  const subjectId = useId();
  const bodyLabelId = useId();
  const create = useCreateTemplate();
  const update = useUpdateTemplate();
  const [name, setName] = useState(initial.name);
  const [subject, setSubject] = useState(initial.subject);
  const [nameError, setNameError] = useState<string | null>(null);
  const bodyRef = useRef(initial.body_html);

  const editor = useRichTextEditor({
    initialHtml: initial.body_html,
    placeholder: t("bodyPlaceholder"),
    ariaLabel: t("body"),
    onChange: (html, isEmpty) => {
      bodyRef.current = isEmpty ? "" : html;
    },
  });

  const pending = create.isPending || update.isPending;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // A form inside a portal still bubbles through the React tree (e.g. to the composer).
    event.stopPropagation();
    if (!name.trim()) {
      setNameError(t("errors.nameRequired"));
      return;
    }
    const input: TemplateInput = {
      name: name.trim(),
      subject: subject.trim(),
      body_html: bodyRef.current,
    };
    const options = {
      onSuccess: () => {
        toast.success(t("saved"));
        onDone();
      },
      onError: (error: Error) =>
        toast.error(isApiError(error) && error.code === "template_limit_reached" ? t("errors.limit") : tc("genericError")),
    };
    if (template) update.mutate({ id: template.id, input }, options);
    else create.mutate(input, options);
  };

  return (
    <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-4">
      <Field label={t("name")} htmlFor={nameId} error={nameError}>
        <Input
          id={nameId}
          value={name}
          maxLength={TEMPLATE_NAME_MAX}
          autoFocus
          placeholder={t("namePlaceholder")}
          aria-invalid={nameError ? true : undefined}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(null);
          }}
        />
      </Field>
      <Field label={t("subject")} htmlFor={subjectId}>
        <Input id={subjectId} value={subject} maxLength={TEMPLATE_SUBJECT_MAX} onChange={(event) => setSubject(event.target.value)} />
      </Field>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label id={bodyLabelId}>{t("body")}</Label>
        <div
          aria-labelledby={bodyLabelId}
          className="min-w-0 rounded-md border border-border-strong bg-surface-raised focus-within:border-accent"
        >
          <div className="max-h-[40dvh] min-h-32 overflow-y-auto px-3 py-2" onClick={() => editor?.isFocused || editor?.commands.focus()}>
            <RichTextArea editor={editor} />
          </div>
          <div className="border-t border-border px-1 py-1">
            <EditorToolbar editor={editor} />
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 pt-1">
          <span className="text-xs text-foreground-muted">{t("placeholdersHint")}</span>
          {PLACEHOLDERS.map((key) => (
            <button
              key={key}
              type="button"
              aria-label={t("insertPlaceholder", {
                label: t(`placeholders.${key}`),
              })}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => editor?.chain().focus().insertContent(`{{${key}}}`).run()}
              className="inline-flex h-7 min-w-0 items-center rounded-sm border border-border bg-surface px-2 text-xs text-foreground-muted hover:text-foreground touch:h-11"
            >
              {t(`placeholders.${key}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
        <Button onClick={onCancel}>{tc("cancel")}</Button>
        <Button type="submit" variant="primary" loading={pending}>
          {tc("save")}
        </Button>
      </div>
    </form>
  );
}

/**
 * Creates or edits a template. `initial` pre-fills a new one (e.g. "Save as template" from the
 * composer). A dialog from tablet up, a bottom sheet on phones.
 */
export function TemplateEditorDialog({
  open,
  onOpenChange,
  template = null,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: Template | null;
  initial?: TemplateInput;
}) {
  const t = useTranslations("templates");
  const tc = useTranslations("common");
  const start: TemplateInput = template
    ? {
        name: template.name,
        subject: template.subject,
        body_html: template.body_html,
      }
    : (initial ?? { name: "", subject: "", body_html: "" });
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={template ? t("editTitle") : t("newTitle")}
      closeLabel={tc("close")}
      className="md:w-[min(40rem,calc(100vw-3rem))]"
    >
      {open ? (
        <EditorForm
          key={template?.id ?? "new"}
          template={template}
          initial={start}
          onDone={() => onOpenChange(false)}
          onCancel={() => onOpenChange(false)}
        />
      ) : null}
    </ResponsiveDialog>
  );
}
