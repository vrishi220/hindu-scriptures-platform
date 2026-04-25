import { describe, expect, it } from "vitest";

import { canUseSparticuzChromium, getPdfBrowserExecutableCandidates } from "./pdfBrowserLaunch";

describe("pdfBrowserLaunch", () => {
  it("prefers configured executables before native macOS browser paths", () => {
    const candidates = getPdfBrowserExecutableCandidates("darwin", {
      PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: "/custom/chrome",
      CHROME_BIN: "",
      CHROMIUM_PATH: "/custom/chromium",
    });

    expect(candidates).toEqual([
      "/custom/chrome",
      "/custom/chromium",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ]);
  });

  it("uses Linux system browser paths on Linux", () => {
    const candidates = getPdfBrowserExecutableCandidates("linux", {});

    expect(candidates).toEqual([
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/google-chrome",
    ]);
  });

  it("only enables Sparticuz fallback on Linux", () => {
    expect(canUseSparticuzChromium("linux")).toBe(true);
    expect(canUseSparticuzChromium("darwin")).toBe(false);
    expect(canUseSparticuzChromium("win32")).toBe(false);
  });
});