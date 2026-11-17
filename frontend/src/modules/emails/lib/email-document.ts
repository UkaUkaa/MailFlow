export interface EmailDocumentOptions {
  allowRemoteImages: boolean;
  /** Colours taken from the app theme, used when the email brings no colours of its own. */
  foreground: string;
  linkColor: string;
  mutedColor: string;
  borderColor: string;
  /** Inner padding of the light "paper" surface; only needed where it is visible (dark theme). */
  paperPadding?: number;
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

/**
 * Wraps already-sanitized email HTML in a standalone document for the sandboxed
 * iframe. Scripts never run (no `allow-scripts`), and the CSP blocks every
 * network fetch except, when the user opted in, images.
 */
export function buildEmailDocument(html: string, options: EmailDocumentOptions): string {
  const themed = emailFollowsTheme(html);
  const content = options.allowRemoteImages ? html : stripRemoteImages(html);
  const foreground = themed ? options.foreground : "#17181c";
  const link = themed ? options.linkColor : "#3355e0";
  const muted = themed ? options.mutedColor : "#5d5f6b";
  const border = themed ? options.borderColor : "#d2d2d9";
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(options.allowRemoteImages)}">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="${themed ? "light dark" : "light"}">
<base target="_blank">
<style>
html{overflow:hidden;background:transparent}
body{margin:0;padding:${themed ? 0 : (options.paperPadding ?? 0)}px;font:15px/1.6 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:${foreground};background:${themed ? "transparent" : "#ffffff"};overflow-wrap:anywhere;word-break:break-word;-webkit-text-size-adjust:100%}
img,video{max-width:100%;height:auto}
a{color:${link}}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em}
blockquote{margin:.75em 0;padding:0 0 0 .9em;border-left:2px solid ${border};color:${muted}}
table{border-collapse:collapse}
p{margin:0 0 .75em}
hr{border:0;border-top:1px solid ${border}}
</style></head><body>${content}</body></html>`;
}
