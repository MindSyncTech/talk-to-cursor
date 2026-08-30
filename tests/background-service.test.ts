import { describe, expect, it } from "vitest";
import { helperUpdateAvailable } from "../src/background-service.js";

describe("background helper version tracking", () => {
  it("treats pre-versioned and older installed helpers as outdated", () => {
    expect(helperUpdateAvailable(true, null, "1.3.0")).toBe(true);
    expect(helperUpdateAvailable(true, "1.2.0", "1.3.0")).toBe(true);
  });

  it("does not request an update for current, newer, or absent helpers", () => {
    expect(helperUpdateAvailable(true, "1.3.0", "1.3.0")).toBe(false);
    expect(helperUpdateAvailable(true, "1.4.0", "1.3.0")).toBe(false);
    expect(helperUpdateAvailable(false, null, "1.3.0")).toBe(false);
  });
});
