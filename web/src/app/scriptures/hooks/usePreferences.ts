"use client";

import { useState, useEffect } from "react";
import type { UserPreferences } from "../../../components/UserPreferencesDialog";
import {
  applyUiPreferencesToDocument,
  persistUiPreferences,
  normalizeUiTheme,
  normalizeUiDensity,
} from "../../../lib/uiPreferences";
import { normalizeTransliterationScript } from "../../../lib/indicScript";
import {
  normalizeSourceLanguage,
  normalizePreviewWordMeaningsDisplayMode,
  normalizeWordMeaningSourceLanguage,
  normalizeWordMeaningMeaningLanguage,
} from "../../../lib/previewUtils";
import {
  normalizeBrowserView,
  normalizeBookBrowserDensity,
} from "../../../lib/scriptureStorage";
import { LOCAL_SCRIPTURES_PREFERENCES_KEY } from "../../../lib/scriptureUtils";

export type StoredScripturesPreferences = {
  preferences?: Partial<UserPreferences>;
  show_only_preferred_script?: boolean;
};

export const normalizePreferences = (
  value: Partial<UserPreferences> | null | undefined,
): UserPreferences => ({
  source_language: normalizeSourceLanguage(value?.source_language),
  transliteration_enabled: value?.transliteration_enabled ?? true,
  transliteration_script: normalizeTransliterationScript(value?.transliteration_script),
  show_roman_transliteration: value?.show_roman_transliteration ?? true,
  show_only_preferred_script: value?.show_only_preferred_script ?? false,
  show_media: value?.show_media ?? true,
  show_commentary: value?.show_commentary ?? true,
  preview_show_titles: value?.preview_show_titles ?? false,
  preview_show_labels: value?.preview_show_labels ?? false,
  preview_show_level_numbers: value?.preview_show_level_numbers ?? false,
  preview_show_details: value?.preview_show_details ?? false,
  preview_show_media: value?.preview_show_media ?? true,
  preview_show_sanskrit: value?.preview_show_sanskrit ?? true,
  preview_show_transliteration: value?.preview_show_transliteration ?? true,
  preview_show_english: value?.preview_show_english ?? true,
  preview_show_commentary: value?.preview_show_commentary ?? true,
  preview_transliteration_script: normalizeTransliterationScript(
    value?.preview_transliteration_script,
  ),
  preview_word_meanings_display_mode: normalizePreviewWordMeaningsDisplayMode(
    value?.preview_word_meanings_display_mode,
  ),
  word_meanings_default_source_language: normalizeWordMeaningSourceLanguage(
    value?.word_meanings_default_source_language,
  ),
  word_meanings_default_meaning_language: normalizeWordMeaningMeaningLanguage(
    value?.word_meanings_default_meaning_language,
  ),
  preview_translation_languages:
    typeof value?.preview_translation_languages === "string"
      ? value.preview_translation_languages
      : "english",
  preview_hidden_levels:
    typeof value?.preview_hidden_levels === "string" ? value.preview_hidden_levels : "",
  ui_theme: normalizeUiTheme(value?.ui_theme),
  ui_density: normalizeUiDensity(value?.ui_density),
  scriptures_book_browser_view: normalizeBrowserView(value?.scriptures_book_browser_view),
  scriptures_book_browser_density: normalizeBookBrowserDensity(
    value?.scriptures_book_browser_density,
  ),
  scriptures_media_manager_view: normalizeBrowserView(value?.scriptures_media_manager_view),
  admin_media_bank_browser_view: normalizeBrowserView(value?.admin_media_bank_browser_view),
});

export function usePreferences(authEmail: string | null) {
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [preferencesSaving, setPreferencesSaving] = useState(false);
  const [preferencesMessage, setPreferencesMessage] = useState<string | null>(null);
  const [showPreferencesDialog, setShowPreferencesDialog] = useState(false);

  const savePreferences = async (nextPreferences?: UserPreferences | null): Promise<boolean> => {
    const preferencesToSave = normalizePreferences(nextPreferences ?? preferences);
    if (!preferencesToSave) return false;
    try {
      setPreferencesSaving(true);
      setPreferencesMessage(null);

      if (!authEmail && typeof window !== "undefined") {
        const toStore: StoredScripturesPreferences = {
          preferences: preferencesToSave,
        };
        window.localStorage.setItem(LOCAL_SCRIPTURES_PREFERENCES_KEY, JSON.stringify(toStore));
        persistUiPreferences(preferencesToSave);
      }

      if (authEmail) {
        const response = await fetch("/api/preferences", {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(preferencesToSave),
        });
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
        if (!response.ok) {
          throw new Error(payload?.detail || "Failed to save preferences");
        }
      }

      setPreferencesMessage("Preferences saved");
      return true;
    } catch (err) {
      setPreferencesMessage(err instanceof Error ? err.message : "Failed to save preferences");
      return false;
    } finally {
      setPreferencesSaving(false);
      setTimeout(() => setPreferencesMessage(null), 2000);
    }
  };

  useEffect(() => {
    applyUiPreferencesToDocument(preferences);
  }, [preferences]);

  return {
    preferences,
    setPreferences,
    preferencesSaving,
    preferencesMessage,
    showPreferencesDialog,
    setShowPreferencesDialog,
    savePreferences,
  };
}
