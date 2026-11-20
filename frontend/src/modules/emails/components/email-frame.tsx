"use client";

import { Ellipsis, Maximize2, Minimize2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/infrastructure/theme";
import { useRootDataset } from "@/shared/hooks/use-root-dataset";
import { READER_FONT_SIZE, READER_TEXT_SIZES, type ReaderTextSize } from "@/shared/lib/interface-preferences";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/cn";
import { buildEmailDocument, emailColorScheme, emailFollowsTheme, hasQuotedHistory } from "../lib/email-document";

function themeColor(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/**
 * Renders untrusted (server-sanitized) email HTML in an isolated iframe.
 * The frame is always exactly as wide as its container; content that is wider
 * is scaled down to fit, with an opt-in to view it at original size inside a
 * horizontally scrollable region. The email can never widen the page.
 * Quoted history at the end of a reply starts collapsed behind a "•••" toggle;
 * the toggle only switches a rule in the frame's own style sheet.
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
  const [quotesShown, setQuotesShown] = useState(false);
  const hasQuote = useMemo(() => hasQuotedHistory(html), [html]);

  // Interface preferences: accent (link colour) and base text size. Read from <html> so the
  // frame is rebuilt when either changes.
  const accent = useRootDataset("accent");
  const textSize = useRootDataset("readerText");
  const fontSize = READER_FONT_SIZE[READER_TEXT_SIZES.includes(textSize as ReaderTextSize) ? (textSize as ReaderTextSize) : "default"];

  const themed = emailFollowsTheme(html);
  const theme = resolvedTheme === "dark" ? "dark" : "light";
  const srcDoc = useMemo(
    () =>
      buildEmailDocument(html, {
        allowRemoteImages,
        foreground: themeColor("--foreground", resolvedTheme === "dark" ? "#ededf0" : "#17181c"),
        linkColor: themeColor("--accent", "#3355e0"),
        mutedColor: themeColor("--foreground-muted", "#5d5f6b"),
        borderColor: themeColor("--border-strong", "#d2d2d9"),
        paperPadding: resolvedTheme === "dark" ? 16 : 0,
        collapseQuotes: !quotesShown,
        fontSize,
        theme,
      }),
    // `accent` is read through `themeColor("--accent")`; it is listed so the link colour follows it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [html, allowRemoteImages, resolvedTheme, quotesShown, fontSize, accent],
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

  // The document listeners outlive a change of `measure`; they always call the current one.
  const measureRef = useRef(measure);
  useEffect(() => {
    measureRef.current = measure;
  }, [measure]);
  const prepared = useRef(new WeakSet<Document>());

  /**
   * Sets up a newly parsed email document and fits it. Returns false while the email's own
   * document is not parsed yet. Runs once the markup is there, not on the frame's `load`: that
   * waits for every image, and one slow remote image (a tracker on a dead host) would leave a
   * wide email unscaled and the frame at its placeholder height for as long as it hangs.
   */
  const prepare = useCallback((): boolean => {
    const doc = frameRef.current?.contentDocument;
    if (!doc || doc.URL !== "about:srcdoc" || doc.readyState === "loading" || !doc.body) return false;
    if (!prepared.current.has(doc)) {
      prepared.current.add(doc);
      for (const anchor of Array.from(doc.querySelectorAll("a[href]"))) {
        anchor.setAttribute("target", "_blank");
        anchor.setAttribute("rel", "noopener noreferrer nofollow");
      }
      // Images finishing late change the height.
      doc.addEventListener("load", () => measureRef.current(), true);
    }
    measureRef.current();
    return true;
  }, []);

  const handleLoad = useCallback(() => {
    prepare();
  }, [prepare]);

  // A new srcDoc replaces the document; pick up the new one as soon as it is parsed. Until
  // then `contentDocument` is still the previous (already prepared) one, so wait for a new one.
  useEffect(() => {
    let frameId = 0;
    const deadline = performance.now() + 10_000;
    const tick = () => {
      const doc = frameRef.current?.contentDocument;
      const fresh = doc && !prepared.current.has(doc);
      if (fresh && prepare()) return;
      if (performance.now() < deadline) frameId = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frameId);
  }, [srcDoc, prepare]);

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
          style={{ height, width: showOriginal ? naturalWidth : "100%", colorScheme: emailColorScheme(html, theme) }}
        />
      </div>
      {hasQuote ? (
        <button
          type="button"
          aria-expanded={quotesShown}
          aria-label={quotesShown ? t("hideQuoted") : t("showQuoted")}
          title={quotesShown ? t("hideQuoted") : t("showQuoted")}
          onClick={() => setQuotesShown((value) => !value)}
          className="relative mt-2 inline-flex h-5 w-8 items-center justify-center rounded-sm bg-muted text-foreground-muted hover:bg-border hover:text-foreground touch:after:absolute touch:after:-inset-3 touch:after:content-['']"
        >
          <Ellipsis className="size-4" aria-hidden />
        </button>
      ) : null}
      {naturalWidth !== null ? (
        <div>
        <Button variant="ghost" size="sm" className="mt-2 -ml-2" onClick={() => setOriginalSize((value) => !value)}>
          {originalSize ? <Minimize2 className="size-4" aria-hidden /> : <Maximize2 className="size-4" aria-hidden />}
          {originalSize ? t("fitToScreen") : t("originalSize")}
        </Button>
        </div>
      ) : null}
    </div>
  );
}
