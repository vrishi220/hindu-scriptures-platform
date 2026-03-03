export type UiThemePreference = "classic" | "minimal" | "slate";
export type UiDensityPreference = "comfortable" | "compact";

export const UI_PREFERENCES_STORAGE_KEY = "hsp_ui_preferences";

const VALID_UI_THEMES: ReadonlySet<UiThemePreference> = new Set([
  "classic",
  "minimal",
  "slate",
]);

const VALID_UI_DENSITIES: ReadonlySet<UiDensityPreference> = new Set([
  "comfortable",
  "compact",
]);

export const normalizeUiTheme = (value: unknown): UiThemePreference => {
  if (typeof value !== "string") return "classic";
  const normalized = value.trim().toLowerCase();
  return VALID_UI_THEMES.has(normalized as UiThemePreference)
    ? (normalized as UiThemePreference)
    : "classic";
};

export const normalizeUiDensity = (value: unknown): UiDensityPreference => {
  if (typeof value !== "string") return "comfortable";
  const normalized = value.trim().toLowerCase();
  return VALID_UI_DENSITIES.has(normalized as UiDensityPreference)
    ? (normalized as UiDensityPreference)
    : "comfortable";
};

export const applyUiPreferencesToDocument = (preferences: {
  ui_theme?: unknown;
  ui_density?: unknown;
} | null | undefined) => {
  if (typeof document === "undefined") return;
  if (!preferences) return;
  const theme = normalizeUiTheme(preferences?.ui_theme);
  const density = normalizeUiDensity(preferences?.ui_density);
  document.body.dataset.uiTheme = theme;
  document.body.dataset.uiDensity = density;
};

export const persistUiPreferences = (preferences: {
  ui_theme?: unknown;
  ui_density?: unknown;
} | null | undefined) => {
  if (typeof window === "undefined") return;
  const payload = {
    ui_theme: normalizeUiTheme(preferences?.ui_theme),
    ui_density: normalizeUiDensity(preferences?.ui_density),
  };
  window.localStorage.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify(payload));
};

export const readStoredUiPreferences = (): {
  ui_theme: UiThemePreference;
  ui_density: UiDensityPreference;
} | null => {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(UI_PREFERENCES_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { ui_theme?: unknown; ui_density?: unknown };
    return {
      ui_theme: normalizeUiTheme(parsed.ui_theme),
      ui_density: normalizeUiDensity(parsed.ui_density),
    };
  } catch {
    window.localStorage.removeItem(UI_PREFERENCES_STORAGE_KEY);
    return null;
  }
};
