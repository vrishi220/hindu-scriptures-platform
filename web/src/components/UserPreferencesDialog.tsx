"use client";

import { useEffect } from "react";

import {
  isRomanScript,
  normalizeTransliterationScript,
} from "../lib/indicScript";
import {
  normalizeUiDensity,
  normalizeUiTheme,
  type UiDensityPreference,
  type UiThemePreference,
} from "../lib/uiPreferences";

export type UserPreferences = {
  source_language: string;
  transliteration_enabled: boolean;
  transliteration_script: string;
  show_roman_transliteration: boolean;
  show_only_preferred_script: boolean;
  show_media: boolean;
  show_commentary: boolean;
  preview_show_titles: boolean;
  preview_show_labels: boolean;
  preview_show_level_numbers: boolean;
  preview_show_details: boolean;
  preview_show_media: boolean;
  preview_show_sanskrit: boolean;
  preview_show_transliteration: boolean;
  preview_show_english: boolean;
  preview_show_commentary: boolean;
  preview_transliteration_script: string;
  preview_word_meanings_display_mode: "inline" | "table" | "hide";
  preview_translation_languages: string;
  preview_hidden_levels: string;
  ui_theme: UiThemePreference;
  ui_density: UiDensityPreference;
  scriptures_book_browser_view?: "list" | "icon";
  scriptures_book_browser_density?: 0 | 1 | 2 | 3 | 4 | 5;
  scriptures_media_manager_view?: "list" | "icon";
  admin_media_bank_browser_view?: "list" | "icon";
};

type UserPreferencesDialogProps = {
  open: boolean;
  onClose: () => void;
  preferences: UserPreferences | null;
  onChange: (next: UserPreferences) => void;
  onSave: () => boolean | Promise<boolean>;
  saving: boolean;
  message: string | null;
};

type UserPreferencesFormProps = {
  preferences: UserPreferences;
  onChange: (next: UserPreferences) => void;
};

const THEME_PREVIEWS: Array<{
  key: UiThemePreference;
  label: string;
  bg: string;
  surface: string;
  accent: string;
}> = [
  {
    key: "classic",
    label: "Classic",
    bg: "#f7f4ef",
    surface: "#ffffff",
    accent: "#b33a2f",
  },
  {
    key: "minimal",
    label: "Minimal",
    bg: "#faf8f4",
    surface: "#ffffff",
    accent: "#a83a31",
  },
  {
    key: "slate",
    label: "Slate",
    bg: "#f2f4f7",
    surface: "#ffffff",
    accent: "#2e5f93",
  },
];

export function UserPreferencesForm({
  preferences,
  onChange,
}: UserPreferencesFormProps) {
  const uiTheme = normalizeUiTheme(preferences.ui_theme);
  const uiDensity = normalizeUiDensity(preferences.ui_density);
  const transliterationEnabled = preferences.transliteration_enabled;
  const transliterationScript = normalizeTransliterationScript(
    preferences.transliteration_script
  );
  const scriptPrefersRoman = isRomanScript(transliterationScript);

  return (
    <div className="grid gap-3">
      <div className="mt-1 border-t border-black/10 pt-3">
        <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
          Visual Theme
        </span>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
          Theme
        </span>
        <select
          value={uiTheme}
          onChange={(event) =>
            onChange({
              ...preferences,
              ui_theme: normalizeUiTheme(event.target.value),
            })
          }
          className="rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
        >
          <option value="classic">Classic</option>
          <option value="minimal">Minimal</option>
          <option value="slate">Slate</option>
        </select>
      </label>
      <div className="grid grid-cols-3 gap-2">
        {THEME_PREVIEWS.map((theme) => {
          const isActive = uiTheme === theme.key;
          return (
            <button
              key={theme.key}
              type="button"
              onClick={() =>
                onChange({
                  ...preferences,
                  ui_theme: theme.key,
                })
              }
              className={`rounded-lg border px-2 py-2 text-left transition ${
                isActive
                  ? "border-[color:var(--accent)] bg-[color:var(--accent)]/10"
                  : "border-black/10 bg-white hover:bg-zinc-50"
              }`}
            >
              <div
                className="mb-1.5 rounded-md border border-black/10 p-1"
                style={{ backgroundColor: theme.bg }}
              >
                <div
                  className="mb-1 h-1.5 rounded"
                  style={{ backgroundColor: theme.accent }}
                />
                <div
                  className="h-4 rounded border border-black/10"
                  style={{ backgroundColor: theme.surface }}
                />
              </div>
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-700">
                {theme.label}
              </div>
            </button>
          );
        })}
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
          Density
        </span>
        <select
          value={uiDensity}
          onChange={(event) =>
            onChange({
              ...preferences,
              ui_density: normalizeUiDensity(event.target.value),
            })
          }
          className="rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
        >
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
          Source language
        </span>
        <select
          value={preferences.source_language}
          onChange={(event) =>
            onChange({
              ...preferences,
              source_language: event.target.value,
            })
          }
          className="rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
        >
          <option value="english">English</option>
          <option value="hindi">Hindi</option>
          <option value="telugu">Telugu</option>
          <option value="kannada">Kannada</option>
          <option value="tamil">Tamil</option>
          <option value="malayalam">Malayalam</option>
          <option value="sanskrit">Sanskrit</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
          Transliteration
        </span>
        <select
          value={preferences.transliteration_script}
          onChange={(event) =>
            onChange({
              ...preferences,
              transliteration_script: normalizeTransliterationScript(
                event.target.value
              ),
            })
          }
          disabled={!transliterationEnabled}
          className="rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="iast">IAST</option>
          <option value="harvard_kyoto">Harvard-Kyoto</option>
          <option value="itrans">ITRANS</option>
          <option value="devanagari">Devanagari</option>
          <option value="bengali">Bengali</option>
          <option value="gujarati">Gujarati</option>
          <option value="gurmukhi">Gurmukhi</option>
          <option value="kannada">Kannada</option>
          <option value="malayalam">Malayalam</option>
          <option value="oriya">Odia</option>
          <option value="tamil">Tamil</option>
          <option value="telugu">Telugu</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          checked={transliterationEnabled}
          onChange={(event) =>
            onChange({
              ...preferences,
              transliteration_enabled: event.target.checked,
            })
          }
        />
        Enable transliteration
      </label>
      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          checked={preferences.show_roman_transliteration}
          disabled={!transliterationEnabled || !scriptPrefersRoman}
          onChange={(event) =>
            onChange({
              ...preferences,
              show_roman_transliteration: event.target.checked,
            })
          }
        />
        Show Roman transliteration
      </label>
      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          checked={preferences.show_only_preferred_script}
          onChange={(event) =>
            onChange({
              ...preferences,
              show_only_preferred_script: event.target.checked,
            })
          }
        />
        Show only preferred script
      </label>
      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          checked={preferences.show_media}
          onChange={(event) =>
            onChange({
              ...preferences,
              show_media: event.target.checked,
            })
          }
        />
        Show multimedia
      </label>
      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          checked={preferences.show_commentary}
          onChange={(event) =>
            onChange({
              ...preferences,
              show_commentary: event.target.checked,
            })
          }
        />
        Show commentary
      </label>

      <div className="mt-1 border-t border-black/10 pt-3">
        <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
          Preview Options
        </span>
      </div>
      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          checked={preferences.preview_show_titles}
          onChange={(event) =>
            onChange({
              ...preferences,
              preview_show_titles: event.target.checked,
            })
          }
        />
        Show titles
      </label>
      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          checked={preferences.preview_show_labels}
          onChange={(event) =>
            onChange({
              ...preferences,
              preview_show_labels: event.target.checked,
            })
          }
        />
        Show labels
      </label>
      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          checked={preferences.preview_show_level_numbers}
          onChange={(event) =>
            onChange({
              ...preferences,
              preview_show_level_numbers: event.target.checked,
            })
          }
        />
        Show level numbers
      </label>
      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          checked={preferences.preview_show_details}
          onChange={(event) =>
            onChange({
              ...preferences,
              preview_show_details: event.target.checked,
            })
          }
        />
        Show template details
      </label>
      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          checked={preferences.preview_show_media}
          onChange={(event) =>
            onChange({
              ...preferences,
              preview_show_media: event.target.checked,
            })
          }
        />
        Show multimedia
      </label>

      <div className="mt-1 border-t border-black/10 pt-3">
        <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
          Preview Languages
        </span>
      </div>
      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          checked={preferences.preview_show_sanskrit}
          onChange={(event) =>
            onChange({
              ...preferences,
              preview_show_sanskrit: event.target.checked,
            })
          }
        />
        Sanskrit
      </label>
      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          checked={preferences.preview_show_transliteration}
          onChange={(event) =>
            onChange({
              ...preferences,
              preview_show_transliteration: event.target.checked,
            })
          }
        />
        Transliteration
      </label>
      <label className="flex flex-col gap-1">
        <select
          value={preferences.preview_transliteration_script}
          onChange={(event) =>
            onChange({
              ...preferences,
              preview_transliteration_script: normalizeTransliterationScript(
                event.target.value
              ),
            })
          }
          disabled={!preferences.preview_show_transliteration}
          className="rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="iast">IAST</option>
          <option value="harvard_kyoto">Harvard-Kyoto</option>
          <option value="itrans">ITRANS</option>
          <option value="devanagari">Devanagari</option>
          <option value="bengali">Bengali</option>
          <option value="gujarati">Gujarati</option>
          <option value="gurmukhi">Gurmukhi</option>
          <option value="kannada">Kannada</option>
          <option value="malayalam">Malayalam</option>
          <option value="oriya">Odia</option>
          <option value="tamil">Tamil</option>
          <option value="telugu">Telugu</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          checked={preferences.preview_show_english}
          onChange={(event) =>
            onChange({
              ...preferences,
              preview_show_english: event.target.checked,
            })
          }
        />
        English
      </label>
      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          checked={preferences.preview_show_commentary}
          onChange={(event) =>
            onChange({
              ...preferences,
              preview_show_commentary: event.target.checked,
            })
          }
        />
        Commentaries
      </label>
    </div>
  );
}

export default function UserPreferencesDialog({
  open,
  onClose,
  preferences,
  onChange,
  onSave,
  saving,
  message,
}: UserPreferencesDialogProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [open]);

  if (!open || !preferences) return null;

  const handleSave = async () => {
    const saved = await onSave();
    if (saved) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-[color:var(--paper)] p-6 shadow-2xl">
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <h2 className="font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
            Display Preferences
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-2xl text-zinc-400 hover:text-zinc-600"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          <UserPreferencesForm preferences={preferences} onChange={onChange} />
        </div>

        <div className="mt-4 flex shrink-0 items-center gap-2 border-t border-black/10 pt-3">
          <button
            type="button"
            onClick={() => {
              void handleSave();
            }}
            disabled={saving}
            className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-3 py-2 text-xs font-medium uppercase tracking-[0.2em] text-white transition disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save prefs"}
          </button>
          {message && <span className="text-xs text-zinc-600">{message}</span>}
        </div>
      </div>
    </div>
  );
}
