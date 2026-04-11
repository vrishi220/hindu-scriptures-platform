"use client";

import { useState } from "react";

type WordMeaningRow = {
  id: string;
  order: number;
  sourceLanguage: string;
  sourceScriptText: string;
  sourceTransliterationIast: string;
  meanings: Record<string, string>;
  activeMeaningLanguage: string;
};

type WordMeaningsEditorProps = {
  rows: WordMeaningRow[];
  validationErrors: string[];
  missingRequired: boolean;
  requiredLanguage: string;
  allowedMeaningLanguages: readonly string[];
  onAddRow: () => void;
  onImportSemicolonSeparated: (value: string, meaningLanguage: string) => number;
  onMoveRow: (rowId: string, direction: "up" | "down") => void;
  onRemoveRow: (rowId: string) => void;
  onSourceFieldChange: (
    rowId: string,
    key: "sourceLanguage" | "sourceScriptText" | "sourceTransliterationIast",
    value: string
  ) => void;
  onSelectMeaningLanguage: (rowId: string, language: string) => void;
  onMeaningTextChange: (rowId: string, language: string, value: string) => void;
};

export default function WordMeaningsEditor({
  rows,
  validationErrors,
  missingRequired,
  requiredLanguage,
  allowedMeaningLanguages,
  onAddRow,
  onImportSemicolonSeparated,
  onMoveRow,
  onRemoveRow,
  onSourceFieldChange,
  onSelectMeaningLanguage,
  onMeaningTextChange,
}: WordMeaningsEditorProps) {
  const [semicolonInput, setSemicolonInput] = useState("");
  const [semicolonMessage, setSemicolonMessage] = useState<string | null>(null);
  const [semicolonMeaningLanguage, setSemicolonMeaningLanguage] = useState(requiredLanguage);

  const handleImport = () => {
    const importedCount = onImportSemicolonSeparated(semicolonInput, semicolonMeaningLanguage);
    if (importedCount > 0) {
      setSemicolonMessage(
        importedCount === 1 ? "Added 1 word-meaning row." : `Added ${importedCount} word-meaning rows.`
      );
      setSemicolonInput("");
      return;
    }

    setSemicolonMessage("No valid semicolon-separated entries found.");
  };

  return (
    <div className="mt-2 rounded-lg border border-black/10 bg-white/80 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Word Meanings</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onAddRow}
            className="rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-700 transition hover:bg-zinc-50"
          >
            Add row
          </button>
        </div>
      </div>
      <div className="mb-3 rounded-lg border border-black/10 bg-white p-3">
        <div className="mb-1 text-xs uppercase tracking-[0.16em] text-zinc-500">
          Semicolon Import
        </div>
        <p className="mb-2 text-xs text-zinc-600">
          Paste `word=meaning; word2:meaning2; word3?meaning3` or `word1; word2` to create rows, then refine them below.
        </p>
        <textarea
          value={semicolonInput}
          onChange={(event) => {
            setSemicolonInput(event.target.value);
            setSemicolonMessage(null);
          }}
          rows={3}
          placeholder="karma=action; yoga:discipline; buddhi?intellect"
          className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="text-[11px] text-zinc-500">
            Existing rows stay editable after import.
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] uppercase tracking-[0.12em] text-zinc-500" htmlFor="semicolon-meaning-language">
              Meaning Language
            </label>
            <select
              id="semicolon-meaning-language"
              value={semicolonMeaningLanguage}
              onChange={(event) => setSemicolonMeaningLanguage(event.target.value)}
              className="rounded-lg border border-black/10 bg-white px-2 py-1.5 text-[11px] uppercase tracking-[0.12em] text-zinc-700 outline-none focus:border-[color:var(--accent)]"
            >
              {[...allowedMeaningLanguages].map((language) => (
                <option key={`semicolon_lang_${language}`} value={language}>
                  {language}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleImport}
              disabled={!semicolonInput.trim()}
              className="rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add tokens
            </button>
          </div>
        </div>
        {semicolonMessage && (
          <div className="mt-2 text-[11px] text-zinc-600">{semicolonMessage}</div>
        )}
      </div>
      {missingRequired && (
        <div className="mb-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
          English meaning is required for every filled row.
        </div>
      )}
      {validationErrors.length > 0 && (
        <div className="mb-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
          {`Validation: ${validationErrors[0]}`}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-xs text-zinc-500">No word-meaning rows yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <div key={row.id} className="rounded-lg border border-black/10 bg-white p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
                  Row {index + 1}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onMoveRow(row.id, "up")}
                    disabled={index === 0}
                    className="rounded border border-black/10 px-2 py-1 text-xs text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => onMoveRow(row.id, "down")}
                    disabled={index === rows.length - 1}
                    className="rounded border border-black/10 px-2 py-1 text-xs text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveRow(row.id)}
                    className="rounded border border-red-200 px-2 py-1 text-xs text-red-700 transition hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div>
                  <label className="text-xs uppercase tracking-[0.16em] text-zinc-500">
                    Source Language
                  </label>
                  <select
                    value={row.sourceLanguage}
                    onChange={(event) =>
                      onSourceFieldChange(row.id, "sourceLanguage", event.target.value)
                    }
                    className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                  >
                    <option value="sa">sa</option>
                    <option value="pi">pi</option>
                    <option value="hi">hi</option>
                    <option value="ta">ta</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs uppercase tracking-[0.16em] text-zinc-500">
                    Source (Script)
                  </label>
                  <input
                    type="text"
                    value={row.sourceScriptText}
                    onChange={(event) =>
                      onSourceFieldChange(row.id, "sourceScriptText", event.target.value)
                    }
                    className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                  />
                </div>

                <div>
                  <label className="text-xs uppercase tracking-[0.16em] text-zinc-500">
                    Source (IAST)
                  </label>
                  <input
                    type="text"
                    value={row.sourceTransliterationIast}
                    onChange={(event) =>
                      onSourceFieldChange(row.id, "sourceTransliterationIast", event.target.value)
                    }
                    className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                  />
                </div>
              </div>

              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className="text-xs uppercase tracking-[0.16em] text-zinc-500">Meanings</label>
                  {!(row.meanings[requiredLanguage] || "").trim() && (
                    <span className="text-[11px] font-medium text-red-600">English meaning required</span>
                  )}
                </div>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {[
                    ...allowedMeaningLanguages,
                    ...Object.keys(row.meanings).filter(
                      (language) => !allowedMeaningLanguages.includes(language)
                    ),
                  ].map((language) => {
                    const isActive = row.activeMeaningLanguage === language;
                    const hasText = Boolean((row.meanings[language] || "").trim());
                    const isRequired = language === requiredLanguage;
                    return (
                      <button
                        key={`${row.id}_${language}`}
                        type="button"
                        onClick={() => onSelectMeaningLanguage(row.id, language)}
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] transition ${
                          isActive
                            ? "border-[color:var(--accent)] bg-[color:var(--accent)]/10 text-[color:var(--accent)]"
                            : "border-black/10 bg-white text-zinc-600 hover:bg-zinc-50"
                        }`}
                      >
                        {language}
                        {isRequired ? "*" : ""}
                        {hasText ? " ✓" : ""}
                      </button>
                    );
                  })}
                </div>
                <input
                  type="text"
                  value={row.meanings[row.activeMeaningLanguage] || ""}
                  onChange={(event) =>
                    onMeaningTextChange(row.id, row.activeMeaningLanguage, event.target.value)
                  }
                  className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                  placeholder={`Meaning (${row.activeMeaningLanguage})${
                    row.activeMeaningLanguage === requiredLanguage ? " — required" : ""
                  }`}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
