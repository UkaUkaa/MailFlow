export interface EmailDocumentOptions {
  allowRemoteImages: boolean;
  /** Colours taken from the app theme, used when the email brings no colours of its own. */
  foreground: string;
  linkColor: string;
  mutedColor: string;
  borderColor: string;
  /** Inner padding of the light "paper" surface; only needed where it is visible (dark theme). */
  paperPadding?: number;
  /** Hide the quoted history at the end of the message (see `markQuotedHistory`). */
  collapseQuotes?: boolean;
  /** Base text size in px (Settings → Interface); the email's own sizes still win. */
  fontSize?: number;
  /** The app's resolved theme. A themed email uses exactly this scheme (see `emailColorScheme`). */
  theme: "light" | "dark";
}

/**
 * The single colour scheme of the frame. It must be one scheme, never "light dark": a frame whose
 * scheme differs from the page's gets an opaque system backdrop (black on an iPhone in dark mode)
 * under text coloured for the app theme. The iframe element is given the same scheme.
 */
export function emailColorScheme(html: string, theme: "light" | "dark"): "light" | "dark" {
  return emailFollowsTheme(html) ? theme : "light";
}

const OWN_COLOURS = /\bbgcolor\s*=|\bbackground(?:-color)?\s*:|(?:^|[\s;"'])color\s*:|<font\b[^>]*\bcolor\s*=/i;

/**
 * Emails without any colour declarations can safely follow the app theme.
 * Anything styled by its author is shown on a light "paper" surface so that
 * hard-coded dark text never lands on a dark background.
 */
export function emailFollowsTheme(html: string): boolean {
  return !OWN_COLOURS.test(html);
}

export function contentSecurityPolicy(allowRemoteImages: boolean): string {
  const images = allowRemoteImages ? "data: cid: https: http:" : "data: cid:";
  return [
    "default-src 'none'",
    `img-src ${images}`,
    "style-src 'unsafe-inline'",
    "font-src data:",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
  ].join("; ");
}

const LOCAL_SOURCE = /^\s*(data:|cid:)/i;

/**
 * Removes every remote image reference from the markup. The CSP below already
 * blocks these fetches; stripping the URLs as well means a tracking pixel has
 * no way to load even if a browser applied the policy late.
 */
export function stripRemoteImages(html: string): string {
  if (typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, "text/html");
  for (const element of Array.from(doc.body.querySelectorAll("img, source, video, input, [background]"))) {
    for (const attribute of ["src", "poster", "background"]) {
      const value = element.getAttribute(attribute);
      if (value !== null && !LOCAL_SOURCE.test(value)) element.removeAttribute(attribute);
    }
    element.removeAttribute("srcset");
  }
  return doc.body.innerHTML;
}

const QUOTE_SELECTOR = "blockquote, .gmail_quote, .yahoo_quoted";
const QUOTE_ATTRIBUTE = "data-mf-quote";

function hasContent(node: Node): boolean {
  if (node.nodeType === 3) return Boolean(node.textContent?.trim());
  if (node.nodeType !== 1) return false;
  const element = node as Element;
  return Boolean(element.textContent?.trim()) || element.querySelector("img[alt]:not([alt='']), table") !== null;
}

/** Nothing readable follows the element, at any level up to the body (other quotes do not count). */
function isTrailing(element: Element, root: Element): boolean {
  for (let node: Element | null = element; node && node !== root; node = node.parentElement) {
    for (let sibling = node.nextSibling; sibling; sibling = sibling.nextSibling) {
      if (sibling.nodeType === 1 && (sibling as Element).matches(QUOTE_SELECTOR)) continue;
      if (hasContent(sibling)) return false;
    }
  }
  return true;
}

/**
 * Finds the quoted history of a reply: quote blocks that close the message, when the message
 * also has text of its own. They are only *marked* (`data-mf-quote`); the document's own style
 * sheet hides marked blocks while collapsed. Quotes in the middle of a message (inline
 * replies) and messages that consist of nothing but a quote are left alone. Works on the
 * already-sanitized markup and adds no capability to the frame.
 */
export function markQuotedHistory(html: string): { html: string; hasQuote: boolean } {
  if (typeof DOMParser === "undefined" || !/<blockquote|gmail_quote|yahoo_quoted/i.test(html)) return { html, hasQuote: false };
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, "text/html");
  const body = doc.body;
  // The attribute is ours: an email cannot use it to pre-hide its own content.
  for (const element of Array.from(body.querySelectorAll(`[${QUOTE_ATTRIBUTE}]`))) element.removeAttribute(QUOTE_ATTRIBUTE);
  const quotes = Array.from(body.querySelectorAll(QUOTE_SELECTOR)).filter(
    (element) => !element.parentElement?.closest(QUOTE_SELECTOR) && hasContent(element) && isTrailing(element, body),
  );
  if (quotes.length === 0) return { html, hasQuote: false };
  const own = body.cloneNode(true) as Element;
  for (const element of Array.from(own.querySelectorAll(QUOTE_SELECTOR))) element.remove();
  if (!own.textContent?.trim()) return { html, hasQuote: false };
  for (const element of quotes) element.setAttribute(QUOTE_ATTRIBUTE, "");
  return { html: body.innerHTML, hasQuote: true };
}

export function hasQuotedHistory(html: string): boolean {
  return markQuotedHistory(html).hasQuote;
}

/**
 * Wraps already-sanitized email HTML in a standalone document for the sandboxed
 * iframe. Scripts never run (no `allow-scripts`), and the CSP blocks every
 * network fetch except, when the user opted in, images.
 */
export function buildEmailDocument(html: string, options: EmailDocumentOptions): string {
  const themed = emailFollowsTheme(html);
  const content = markQuotedHistory(options.allowRemoteImages ? html : stripRemoteImages(html)).html;
  const foreground = themed ? options.foreground : "#17181c";
  const link = themed ? options.linkColor : "#3355e0";
  const muted = themed ? options.mutedColor : "#5d5f6b";
  const border = themed ? options.borderColor : "#d2d2d9";
  const scheme = emailColorScheme(html, options.theme);
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(options.allowRemoteImages)}">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="${scheme}">
<base target="_blank">
<style>
html{overflow:hidden;background:transparent;color-scheme:${scheme}}
body{margin:0;padding:${themed ? 0 : (options.paperPadding ?? 0)}px;font:${options.fontSize ?? 15}px/1.6 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:${foreground};background:${themed ? "transparent" : "#ffffff"};overflow-wrap:anywhere;word-break:break-word;-webkit-text-size-adjust:100%}
img,video{max-width:100%;height:auto}
a{color:${link}}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em}
blockquote{margin:.75em 0;padding:0 0 0 .9em;border-left:2px solid ${border};color:${muted}}
table{border-collapse:collapse}
p{margin:0 0 .75em}
hr{border:0;border-top:1px solid ${border}}${options.collapseQuotes ? "\n[data-mf-quote]{display:none}" : ""}
</style></head><body>${content}</body></html>`;
}
