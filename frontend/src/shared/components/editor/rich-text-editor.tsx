"use client";

import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Italic, Link2, List, ListOrdered, Quote, Underline, Unlink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { cn } from "@/shared/lib/cn";

function ToolButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      // Keep the selection (and the mobile keyboard) while tapping toolbar buttons.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-foreground-muted hover:bg-muted hover:text-foreground touch:size-11 [&_svg]:size-4 touch:[&_svg]:size-[18px]",
        active && "bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent",
      )}
    >
      {children}
    </button>
  );
}

function normalizeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function EditorToolbar({ editor, className }: { editor: Editor | null; className?: string }) {
  const t = useTranslations("composer.format");
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive("bold") ?? false,
      italic: current?.isActive("italic") ?? false,
      underline: current?.isActive("underline") ?? false,
      bulletList: current?.isActive("bulletList") ?? false,
      orderedList: current?.isActive("orderedList") ?? false,
      blockquote: current?.isActive("blockquote") ?? false,
      link: current?.isActive("link") ?? false,
    }),
  });
  if (!editor) return <div className={cn("h-8 touch:h-11", className)} />;

  const applyLink = (event: FormEvent) => {
    event.preventDefault();
    const url = normalizeUrl(linkValue);
    if (url) editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    setLinkOpen(false);
    setLinkValue("");
  };

  if (linkOpen) {
    return (
      <form onSubmit={applyLink} className={cn("flex min-w-0 items-center gap-2", className)}>
        <input
          type="url"
          inputMode="url"
          autoFocus
          value={linkValue}
          onChange={(event) => setLinkValue(event.target.value)}
          placeholder="https://"
          aria-label={t("linkUrl")}
          className="h-8 min-w-0 flex-1 rounded-sm border border-border-strong bg-surface-raised px-2 text-sm outline-none focus-visible:border-accent touch:h-11"
        />
        <button type="submit" className="h-8 shrink-0 rounded-sm px-2 text-sm font-medium text-accent touch:h-11">
          {t("applyLink")}
        </button>
        <button
          type="button"
          onClick={() => setLinkOpen(false)}
          className="h-8 shrink-0 rounded-sm px-2 text-sm text-foreground-muted touch:h-11"
        >
          {t("cancelLink")}
        </button>
      </form>
    );
  }

  return (
    <div
      role="toolbar"
      aria-label={t("toolbar")}
      // The only horizontally scrollable strip in the composer, by design, for narrow phones.
      className={cn("flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]", className)}
    >
      <ToolButton label={t("bold")} active={state?.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold />
      </ToolButton>
      <ToolButton label={t("italic")} active={state?.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic />
      </ToolButton>
      <ToolButton label={t("underline")} active={state?.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <Underline />
      </ToolButton>
      <ToolButton label={t("bulletList")} active={state?.bulletList} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List />
      </ToolButton>
      <ToolButton label={t("orderedList")} active={state?.orderedList} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered />
      </ToolButton>
      <ToolButton label={t("quote")} active={state?.blockquote} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote />
      </ToolButton>
      {state?.link ? (
        <ToolButton label={t("removeLink")} active onClick={() => editor.chain().focus().unsetLink().run()}>
          <Unlink />
        </ToolButton>
      ) : (
        <ToolButton
          label={t("link")}
          onClick={() => {
            setLinkValue("");
            setLinkOpen(true);
          }}
        >
          <Link2 />
        </ToolButton>
      )}
    </div>
  );
}

export function useRichTextEditor({
  initialHtml,
  placeholder,
  ariaLabel,
  onChange,
}: {
  initialHtml: string;
  placeholder: string;
  ariaLabel: string;
  onChange: (html: string, isEmpty: boolean) => void;
}): Editor | null {
  return useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        horizontalRule: false,
        link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"] },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: initialHtml,
    editorProps: {
      attributes: { role: "textbox", "aria-multiline": "true", "aria-label": ariaLabel, class: "text-[15px] text-foreground md:text-sm md:leading-[22px]" },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML(), editor.isEmpty),
  });
}

export function RichTextArea({ editor, className }: { editor: Editor | null; className?: string }) {
  return <EditorContent editor={editor} className={cn("mf-editor min-w-0", className)} />;
}
