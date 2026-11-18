"use client";

import { group, segment } from "@/shared/components/ui/segmented";
import { cn } from "@/shared/lib/cn";

/** Segmented control with the same look as the theme and language switches. */
export function Choice<T extends string | number>({
  label,
  options,
  value,
  names,
  spokenNames,
  disabled,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T | undefined;
  names: (option: T) => string;
  /** Fuller names for assistive technology when the visible ones are abbreviated. */
  spokenNames?: (option: T) => string;
  disabled: boolean;
  onChange: (option: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className={cn(group, "w-full sm:w-auto")}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          aria-label={spokenNames?.(option)}
          disabled={disabled}
          onClick={() => onChange(option)}
          className={cn(segment, "disabled:opacity-50")}
        >
          <span className="truncate">{names(option)}</span>
        </button>
      ))}
    </div>
  );
}
