"use client";

import { X } from "lucide-react";
import { useId, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { cn } from "@/shared/lib/cn";
import type { Address } from "@/shared/types/address";
import { dedupeRecipients, isValidEmail, parseRecipients } from "../lib/recipients";

export function RecipientsInput({
  label,
  value,
  onChange,
  removeLabel,
  invalidLabel,
  placeholder,
  hideLabel = false,
  autoFocus,
}: {
  label: string;
  value: Address[];
  onChange: (next: Address[]) => void;
  removeLabel: (email: string) => string;
  invalidLabel: string;
  /** Shown while the field is empty (the collapsed "To, Cc, Bcc" line). */
  placeholder?: string;
  /** Keeps the label for assistive technology only. */
  hideLabel?: boolean;
  autoFocus?: boolean;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");

  const commit = (raw: string): boolean => {
    const parsed = parseRecipients(raw);
    if (parsed.length === 0) return false;
    onChange(dedupeRecipients([...value, ...parsed]));
    setText("");
    return true;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if ((event.key === "Enter" || event.key === "," || event.key === ";" || event.key === " " || event.key === "Tab") && text.trim()) {
      // Tab keeps its default focus move; the others would otherwise type a separator.
      if (event.key !== "Tab") event.preventDefault();
      commit(text);
    } else if (event.key === "Backspace" && !text && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData("text");
    if (/[,;\s<]/.test(pasted.trim())) {
      event.preventDefault();
      commit(`${text} ${pasted}`);
    }
  };

  return (
    <div
      className="flex min-w-0 items-start gap-2 py-0.5"
      onClick={(event) => {
        if (event.target === event.currentTarget) inputRef.current?.focus();
      }}
    >
      <label
        htmlFor={id}
        className={cn("flex h-8 w-11 shrink-0 items-center text-sm text-foreground-subtle touch:h-10", hideLabel && "sr-only")}
      >
        {label}
      </label>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {value.map((address, index) => {
          const valid = isValidEmail(address.email);
          return (
            <span
              key={`${address.email}-${index}`}
              title={valid ? address.email : invalidLabel}
              className={cn(
                "inline-flex h-7 max-w-full min-w-0 items-center rounded-sm border pl-2 text-[13px] touch:h-9 touch:text-sm",
                valid ? "border-transparent bg-muted text-foreground" : "border-danger bg-danger-soft text-danger",
              )}
            >
              <span className="min-w-0 truncate">{address.name || address.email}</span>
              {!valid ? <span className="sr-only">{invalidLabel}</span> : null}
              <button
                type="button"
                aria-label={removeLabel(address.email)}
                onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm opacity-70 hover:opacity-100 touch:size-9"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </span>
          );
        })}
        <input
          id={id}
          ref={inputRef}
          type="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          value={text}
          placeholder={value.length === 0 ? placeholder : undefined}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => text.trim() && commit(text)}
          className="h-8 min-w-24 flex-1 basis-24 bg-transparent text-sm text-foreground outline-none placeholder:text-foreground-subtle touch:h-10"
        />
      </div>
    </div>
  );
}
