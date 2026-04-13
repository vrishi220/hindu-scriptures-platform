"use client";

import { useEffect, useMemo, useState } from "react";
import {
  INDIC_SCRIPT_OPTIONS,
  inferIndicScriptFromText,
  isRomanScript,
  type TransliterationScriptOption,
  hasDevanagariLetters,
  transliterateBetweenScripts,
  transliterateFromDevanagari,
  transliterateFromIast,
  transliterateLatinToDevanagari,
  transliterateLatinToIast,
} from "@/lib/indicScript";

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
  sourceDisplayScript: TransliterationScriptOption;
  onAddRow: (sourceLanguage: string, meaningLanguage: string) => void;
  onReplaceRows: (rows: WordMeaningRow[]) => void;
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

const autoFillSourcePair = (
  sourceScriptRaw: string,
  sourceTransliterationRaw: string
): { sourceScriptText: string; sourceTransliterationIast: string } => {
  const sourceScriptText = sourceScriptRaw.trim();
  const sourceTransliterationIast = sourceTransliterationRaw.trim();

  if (!sourceScriptText && !sourceTransliterationIast) {
    return { sourceScriptText: "", sourceTransliterationIast: "" };
  }

  if (sourceScriptText && sourceTransliterationIast) {
    return { sourceScriptText, sourceTransliterationIast };
  }

  if (!sourceScriptText && sourceTransliterationIast) {
    if (hasDevanagariLetters(sourceTransliterationIast)) {
      return {
        sourceScriptText: sourceTransliterationIast,
        sourceTransliterationIast: transliterateFromDevanagari(sourceTransliterationIast, "iast"),
      };
    }
    return {
      sourceScriptText: transliterateLatinToDevanagari(sourceTransliterationIast),
      sourceTransliterationIast: transliterateLatinToIast(sourceTransliterationIast),
    };
  }

  if (hasDevanagariLetters(sourceScriptText)) {
    return {
      sourceScriptText,
      sourceTransliterationIast: transliterateFromDevanagari(sourceScriptText, "iast"),
    };
  }

  return {
    sourceScriptText: transliterateLatinToDevanagari(sourceScriptText),
    sourceTransliterationIast: transliterateLatinToIast(sourceScriptText),
  };
};

export default function WordMeaningsEditor({
  rows,
  validationErrors,
  missingRequired,
  requiredLanguage,
  allowedMeaningLanguages,
  sourceDisplayScript,
  onAddRow,
  onReplaceRows,
  onMoveRow,
  onRemoveRow,
  onSourceFieldChange,
  onSelectMeaningLanguage,
  onMeaningTextChange,
}: WordMeaningsEditorProps) {
  const [editorMode, setEditorMode] = useState<"table" | "token">("token");
  const [tokenDraft, setTokenDraft] = useState("");
  const [tokenMessage, setTokenMessage] = useState<string | null>(null);

  const sourcePairFromDisplayInput = (
    value: string
  ): { sourceScriptText: string; sourceTransliterationIast: string } => {
    if (sourceDisplayScript === "devanagari") {
      return autoFillSourcePair(value, "");
    }
    if (sourceDisplayScript === "iast") {
      return autoFillSourcePair("", value);
    }
    if (!isRomanScript(sourceDisplayScript)) {
      return autoFillSourcePair(
        transliterateBetweenScripts(value, sourceDisplayScript, "devanagari"),
        transliterateBetweenScripts(value, sourceDisplayScript, "iast")
      );
    }
    return autoFillSourcePair("", transliterateLatinToIast(value));
  };

  const sourceDisplayValueFromRow = (row: WordMeaningRow): string => {
    const sourceScript = (row.sourceScriptText || "").trim();
    const rawSourceIast = (row.sourceTransliterationIast || "").trim();
    // IAST is Latin-only — discard if it contains Indic script characters (corrupt stored data)
    let sourceIast = rawSourceIast && !inferIndicScriptFromText(rawSourceIast) ? rawSourceIast : "";
    const sourceIndicScript = inferIndicScriptFromText(sourceScript);

    if (!sourceIast && sourceScript && sourceIndicScript) {
      if (sourceIndicScript === "devanagari") {
        sourceIast = transliterateFromDevanagari(sourceScript, "iast").trim();
      } else {
        sourceIast = transliterateBetweenScripts(sourceScript, sourceIndicScript, "iast").trim();
      }
    }

    if (!sourceIast && sourceScript) {
      if (hasDevanagariLetters(sourceScript)) {
        sourceIast = transliterateFromDevanagari(sourceScript, "iast").trim();
      } else {
        const inferredScript = inferIndicScriptFromText(sourceScript);
        if (inferredScript && inferredScript !== "devanagari") {
          const devanagariCandidate = transliterateBetweenScripts(
            sourceScript,
            inferredScript,
            "devanagari"
          ).trim();
          if (hasDevanagariLetters(devanagariCandidate)) {
            sourceIast = transliterateFromDevanagari(devanagariCandidate, "iast").trim();
          }
        }
        if (!sourceIast) {
          for (const scriptOption of INDIC_SCRIPT_OPTIONS) {
            if (scriptOption === "devanagari") continue;
            const devanagariCandidate = transliterateBetweenScripts(
              sourceScript,
              scriptOption,
              "devanagari"
            ).trim();
            if (!hasDevanagariLetters(devanagariCandidate)) {
              continue;
            }
            sourceIast = transliterateFromDevanagari(devanagariCandidate, "iast").trim();
            break;
          }
        }
      }
    }

    if (sourceDisplayScript === "devanagari") {
      return sourceScript;
    }
    if (!sourceIast && sourceScript && sourceIndicScript) {
      return transliterateBetweenScripts(sourceScript, sourceIndicScript, sourceDisplayScript);
    }
    if (!sourceIast) {
      return "";
    }
    return transliterateFromIast(sourceIast, sourceDisplayScript);
  };

  const effectiveSourceLanguage = "sa";
  const effectiveMeaningLanguage = requiredLanguage;
  const rowMeaningLanguages = useMemo(
    () =>
      Array.from(
        new Set([
          ...allowedMeaningLanguages,
          ...rows.flatMap((row) => Object.keys(row.meanings)),
        ])
      ),
    [allowedMeaningLanguages, rows]
  );

  useEffect(() => {
    if (editorMode !== "token") return;
    const serialized = rows
      .map((row) => {
        const source = (row.sourceScriptText || row.sourceTransliterationIast || "").trim();
        const sourceDisplay = sourceDisplayValueFromRow(row).trim();
        const meaning = (
          row.meanings[requiredLanguage] || ""
        ).trim();
        if (!sourceDisplay && !meaning) return "";
        return meaning ? `${sourceDisplay}=${meaning}` : sourceDisplay;
      })
      .filter(Boolean)
      .join("\n");
    setTokenDraft(serialized);
  }, [editorMode, rows, requiredLanguage, sourceDisplayScript]);

  const handleApplyTokenDraft = () => {
    const entries = tokenDraft
      .split(/\n|;/)
      .map((entry) => entry.trim())
      .filter(Boolean);

    const parsedRows: WordMeaningRow[] = entries
      .map((entry, index) => {
        const explicitDelimiterPair = entry.match(/^(.*?)\s*(?:=|:|\?)\s*(.+)$/);
        const whitespaceDelimitedPair = entry.match(/^(\S+)\s+(.+)$/);
        const source = (explicitDelimiterPair?.[1] || whitespaceDelimitedPair?.[1] || entry).trim();
        const meaning = (explicitDelimiterPair?.[2] || whitespaceDelimitedPair?.[2] || "").trim();
        if (!source) return null;
        const sourcePair = sourcePairFromDisplayInput(source);
        return {
          id: `wm_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`,
          order: index + 1,
          sourceLanguage: effectiveSourceLanguage,
          sourceScriptText: sourcePair.sourceScriptText,
          sourceTransliterationIast: sourcePair.sourceTransliterationIast,
          meanings: {
            [requiredLanguage]: meaning,
            ...(effectiveMeaningLanguage === requiredLanguage
              ? {}
              : { [effectiveMeaningLanguage]: meaning }),
          },
          activeMeaningLanguage: effectiveMeaningLanguage,
        };
      })
      .filter((row): row is WordMeaningRow => Boolean(row));

    if (parsedRows.length === 0) {
      setTokenMessage("No valid token rows found.");
      return;
    }

    if (rows.length > 0) {
      const confirmed = window.confirm(
        "Apply token edits will replace all existing word-meaning rows. Continue?"
      );
      if (!confirmed) {
        setTokenMessage("Apply cancelled. Existing rows were not changed.");
        return;
      }
    }

    onReplaceRows(parsedRows);
    setTokenMessage(
      parsedRows.length === 1
        ? "Applied token edits to 1 row."
        : `Applied token edits to ${parsedRows.length} rows.`
    );
  };

  return (
    <div className="mt-2 rounded-lg border border-black/10 bg-white/80 p-2 sm:p-3">
      <div className="mb-2 flex items-center justify-between gap-2 sm:mb-3 sm:gap-3">
        <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Word Meanings</div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-black/10 bg-white p-0.5">
            <button
              type="button"
              onClick={() => setEditorMode("table")}
              className={`rounded px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] ${
                editorMode === "table"
                  ? "bg-[color:var(--accent)]/10 text-[color:var(--accent)]"
                  : "text-zinc-600"
              }`}
            >
              Table
            </button>
            <button
              type="button"
              onClick={() => setEditorMode("token")}
              className={`rounded px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] ${
                editorMode === "token"
                  ? "bg-[color:var(--accent)]/10 text-[color:var(--accent)]"
                  : "text-zinc-600"
              }`}
            >
              Token
            </button>
          </div>
          <button
            type="button"
            onClick={() => onAddRow(effectiveSourceLanguage, requiredLanguage)}
            className="rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-700 transition hover:bg-zinc-50"
          >
            Add row
          </button>
        </div>
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

      {editorMode === "token" ? (
        <div className="rounded-lg border border-black/10 bg-white p-2 sm:p-3">
          <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-zinc-500">Token Editor (Primary)</div>
          <p className="mb-2 text-[11px] text-zinc-600">
            Enter one token per line or semicolon-separated tokens. Use `source=meaning` (also supports `:` or `?`, or whitespace).
          </p>
          <textarea
            value={tokenDraft}
            onChange={(event) => {
              setTokenDraft(event.target.value);
              setTokenMessage(null);
            }}
            rows={8}
            className="w-full rounded-lg border border-black/10 bg-white px-2.5 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
            placeholder="karma=action\nyoga=discipline"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="text-[11px] text-zinc-500">Apply replaces all existing rows in this editor.</div>
            <button
              type="button"
              onClick={handleApplyTokenDraft}
              disabled={!tokenDraft.trim()}
              className="rounded-lg border border-black/10 bg-white px-2 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 sm:text-[11px] sm:tracking-[0.18em]"
            >
              Apply Token Edits
            </button>
          </div>
          {tokenMessage && <div className="mt-2 text-[11px] text-zinc-600">{tokenMessage}</div>}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-zinc-500">No word-meaning rows yet.</p>
      ) : (
        <>
          <div className="space-y-2 md:hidden">
            {rows.map((row, index) => (
              <div key={row.id} className="rounded-lg border border-black/10 bg-white p-2">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">Row {index + 1}</div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onMoveRow(row.id, "up")}
                      disabled={index === 0}
                      className="rounded border border-black/10 px-1.5 py-0.5 text-[10px] text-zinc-600 disabled:opacity-40"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => onMoveRow(row.id, "down")}
                      disabled={index === rows.length - 1}
                      className="rounded border border-black/10 px-1.5 py-0.5 text-[10px] text-zinc-600 disabled:opacity-40"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveRow(row.id)}
                      className="rounded border border-red-200 px-1.5 py-0.5 text-[10px] text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  <input
                    type="text"
                    value={sourceDisplayValueFromRow(row)}
                    onChange={(event) => {
                      const nextPair = sourcePairFromDisplayInput(event.target.value);
                      onSourceFieldChange(row.id, "sourceLanguage", effectiveSourceLanguage);
                      onSourceFieldChange(row.id, "sourceScriptText", nextPair.sourceScriptText);
                      onSourceFieldChange(
                        row.id,
                        "sourceTransliterationIast",
                        nextPair.sourceTransliterationIast
                      );
                    }}
                    className="w-full rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm outline-none focus:border-[color:var(--accent)]"
                    placeholder={`Source (${sourceDisplayScript})`}
                  />
                  <input
                    type="text"
                    value={row.meanings[row.activeMeaningLanguage] || ""}
                    onChange={(event) => {
                      onMeaningTextChange(row.id, row.activeMeaningLanguage, event.target.value);
                    }}
                    className="w-full rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm outline-none focus:border-[color:var(--accent)]"
                    placeholder={`Meaning (${row.activeMeaningLanguage})`}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="hidden overflow-x-auto rounded-lg border border-black/10 bg-white md:block">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="bg-zinc-50 text-left text-[11px] uppercase tracking-[0.14em] text-zinc-500">
                <th className="border-b border-black/10 px-2 py-2">#</th>
                <th className="border-b border-black/10 px-2 py-2">Source ({effectiveSourceLanguage})</th>
                <th className="border-b border-black/10 px-2 py-2">
                  Meaning ({effectiveMeaningLanguage}){effectiveMeaningLanguage === requiredLanguage ? "*" : ""}
                </th>
                <th className="border-b border-black/10 px-2 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id} className="align-top">
                  <td className="border-b border-black/10 px-2 py-2 text-xs text-zinc-500">{index + 1}</td>
                  <td className="border-b border-black/10 px-2 py-2">
                    <input
                      type="text"
                      value={sourceDisplayValueFromRow(row)}
                      onChange={(event) => {
                        const nextPair = sourcePairFromDisplayInput(event.target.value);
                        onSourceFieldChange(row.id, "sourceLanguage", effectiveSourceLanguage);
                        onSourceFieldChange(row.id, "sourceScriptText", nextPair.sourceScriptText);
                        onSourceFieldChange(
                          row.id,
                          "sourceTransliterationIast",
                          nextPair.sourceTransliterationIast
                        );
                      }}
                      className="w-full rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm outline-none focus:border-[color:var(--accent)]"
                      placeholder={`Source (${sourceDisplayScript})`}
                    />
                  </td>
                  <td className="border-b border-black/10 px-2 py-2">
                    <input
                      type="text"
                      value={row.meanings[row.activeMeaningLanguage] || ""}
                      onChange={(event) => {
                        onMeaningTextChange(row.id, row.activeMeaningLanguage, event.target.value);
                      }}
                      className="w-full rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm outline-none focus:border-[color:var(--accent)]"
                      placeholder={`Meaning (${row.activeMeaningLanguage})`}
                    />
                  </td>
                  <td className="border-b border-black/10 px-2 py-2">
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
                    <div className="mt-1 text-[10px] text-zinc-500">
                      Src: {row.sourceLanguage} | Meaning langs: {rowMeaningLanguages.filter((lang) => (row.meanings[lang] || "").trim()).join(", ") || "-"}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </div>
  );
}
