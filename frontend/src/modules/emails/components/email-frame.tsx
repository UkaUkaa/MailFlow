"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/infrastructure/theme";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/cn";
import { buildEmailDocument, emailFollowsTheme } from "../lib/email-document";

function themeColor(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/**
 * Renders untrusted (server-sanitized) email HTML in an isolated iframe.
 * The frame is always exactly as wide as its container; content that is wider
 * is scaled down to fit, with an opt-in to view it at original size inside a
 * horizontally scrollable region. The email can never widen the page.
 */
export function EmailFrame({
  html,
  allowRemoteImages,
  title,
}: {
  html: string;
  allowRemoteImages: boolean;
  title: string;
}) {
  const t = useTranslations("reader");
  const { resolvedTheme } = useTheme();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(120);
  const [naturalWidth, setNaturalWidth] = useState<number | null>(null);
  const [originalSize, setOriginalSize] = useState(false);

  const themed = emailFollowsTheme(html);
  const srcDoc = useMemo(
    () =>
      buildEmailDocument(html, {
        allowRemoteImages,
        foreground: themeColor("--foreground", resolvedTheme === "dark" ? "#ededf0" : "#17181c"),
        linkColor: themeColor("--accent", "#3355e0"),
        mutedColor: themeColor("--foreground-muted", "#5d5f6b"),
        borderColor: themeColor("--border-strong", "#d2d2d9"),
        paperPadding: resolvedTheme === "dark" ? 16 : 0,
      }),
    [html, allowRemoteImages, resolvedTheme],
  );

  const measure = useCallback(() => {
    const frame = frameRef.current;
    const wrapper = wrapperRef.current;
    const doc = frame?.contentDocument;
    const view = doc?.defaultView;
    if (!frame || !wrapper || !doc?.body || !view) return;
    const available = wrapper.clientWidth;
    if (available === 0) return;

    // Start from the unscaled layout.
    doc.body.style.zoom = "1";
    for (const element of Array.from(doc.querySelectorAll<HTMLElement>("[data-mf-scaled]"))) {
      element.style.zoom = "";
      delete element.dataset.mfScaled;
    }
    const contentWidth = doc.documentElement.scrollWidth;
    const overflowing = contentWidth > available + 1;
    setNaturalWidth(overflowing ? contentWidth : null);

    if (overflowing && !originalSize) {
      // Text keeps its size and wraps at the frame width; only the elements
      // that are too wide (typically layout tables) are scaled down.
      const padding = Number.parseFloat(view.getComputedStyle(doc.body).paddingLeft) || 0;
      const room = available - padding * 2;
      for (const table of Array.from(doc.querySelectorAll<HTMLElement>("table"))) {
        if (table.parentElement?.closest("table")) continue;
        if (table.offsetWidth > room + 1) {
          table.style.zoom = String(room / table.offsetWidth);
          table.dataset.mfScaled = "true";
        }
      }
      // Anything else still too wide: scale the whole document as a last resort.
      const remaining = doc.documentElement.scrollWidth;
      if (remaining > available + 1) doc.body.style.zoom = String(available / remaining);
    }
    setHeight(Math.ceil(doc.documentElement.scrollHeight));
  }, [originalSize]);

  const handleLoad = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    for (const anchor of Array.from(doc.querySelectorAll("a[href]"))) {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer nofollow");
    }
    // Images finishing late change the height.
    doc.addEventListener("load", measure, true);
    measure();
  }, [measure]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    measure();
  }, [measure, originalSize]);

  const showOriginal = originalSize && naturalWidth !== null;
  return (
    <div className="min-w-0">
      <div
        ref={wrapperRef}
        tabIndex={showOriginal ? 0 : undefined}
        className={cn(
          "w-full max-w-full min-w-0",
          showOriginal ? "scrollbar-thin overflow-x-auto" : "overflow-hidden",
          !themed && "dark:rounded-md",
        )}
      >
        <iframe
          ref={frameRef}
          title={title}
          srcDoc={srcDoc}
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          onLoad={handleLoad}
          className="block border-0"
          style={{ height, width: showOriginal ? naturalWidth : "100%" }}
        />
      </div>
      {naturalWidth !== null ? (
        <Button variant="ghost" size="sm" className="mt-2 -ml-2" onClick={() => setOriginalSize((value) => !value)}>
          {originalSize ? <Minimize2 className="size-4" aria-hidden /> : <Maximize2 className="size-4" aria-hidden />}
          {originalSize ? t("fitToScreen") : t("originalSize")}
        </Button>
      ) : null}
    </div>
  );
}
