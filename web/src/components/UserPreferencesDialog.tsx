"use client";

import {
  isRomanScript,
  normalizeTransliterationScript,
} from "../lib/indicScript";

export type UserPreferences = {
  source_language: string;
  transliteration_enabled: boolean;
  transliteration_script: string;
  show_roman_transliteration: boolean;
};

type UserPreferencesDialogProps = {
  open: boolean;
  onClose: () => void;
  preferences: UserPreferences | null;
  onChange: (next: UserPreferences) => void;
  onSave: () => void;
  saving: boolean;
  message: string | null;
};

export default function UserPreferencesDialog({
  open,
  onClose,
  preferences,
  onChange,
  onSave,
  saving,
  message,
}: UserPreferencesDialogProps) {
  if (!open || !preferences) return null;

  const transliterationEnabled = preferences.transliteration_enabled;
  const transliterationScript = normalizeTransliterationScript(
    preferences.transliteration_script
  );
  const scriptPrefersRoman = isRomanScript(transliterationScript);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-3xl border border-black/10 bg-white/95 p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
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

        <div className="grid gap-3 sm:grid-cols-2">
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
              <option value="sanskrit">Sanskrit</option>
              <option value="hindi">Hindi</option>
              <option value="english">English</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
              Transliteration script
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
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={onSave}
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
