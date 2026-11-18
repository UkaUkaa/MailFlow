import { beforeEach, describe, expect, it } from "vitest";
import { addRecentSearch, clearRecentSearches, getRecentSearches } from "./recent-searches";

describe("recent searches", () => {
  beforeEach(() => {
    clearRecentSearches();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("keeps the newest first, without blanks or duplicates in another case", () => {
    addRecentSearch("invoice");
    addRecentSearch("  ");
    addRecentSearch("planning");
    addRecentSearch("Invoice");
    expect(getRecentSearches()).toEqual(["Invoice", "planning"]);
  });

  it("keeps at most six", () => {
    for (let index = 0; index < 9; index += 1) addRecentSearch(`query ${index}`);
    expect(getRecentSearches()).toHaveLength(6);
    expect(getRecentSearches()[0]).toBe("query 8");
  });

  it("never writes to browser storage", () => {
    addRecentSearch("private term");
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
