import { describe, expect, it } from "vitest";

import {
  hasDevanagariLetters,
  isRomanScript,
  normalizeTransliterationScript,
  transliterateFromDevanagari,
  transliterateFromIast,
  transliterationScriptLabel,
} from "./indicScript";

describe("indicScript", () => {
  it("normalizes script aliases and defaults", () => {
    expect(normalizeTransliterationScript("deva")).toBe("devanagari");
    expect(normalizeTransliterationScript("hk")).toBe("harvard_kyoto");
    expect(normalizeTransliterationScript("unknown")).toBe("iast");
  });

  it("detects roman script options", () => {
    expect(isRomanScript("iast")).toBe(true);
    expect(isRomanScript("devanagari")).toBe(false);
  });

  it("detects devanagari letter presence", () => {
    expect(hasDevanagariLetters("धर्म")).toBe(true);
    expect(hasDevanagariLetters("dharma")).toBe(false);
  });

  it("transliterates between scripts", () => {
    expect(transliterateFromIast("dharma", "devanagari")).toBe("धर्म");
    expect(transliterateFromDevanagari("धर्म", "iast")).toBe("dharma");
  });

  it("returns display labels", () => {
    expect(transliterationScriptLabel("harvard_kyoto")).toBe("Harvard-Kyoto");
    expect(transliterationScriptLabel("oriya")).toBe("Odia");
  });
});