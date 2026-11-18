"use client";

import { ImagePlus, Pipette, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { ACCOUNT_COLORS, normalizeHexColor } from "@/shared/constants/account-colors";
import { cn } from "@/shared/lib/cn";
import { AVATAR_ACCEPT, AvatarImageError, prepareAvatar, type PreparedAvatar } from "../lib/avatar";
import { AccountDot } from "./account-dot";

/** What should happen to the mailbox picture when the dialog is saved. */
export type AvatarChange = { kind: "keep" } | { kind: "new"; prepared: PreparedAvatar } | { kind: "remove" };

interface AppearancePickerProps {
  color: string;
  onColorChange: (color: string) => void;
  /** The picture the mailbox has now, if any. */
  currentImageUrl: string | null;
  avatar: AvatarChange;
  onAvatarChange: (change: AvatarChange) => void;
  /** Label shown in the preview row. */
  previewLabel: string;
}

const SWATCH = "inline-flex size-11 items-center justify-center rounded-md hover:bg-muted";
const SWATCH_DISC = "relative inline-flex size-6 items-center justify-center rounded-full ring-offset-2 ring-offset-surface-raised";

/** Colour (presets, any RGB colour, hex code) and picture of a connected mailbox, with a preview. */
export function AppearancePicker({
  color,
  onColorChange,
  currentImageUrl,
  avatar,
  onAvatarChange,
  previewLabel,
}: AppearancePickerProps) {
  const t = useTranslations("accounts");
  const ids = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [hexText, setHexText] = useState(color);
  const [hexInvalid, setHexInvalid] = useState(false);
  const [pictureError, setPictureError] = useState<string | null>(null);
  const [colorFromPicture, setColorFromPicture] = useState(false);

  const isPreset = (ACCOUNT_COLORS as readonly string[]).includes(color);
  const imageUrl = avatar.kind === "new" ? avatar.prepared.previewUrl : avatar.kind === "remove" ? null : currentImageUrl;

  const pick = (value: string) => {
    onColorChange(value);
    setHexText(value);
    setHexInvalid(false);
    setColorFromPicture(false);
  };

  const onHexChange = (event: ChangeEvent<HTMLInputElement>) => {
    setHexText(event.target.value);
    const normalized = normalizeHexColor(event.target.value);
    setHexInvalid(normalized === null);
    if (normalized) {
      onColorChange(normalized);
      setColorFromPicture(false);
    }
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPictureError(null);
    try {
      const prepared = await prepareAvatar(file);
      onAvatarChange({ kind: "new", prepared });
      if (prepared.color) {
        pick(prepared.color);
        setColorFromPicture(true);
      }
    } catch (error) {
      setPictureError(
        error instanceof AvatarImageError && error.reason === "tooLarge" ? t("pictureTooLarge") : t("pictureUnsupported"),
      );
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-2 text-[13px] font-medium text-foreground">{t("picture")}</legend>
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex size-14 shrink-0 items-center justify-center rounded-full border border-border bg-surface">
            {imageUrl ? (
              <AccountDot color={color} imageUrl={imageUrl} imageClassName="size-14" />
            ) : (
              <AccountDot color={color} className="size-6" />
            )}
          </span>
          <div className="flex min-w-0 flex-wrap gap-2">
            <Button size="sm" onClick={() => fileInput.current?.click()}>
              <ImagePlus aria-hidden />
              {imageUrl ? t("pictureReplace") : t("pictureChoose")}
            </Button>
            {imageUrl ? (
              <Button size="sm" variant="ghost" onClick={() => onAvatarChange(currentImageUrl ? { kind: "remove" } : { kind: "keep" })}>
                <Trash2 aria-hidden />
                {t("pictureRemove")}
              </Button>
            ) : null}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept={AVATAR_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => void onFile(event)}
          />
        </div>
        <p className="text-xs text-foreground-muted">{t("pictureHint")}</p>
        {pictureError ? (
          <p role="alert" className="text-xs text-danger">
            {pictureError}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-2 text-[13px] font-medium text-foreground">{t("color")}</legend>
        <div className="flex flex-wrap gap-1">
          {ACCOUNT_COLORS.map((value, index) => (
            <button
              key={value}
              type="button"
              aria-label={t("colorOption", { index: index + 1 })}
              aria-pressed={color === value}
              onClick={() => pick(value)}
              className={SWATCH}
            >
              <span className={cn(SWATCH_DISC, color === value && "ring-2 ring-foreground")} style={{ backgroundColor: value }} />
            </button>
          ))}
          {/* Any RGB colour through the platform's own picker. The input covers the swatch so
              that a tap on it opens the picker on every platform. */}
          <span className={cn(SWATCH, "relative")}>
            <span
              aria-hidden
              className={cn(SWATCH_DISC, !isPreset && "ring-2 ring-foreground")}
              style={
                isPreset
                  ? { background: "conic-gradient(#e5484d, #f5d90a, #30a46c, #0091ff, #8e4ec6, #e5484d)" }
                  : { backgroundColor: color }
              }
            >
              <Pipette className={cn("size-3", isPreset ? "text-white" : "text-white mix-blend-difference")} />
            </span>
            <input
              type="color"
              value={color}
              aria-label={t("colorCustom")}
              onChange={(event) => pick(event.target.value.toLowerCase())}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
            />
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${ids}-hex`} className="text-xs text-foreground-muted">
            {t("colorHex")}
          </label>
          <Input
            id={`${ids}-hex`}
            value={hexText}
            maxLength={7}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={hexInvalid || undefined}
            aria-describedby={hexInvalid ? `${ids}-hex-error` : undefined}
            onChange={onHexChange}
            onBlur={() => {
              setHexText(color);
              setHexInvalid(false);
            }}
            className="w-32 font-mono"
          />
          {hexInvalid ? (
            <p id={`${ids}-hex-error`} className="text-xs text-danger">
              {t("colorHexInvalid")}
            </p>
          ) : colorFromPicture ? (
            <p className="text-xs text-foreground-muted">{t("colorFromPicture")}</p>
          ) : null}
        </div>
      </fieldset>

      <div className="flex min-w-0 flex-col gap-2">
        <span className="text-[13px] font-medium text-foreground">{t("preview")}</span>
        <div
          aria-hidden
          className="account-tint flex min-w-0 items-center gap-3 overflow-hidden rounded-md border border-border px-3 py-2.5"
          style={{ "--account-tint": color } as CSSProperties}
        >
          <AccountDot color={color} imageUrl={imageUrl} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-semibold text-foreground">{previewLabel}</span>
            <span className="truncate text-[13px] text-foreground-muted">{t("previewSubject")}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
