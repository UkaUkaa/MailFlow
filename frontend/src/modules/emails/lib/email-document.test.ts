import { describe, expect, it } from "vitest";
import { buildEmailDocument, contentSecurityPolicy, emailFollowsTheme, stripRemoteImages } from "./email-document";

const options = { foreground: "#eee", linkColor: "#88f", mutedColor: "#aaa", borderColor: "#333" };

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
});
