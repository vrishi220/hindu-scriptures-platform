import { afterEach, describe, expect, it } from "vitest";

import {
  UI_PREFERENCES_STORAGE_KEY,
  applyUiPreferencesToDocument,
  persistUiPreferences,
  readStoredUiPreferences,
} from "./uiPreferences";

describe("uiPreferences", () => {
  afterEach(() => {
    window.localStorage.clear();
    delete document.body.dataset.uiTheme;
    delete document.body.dataset.uiDensity;
  });

  it("persists and reads normalized theme and density", () => {
    persistUiPreferences({ ui_theme: "SLATE", ui_density: "compact" });

    const stored = readStoredUiPreferences();

    expect(stored).toEqual({ ui_theme: "slate", ui_density: "compact" });
  });

  it("applies normalized preferences to document body dataset", () => {
    applyUiPreferencesToDocument({ ui_theme: "minimal", ui_density: "CoMfoRtaBle" });

    expect(document.body.dataset.uiTheme).toBe("minimal");
    expect(document.body.dataset.uiDensity).toBe("comfortable");
  });

  it("clears invalid stored payloads", () => {
    window.localStorage.setItem(UI_PREFERENCES_STORAGE_KEY, "{broken-json");

    const stored = readStoredUiPreferences();

    expect(stored).toBeNull();
    expect(window.localStorage.getItem(UI_PREFERENCES_STORAGE_KEY)).toBeNull();
  });
});
