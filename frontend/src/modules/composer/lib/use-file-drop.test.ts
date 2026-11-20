import { describe, expect, it } from "vitest";
import { carriesFiles } from "./use-file-drop";

const transfer = (types: string[]) => ({ types }) as unknown as DataTransfer;

describe("carriesFiles", () => {
  it("accepts drags of files from the operating system", () => {
    expect(carriesFiles(transfer(["Files"]))).toBe(true);
    expect(carriesFiles(transfer(["application/x-moz-file", "Files"]))).toBe(true);
  });

  it("ignores text, links and missing data", () => {
    expect(carriesFiles(transfer(["text/plain", "text/html"]))).toBe(false);
    expect(carriesFiles(transfer(["text/uri-list"]))).toBe(false);
    expect(carriesFiles(null)).toBe(false);
  });
});
