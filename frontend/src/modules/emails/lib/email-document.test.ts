import { describe, expect, it } from "vitest";
import {
  buildEmailDocument,
  contentSecurityPolicy,
  emailColorScheme,
  emailFollowsTheme,
  hasQuotedHistory,
  markQuotedHistory,
  stripRemoteImages,
} from "./email-document";

const options = { foreground: "#eee", linkColor: "#88f", mutedColor: "#aaa", borderColor: "#333", theme: "dark" as const };

describe("email document", () => {
  it("blocks remote images unless explicitly allowed", () => {
    expect(contentSecurityPolicy(false)).toContain("img-src data: cid:;");
    expect(contentSecurityPolicy(false)).not.toContain("https:");
    expect(contentSecurityPolicy(true)).toContain("img-src data: cid: https: http:");
  });

  it("never allows scripts, frames, forms or other network access", () => {
    for (const allow of [true, false]) {
      const policy = contentSecurityPolicy(allow);
      expect(policy).toContain("default-src 'none'");
      expect(policy).toContain("form-action 'none'");
      expect(policy).toContain("frame-src 'none'");
      expect(policy).not.toContain("script-src");
      expect(policy).not.toContain("connect-src");
    }
  });

  it("strips remote image URLs but keeps embedded ones", () => {
    const html =
      '<p>Hi</p><img src="https://tracker.example/p.gif" srcset="https://tracker.example/2x.gif 2x" alt="x">' +
      '<img src="data:image/png;base64,AAAA"><img src="cid:logo@example"><table background="http://t.example/bg.png"><tr><td>x</td></tr></table>';
    const stripped = stripRemoteImages(html);
    expect(stripped).not.toContain("tracker.example");
    expect(stripped).not.toContain("t.example");
    expect(stripped).toContain('src="data:image/png;base64,AAAA"');
    expect(stripped).toContain('src="cid:logo@example"');
    expect(stripped).toContain('alt="x"');
  });

  it("only includes remote image URLs after the user opted in", () => {
    const html = '<img src="https://images.example/photo.jpg">';
    expect(buildEmailDocument(html, { ...options, allowRemoteImages: false })).not.toContain("images.example");
    expect(buildEmailDocument(html, { ...options, allowRemoteImages: true })).toContain("images.example");
  });

  it("embeds the policy and the content", () => {
    const html = buildEmailDocument("<p>Hi</p>", { ...options, allowRemoteImages: false });
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain("<body><p>Hi</p></body>");
    expect(html).toContain('<base target="_blank">');
  });

  it("themes plain emails and keeps styled emails on light paper", () => {
    expect(emailFollowsTheme("<p>Hello <b>there</b></p>")).toBe(true);
    expect(emailFollowsTheme('<p style="color: #111">Hello</p>')).toBe(false);
    expect(emailFollowsTheme('<table bgcolor="#ffffff"><tr><td>x</td></tr></table>')).toBe(false);
    expect(emailFollowsTheme('<div style="background-color:#fff">x</div>')).toBe(false);

    const themed = buildEmailDocument("<p>Hello</p>", { ...options, allowRemoteImages: false });
    expect(themed).toContain("color:#eee;background:transparent");
    const paper = buildEmailDocument('<p style="color:#111">Hello</p>', { ...options, allowRemoteImages: false, paperPadding: 16 });
    expect(paper).toContain("padding:16px");
    expect(paper).toContain("color:#17181c;background:#ffffff");
  });

  // Regression: a template (plain rich text, no colours) declared "light dark". On an iPhone in
  // dark mode with MailFlow on the light theme the frame's scheme differed from the page's, so
  // Safari painted an opaque black backdrop under the light theme's near-black text.
  it("gives a themed email exactly the app's scheme, never both", () => {
    const template = "<p>Hello {{first_name}},</p><p>Thanks for <b>your order</b>.</p>";
    for (const theme of ["light", "dark"] as const) {
      const doc = buildEmailDocument(template, { ...options, theme, allowRemoteImages: false });
      expect(doc).toContain(`<meta name="color-scheme" content="${theme}">`);
      expect(doc).toContain(`color-scheme:${theme}`);
      expect(doc).not.toContain("light dark");
      expect(emailColorScheme(template, theme)).toBe(theme);
    }
  });

  it("keeps a styled email light in both themes", () => {
    const styled = '<p style="color:#111">Hello</p>';
    for (const theme of ["light", "dark"] as const) {
      const doc = buildEmailDocument(styled, { ...options, theme, allowRemoteImages: false });
      expect(doc).toContain('<meta name="color-scheme" content="light">');
      expect(emailColorScheme(styled, theme)).toBe("light");
    }
  });
});

describe("markQuotedHistory", () => {
  it("marks the quote that closes a reply and leaves the reply itself alone", () => {
    const { html, hasQuote } = markQuotedHistory("<p>Thanks!</p><blockquote><p>Earlier text</p></blockquote>");
    expect(hasQuote).toBe(true);
    expect(html).toBe('<p>Thanks!</p><blockquote data-mf-quote=""><p>Earlier text</p></blockquote>');
  });

  it("marks only the outermost quote and ignores a tracking pixel or blank lines after it", () => {
    const { html } = markQuotedHistory(
      '<p>Reply</p><div><blockquote>Outer<blockquote>Inner</blockquote></blockquote></div><br><img src="https://tracker.example/p.gif" alt="">',
    );
    expect(html.match(/data-mf-quote/g)).toHaveLength(1);
    expect(html).toContain('<blockquote data-mf-quote="">Outer<blockquote>Inner</blockquote></blockquote>');
  });

  it("does not hide a quote that is answered inline", () => {
    const source = "<p>Hi</p><blockquote>Question?</blockquote><p>My answer.</p>";
    expect(markQuotedHistory(source)).toEqual({ html: source, hasQuote: false });
  });

  it("marks several quotes when all of them close the message", () => {
    const { html } = markQuotedHistory("<p>Hi</p><blockquote>One</blockquote><blockquote>Two</blockquote>");
    expect(html.match(/data-mf-quote/g)).toHaveLength(2);
  });

  it("does not collapse a message that is nothing but a quote", () => {
    const source = "<blockquote>Forwarded text</blockquote>";
    expect(markQuotedHistory(source)).toEqual({ html: source, hasQuote: false });
  });

  it("does not let an email mark its own content as collapsed", () => {
    const { html, hasQuote } = markQuotedHistory('<p data-mf-quote="">Important</p><blockquote>Old</blockquote>');
    expect(hasQuote).toBe(true);
    expect(html).toBe('<p>Important</p><blockquote data-mf-quote="">Old</blockquote>');
    expect(hasQuotedHistory("<p>No quotes here</p>")).toBe(false);
  });

  it("hides marked quotes only while collapsed, without touching the policy", () => {
    const options = { allowRemoteImages: false, foreground: "#111", linkColor: "#00f", mutedColor: "#666", borderColor: "#ccc", theme: "light" as const };
    const html = "<p>Reply</p><blockquote>Old</blockquote>";
    const collapsed = buildEmailDocument(html, { ...options, collapseQuotes: true });
    const expanded = buildEmailDocument(html, { ...options, collapseQuotes: false });
    expect(collapsed).toContain("[data-mf-quote]{display:none}");
    expect(expanded).not.toContain("[data-mf-quote]{display:none}");
    expect(collapsed).toContain(contentSecurityPolicy(false));
    expect(collapsed).not.toContain("<script");
    expect(expanded).toContain('<blockquote data-mf-quote="">Old</blockquote>');
  });
});
