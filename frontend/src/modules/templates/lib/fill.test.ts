import { describe, expect, it } from "vitest";
import { fillHtml, fillText, placeholderValues } from "./fill";

const now = new Date(2026, 10, 18, 12);

describe("template placeholders", () => {
  it("fills what is known and leaves the rest for the user", () => {
    const values = placeholderValues({
      recipient: { email: "olena@example.com", name: "Olena Kovalenko" },
      myName: "Sasha",
      locale: "en",
      now,
    });
    expect(fillText("Hi {{first_name}}, from {{ my_name }} ({{unknown}})", values)).toBe("Hi Olena, from Sasha ({{unknown}})");
    expect(fillText("{{name}} <{{email}}> on {{date}}", values)).toBe("Olena Kovalenko <olena@example.com> on November 18, 2026");
  });

  it("keeps name placeholders when the recipient has no name", () => {
    const values = placeholderValues({
      recipient: { email: "x@example.com", name: null },
      myName: "",
      locale: "uk",
      now,
    });
    expect(fillText("Привіт, {{first_name}}! {{my_name}}", values)).toBe("Привіт, {{first_name}}! {{my_name}}");
    expect(values.date).toContain("2026");
  });

  it("escapes values inserted into HTML", () => {
    const values = placeholderValues({
      recipient: { email: "a@b.c", name: '<img src=x onerror="1">' },
      myName: "",
      locale: "en",
      now,
    });
    expect(fillHtml("<p>Hi {{name}}</p>", values)).toBe("<p>Hi &lt;img src=x onerror=&quot;1&quot;&gt;</p>");
  });
});
