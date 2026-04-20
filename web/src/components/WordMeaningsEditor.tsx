"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  autoEnterTableEdit?: boolean;
  initialEditorMode?: "table" | "token";
  onRequestClose?: () => void;
  blendWithParent?: boolean;
};

const HISTORY_LIMIT = 100;

const cloneRow = (row: WordMeaningRow): WordMeaningRow => ({
  ...row,
  meanings: { ...row.meanings },
});

const cloneRows = (rows: WordMeaningRow[]): WordMeaningRow[] => rows.map(cloneRow);

const normalizeRows = (rows: WordMeaningRow[]): WordMeaningRow[] =>
  rows.map((row, index) => ({
    ...cloneRow(row),
    order: index + 1,
  }));

const serializeRows = (rows: WordMeaningRow[]): string =>
  JSON.stringify(
    normalizeRows(rows).map((row) => ({
      ...row,
      meanings: Object.keys(row.meanings)
        .sort()
        .reduce<Record<string, string>>((acc, language) => {
          acc[language] = row.meanings[language] || "";
          return acc;
        }, {}),
    }))
  );

// Separator precedence: :, =, ?, -
// `:` and `-` count as delimiters only when separated from the key by whitespace,
// so embedded forms like `nama:` or `dharma-kshetre` are preserved in the key.
const WORD_MEANING_TOKEN_SEPARATOR_PATTERNS: RegExp[] = [
  /^(.*?)\s+:\s*(.+)$/,
  /^(.*?)\s*=\s*(.+)$/,
  /^(.*?)\s*\?\s*(.+)$/,
  /^(.*?)\s+-\s*(.+)$/,
];

const parseWordMeaningTokenEntry = (
  entry: string
): { source: string; meaning: string } | null => {
  const trimmed = entry.trim();
  if (!trimmed) return null;

  for (const pattern of WORD_MEANING_TOKEN_SEPARATOR_PATTERNS) {
    const match = trimmed.match(pattern);
    if (!match) continue;
    const source = match[1].trim();
    const meaning = match[2].trim();
    if (!source) return null;
    return { source, meaning };
  }

  return {
    source: trimmed,
    meaning: "",
  };
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
  sourceDisplayScript,
  onReplaceRows,
  autoEnterTableEdit = false,
  initialEditorMode = "token",
  onRequestClose,
  blendWithParent = false,
}: WordMeaningsEditorProps) {
  const initialTableSessionRows = autoEnterTableEdit ? normalizeRows(cloneRows(rows)) : [];

  const [editorMode, setEditorMode] = useState<"table" | "token">(initialEditorMode);
  const [tokenDraft, setTokenDraft] = useState("");
  const [tokenDraftBaseline, setTokenDraftBaseline] = useState("");
  const [tokenMessage, setTokenMessage] = useState<string | null>(null);
  const [showTokenHelp, setShowTokenHelp] = useState(false);
  const [isTableEditMode, setIsTableEditMode] = useState(autoEnterTableEdit);
  const [draftRows, setDraftRows] = useState<WordMeaningRow[]>(initialTableSessionRows);
  const [originalRows, setOriginalRows] = useState<WordMeaningRow[]>(initialTableSessionRows);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [undoStack, setUndoStack] = useState<WordMeaningRow[][]>([]);
  const [redoStack, setRedoStack] = useState<WordMeaningRow[][]>([]);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const tokenTextareaRef = useRef<HTMLTextAreaElement | null>(null);

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
  const serializedOriginalRows = useMemo(() => serializeRows(originalRows), [originalRows]);
  const serializedDraftRows = useMemo(() => serializeRows(draftRows), [draftRows]);
  const isDirty = isTableEditMode && serializedDraftRows !== serializedOriginalRows;
  const selectedRowIdSet = useMemo(() => new Set(selectedRowIds), [selectedRowIds]);
  const allSelected = draftRows.length > 0 && selectedRowIds.length === draftRows.length;
  const someSelected = selectedRowIds.length > 0 && !allSelected;
  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;
  const selectedIndices = useMemo(
    () => draftRows.flatMap((row, index) => (selectedRowIdSet.has(row.id) ? [index] : [])),
    [draftRows, selectedRowIdSet]
  );
  const canMoveUp = selectedIndices.length > 0 && selectedIndices[0] > 0;
  const canMoveDown =
    selectedIndices.length > 0 && selectedIndices[selectedIndices.length - 1] < draftRows.length - 1;

  useEffect(() => {
    if (!selectAllRef.current) {
      return;
    }
    selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  useEffect(() => {
    if (editorMode !== "token") {
      return;
    }
    const textarea = tokenTextareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "0px";
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 120), 320);
    textarea.style.height = `${nextHeight}px`;
  }, [editorMode, tokenDraft]);

  const serializeRowsForTokenEditor = (rowsInput: WordMeaningRow[]) =>
    rowsInput
      .map((row) => {
        const sourceDisplay = sourceDisplayValueFromRow(row).trim();
        const meaning = (row.meanings[requiredLanguage] || "").trim();
        if (!sourceDisplay && !meaning) return "";
        return meaning ? `${sourceDisplay}=${meaning}` : sourceDisplay;
      })
      .filter(Boolean)
      .join("\n");

  const parseTokenDraftToRows = (
    tokenText: string,
    seedRows: WordMeaningRow[]
  ): WordMeaningRow[] => {
    const entries = tokenText
      .split(/\n|;/)
      .map((entry) => entry.trim())
      .filter(Boolean);

    return entries
      .map((entry, index) => {
        const parsed = parseWordMeaningTokenEntry(entry);
        if (!parsed?.source) return null;
        const sourcePair = sourcePairFromDisplayInput(parsed.source);
        const existingId = seedRows[index]?.id;
        return {
          id: existingId || `wm_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`,
          order: index + 1,
          sourceLanguage: effectiveSourceLanguage,
          sourceScriptText: sourcePair.sourceScriptText,
          sourceTransliterationIast: sourcePair.sourceTransliterationIast,
          meanings: {
            [requiredLanguage]: parsed.meaning,
            ...(effectiveMeaningLanguage === requiredLanguage
              ? {}
              : { [effectiveMeaningLanguage]: parsed.meaning }),
          },
          activeMeaningLanguage: effectiveMeaningLanguage,
        };
      })
      .filter((row): row is WordMeaningRow => Boolean(row));
  };

  const resetTableEditSession = () => {
    setIsTableEditMode(false);
    setDraftRows([]);
    setOriginalRows([]);
    setSelectedRowIds([]);
    setUndoStack([]);
    setRedoStack([]);
    setTokenDraft("");
    setTokenDraftBaseline("");
  };

  const createEmptyRow = (): WordMeaningRow => ({
    id: `wm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    order: draftRows.length + 1,
    sourceLanguage: effectiveSourceLanguage,
    sourceScriptText: "",
    sourceTransliterationIast: "",
    meanings: { [requiredLanguage]: "" },
    activeMeaningLanguage: requiredLanguage,
  });

  const attemptExitTableEditMode = () => {
    if (hasUnsavedEdits) {
      const confirmed = window.confirm(
        "You have unsaved word-meaning edits. Exit edit mode and lose these changes?"
      );
      if (!confirmed) {
        return false;
      }
    }
    resetTableEditSession();
    return true;
  };

  const enterTableEditMode = () => {
    const nextRows = normalizeRows(cloneRows(rows));
    setOriginalRows(nextRows);
    setDraftRows(nextRows);
    const serializedForToken = serializeRowsForTokenEditor(nextRows);
    setTokenDraft(serializedForToken);
    setTokenDraftBaseline(serializedForToken);
    setTokenMessage(null);
    setSelectedRowIds([]);
    setUndoStack([]);
    setRedoStack([]);
    setIsTableEditMode(true);
  };

  const tokenModeDraftRows = isTableEditMode
    ? normalizeRows(parseTokenDraftToRows(tokenDraft, draftRows))
    : [];

  const isTokenModeDirty =
    isTableEditMode && tokenDraft !== tokenDraftBaseline;
  const hasUnsavedEdits = editorMode === "token" ? isTokenModeDirty : isDirty;

  const commitDraftRows = (updater: (currentRows: WordMeaningRow[]) => WordMeaningRow[]) => {
    setDraftRows((currentRows) => {
      const nextRows = normalizeRows(updater(cloneRows(currentRows)));
      if (serializeRows(currentRows) === serializeRows(nextRows)) {
        return currentRows;
      }
      setUndoStack((currentUndo) => [...currentUndo.slice(-(HISTORY_LIMIT - 1)), cloneRows(currentRows)]);
      setRedoStack([]);
      return nextRows;
    });
  };

  const handleUndo = () => {
    if (!canUndo) {
      return;
    }
    setDraftRows((currentRows) => {
      const previousRows = undoStack[undoStack.length - 1];
      if (!previousRows) {
        return currentRows;
      }
      setUndoStack((currentUndo) => currentUndo.slice(0, -1));
      setRedoStack((currentRedo) => [cloneRows(currentRows), ...currentRedo].slice(0, HISTORY_LIMIT));
      return normalizeRows(cloneRows(previousRows));
    });
  };

  const handleRedo = () => {
    if (!canRedo) {
      return;
    }
    setDraftRows((currentRows) => {
      const nextRows = redoStack[0];
      if (!nextRows) {
        return currentRows;
      }
      setRedoStack((currentRedo) => currentRedo.slice(1));
      setUndoStack((currentUndo) => [...currentUndo.slice(-(HISTORY_LIMIT - 1)), cloneRows(currentRows)]);
      return normalizeRows(cloneRows(nextRows));
    });
  };

  const handleToggleTableEditMode = () => {
    if (isTableEditMode) {
      void attemptExitTableEditMode();
      return;
    }
    enterTableEditMode();
  };

  const handleEditorModeChange = (nextMode: "table" | "token") => {
    if (nextMode === editorMode) {
      return;
    }
    if (nextMode === "token") {
      const nextTokenDraft = serializeRowsForTokenEditor(isTableEditMode ? draftRows : rows);
      setTokenDraft(nextTokenDraft);
      setTokenDraftBaseline(nextTokenDraft);
      setTokenMessage(null);
    } else if (isTableEditMode) {
      if (isTokenModeDirty) {
        setDraftRows(tokenModeDraftRows);
      }
      setSelectedRowIds([]);
    }
    setEditorMode(nextMode);
  };

  const handleSaveTableEdits = () => {
    if (!isDirty) {
      return;
    }
    const nextRows = normalizeRows(cloneRows(draftRows));
    onReplaceRows(nextRows);
    resetTableEditSession();
  };

  const handleSaveTokenEdits = () => {
    if (!isTokenModeDirty) {
      return;
    }
    if (tokenModeDraftRows.length === 0) {
      setTokenMessage("No valid token rows found.");
      return;
    }
    onReplaceRows(tokenModeDraftRows);
    resetTableEditSession();
  };

  const handleHeaderSave = () => {
    if (!isTableEditMode) {
      return;
    }
    if (editorMode === "token") {
      handleSaveTokenEdits();
      return;
    }
    handleSaveTableEdits();
  };

  const handleHeaderClose = () => {
    if (!attemptExitTableEditMode()) {
      return;
    }
    onRequestClose?.();
  };

  const handleSelectAllToggle = () => {
    if (allSelected) {
      setSelectedRowIds([]);
      return;
    }
    setSelectedRowIds(draftRows.map((row) => row.id));
  };

  const handleToggleRowSelection = (rowId: string) => {
    setSelectedRowIds((currentSelected) =>
      currentSelected.includes(rowId)
        ? currentSelected.filter((id) => id !== rowId)
        : [...currentSelected, rowId]
    );
  };

  const handleInsertRow = () => {
    const nextRow = createEmptyRow();
    commitDraftRows((currentRows) => [...currentRows, nextRow]);
    setSelectedRowIds([nextRow.id]);
  };

  const handleMoveSelectedUp = () => {
    if (!canMoveUp) {
      return;
    }
    commitDraftRows((currentRows) => {
      const nextRows = [...currentRows];
      for (let index = 1; index < nextRows.length; index += 1) {
        if (selectedRowIdSet.has(nextRows[index].id) && !selectedRowIdSet.has(nextRows[index - 1].id)) {
          [nextRows[index - 1], nextRows[index]] = [nextRows[index], nextRows[index - 1]];
        }
      }
      return nextRows;
    });
  };

  const handleMoveSelectedDown = () => {
    if (!canMoveDown) {
      return;
    }
    commitDraftRows((currentRows) => {
      const nextRows = [...currentRows];
      for (let index = nextRows.length - 2; index >= 0; index -= 1) {
        if (selectedRowIdSet.has(nextRows[index].id) && !selectedRowIdSet.has(nextRows[index + 1].id)) {
          [nextRows[index], nextRows[index + 1]] = [nextRows[index + 1], nextRows[index]];
        }
      }
      return nextRows;
    });
  };

  const handleDeleteSelected = () => {
    if (selectedRowIds.length === 0) {
      return;
    }
    commitDraftRows((currentRows) => currentRows.filter((row) => !selectedRowIdSet.has(row.id)));
    setSelectedRowIds([]);
  };

  const handleDraftSourceChange = (rowId: string, value: string) => {
    const nextPair = sourcePairFromDisplayInput(value);
    commitDraftRows((currentRows) =>
      currentRows.map((row) =>
        row.id === rowId
          ? {
              ...row,
              sourceLanguage: effectiveSourceLanguage,
              sourceScriptText: nextPair.sourceScriptText,
              sourceTransliterationIast: nextPair.sourceTransliterationIast,
            }
          : row
      )
    );
  };

  const handleDraftMeaningChange = (rowId: string, value: string) => {
    commitDraftRows((currentRows) =>
      currentRows.map((row) => {
        if (row.id !== rowId) {
          return row;
        }
        const language = row.activeMeaningLanguage || requiredLanguage;
        return {
          ...row,
          activeMeaningLanguage: language,
          meanings: {
            ...row.meanings,
            [language]: value,
          },
        };
      })
    );
  };

  useEffect(() => {
    if (!isTableEditMode) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const isPrimaryModifier = event.metaKey || event.ctrlKey;
      if (!isPrimaryModifier) {
        return;
      }
      const lowerKey = event.key.toLowerCase();

      if (lowerKey === "z" && !event.shiftKey) {
        event.preventDefault();
        setDraftRows((currentRows) => {
          const previousRows = undoStack[undoStack.length - 1];
          if (!previousRows) {
            return currentRows;
          }
          setUndoStack((currentUndo) => currentUndo.slice(0, -1));
          setRedoStack((currentRedo) => [cloneRows(currentRows), ...currentRedo].slice(0, HISTORY_LIMIT));
          return normalizeRows(cloneRows(previousRows));
        });
        return;
      }

      if ((lowerKey === "z" && event.shiftKey) || lowerKey === "y") {
        event.preventDefault();
        setDraftRows((currentRows) => {
          const nextRows = redoStack[0];
          if (!nextRows) {
            return currentRows;
          }
          setRedoStack((currentRedo) => currentRedo.slice(1));
          setUndoStack((currentUndo) => [...currentUndo.slice(-(HISTORY_LIMIT - 1)), cloneRows(currentRows)]);
          return normalizeRows(cloneRows(nextRows));
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isTableEditMode, redoStack, undoStack]);

  const handleApplyTokenDraft = () => {
    const entries = tokenDraft
      .split(/\n|;/)
      .map((entry) => entry.trim())
      .filter(Boolean);

    const parsedRows: WordMeaningRow[] = entries
      .map((entry, index) => {
        const parsed = parseWordMeaningTokenEntry(entry);
        if (!parsed?.source) return null;
        const sourcePair = sourcePairFromDisplayInput(parsed.source);
        return {
          id: `wm_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`,
          order: index + 1,
          sourceLanguage: effectiveSourceLanguage,
          sourceScriptText: sourcePair.sourceScriptText,
          sourceTransliterationIast: sourcePair.sourceTransliterationIast,
          meanings: {
            [requiredLanguage]: parsed.meaning,
            ...(effectiveMeaningLanguage === requiredLanguage
              ? {}
              : { [effectiveMeaningLanguage]: parsed.meaning }),
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

  const containerClassName = blendWithParent
    ? "mt-1 rounded-lg border border-black/10 px-1.5 pt-1.5 pb-1 sm:px-2 sm:pt-2 sm:pb-1.5"
    : "mt-2 rounded-lg border border-black/10 bg-white/80 p-2 sm:p-3";
  const panelClassName = blendWithParent ? "bg-transparent" : "bg-white";
  const subtlePanelClassName = blendWithParent ? "bg-zinc-100" : "bg-zinc-50";

  return (
    <div className={containerClassName}>
      <div className="mb-2 flex items-center justify-between gap-2 sm:mb-3 sm:gap-3">
        <div className="flex items-center gap-1">
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Word Meanings</div>
          {editorMode === "token" && (
            <button
              type="button"
              onClick={() => setShowTokenHelp((v) => !v)}
              title="Token format help"
              aria-label="Token format help"
              className={`flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-semibold transition ${
                showTokenHelp
                  ? "border-[color:var(--accent)] bg-[color:var(--accent)]/10 text-[color:var(--accent)]"
                  : "border-black/20 bg-white text-zinc-500 hover:bg-zinc-50"
              }`}
            >
              ?
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-black/10 bg-white p-0.5">
            <button
              type="button"
              onClick={() => handleEditorModeChange("table")}
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
              onClick={() => handleEditorModeChange("token")}
              className={`rounded px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] ${
                editorMode === "token"
                  ? "bg-[color:var(--accent)]/10 text-[color:var(--accent)]"
                  : "text-zinc-600"
              }`}
            >
              Token
            </button>
          </div>
          {isTableEditMode ? (
            <>
              <button
                type="button"
                onClick={handleHeaderSave}
                disabled={editorMode === "token" ? !isTokenModeDirty : !isDirty}
                className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-white transition disabled:cursor-not-allowed disabled:opacity-40"
              >
                Save
              </button>
              <button
                type="button"
                onClick={handleHeaderClose}
                className="ml-1 flex h-7 w-7 items-center justify-center rounded-full border border-black/10 bg-white text-sm font-semibold text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800"
                aria-label="Close word meanings editor"
                title="Close"
              >
                ✕
              </button>
            </>
          ) : editorMode === "table" ? (
            <button
              type="button"
              onClick={handleToggleTableEditMode}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-black/10 bg-white text-zinc-700 transition hover:bg-zinc-50"
              aria-label="Edit word meanings table"
              title="Edit"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path d="m13.499 4.26 2.24 2.24-8.76 8.76H4.74v-2.24l8.76-8.76Zm1.06-1.06.44-.44a1.5 1.5 0 0 1 2.121 2.12l-.44.44-2.24-2.24Z" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>
      {!isTableEditMode && missingRequired && (
        <div className="mb-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
          English meaning is required for every filled row.
        </div>
      )}
      {!isTableEditMode && validationErrors.length > 0 && (
        <div className="mb-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
          {`Validation: ${validationErrors[0]}`}
        </div>
      )}

      {editorMode === "token" && showTokenHelp && (
        <div className="mb-2 rounded border border-black/10 bg-zinc-50 px-2 py-1.5 text-[11px] text-zinc-600">
          Enter one token per line or semicolon-separated. Use explicit separators only: <code className="rounded bg-zinc-200 px-0.5">:</code>, <code className="rounded bg-zinc-200 px-0.5">=</code>, <code className="rounded bg-zinc-200 px-0.5">?</code>, or <code className="rounded bg-zinc-200 px-0.5">-</code> (in that precedence order). For <code className="rounded bg-zinc-200 px-0.5">:</code> and <code className="rounded bg-zinc-200 px-0.5">-</code>, include a space before them.
        </div>
      )}
      {editorMode === "token" ? (
        <div>
          <textarea
            ref={tokenTextareaRef}
            value={tokenDraft}
            onChange={(event) => {
              setTokenDraft(event.target.value);
              setTokenMessage(null);
            }}
            rows={1}
            className={`w-full overflow-y-auto rounded-lg border border-black/10 px-2.5 pt-2 pb-1 text-sm outline-none focus:border-[color:var(--accent)] ${panelClassName}`}
            placeholder="karma=action\nyoga=discipline"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            {!isTableEditMode && (
              <button
                type="button"
                onClick={handleApplyTokenDraft}
                disabled={!tokenDraft.trim()}
                className="rounded-lg border border-black/10 bg-white px-2 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 sm:text-[11px] sm:tracking-[0.18em]"
              >
                Apply Token Edits
              </button>
            )}
          </div>
          {tokenMessage && <div className="mt-2 text-[11px] text-zinc-600">{tokenMessage}</div>}
        </div>
      ) : isTableEditMode ? (
        <div className="space-y-3">
          <div className={`flex items-center gap-1 rounded-lg border border-black/10 p-1.5 ${panelClassName}`}>
            {/* Undo */}
            <button
              type="button"
              onClick={handleUndo}
              disabled={!canUndo}
              title="Undo"
              aria-label="Undo"
              className="flex h-7 w-7 items-center justify-center rounded border border-black/10 bg-white text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path fillRule="evenodd" d="M7.793 2.232a.75.75 0 0 1-.025 1.06L3.622 7.25h10.003a5.375 5.375 0 0 1 0 10.75H10.75a.75.75 0 0 1 0-1.5h2.875a3.875 3.875 0 0 0 0-7.75H3.622l4.146 3.957a.75.75 0 0 1-1.036 1.085l-5.5-5.25a.75.75 0 0 1 0-1.085l5.5-5.25a.75.75 0 0 1 1.06.025Z" clipRule="evenodd" /></svg>
            </button>
            {/* Redo */}
            <button
              type="button"
              onClick={handleRedo}
              disabled={!canRedo}
              title="Redo"
              aria-label="Redo"
              className="flex h-7 w-7 items-center justify-center rounded border border-black/10 bg-white text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path fillRule="evenodd" d="M12.207 2.232a.75.75 0 0 0 .025 1.06L16.378 7.25H6.375a5.375 5.375 0 0 0 0 10.75H9.25a.75.75 0 0 0 0-1.5H6.375a3.875 3.875 0 0 1 0-7.75h10.003l-4.146 3.957a.75.75 0 0 0 1.036 1.085l5.5-5.25a.75.75 0 0 0 0-1.085l-5.5-5.25a.75.75 0 0 0-1.06.025Z" clipRule="evenodd" /></svg>
            </button>
            <div className="mx-0.5 h-5 w-px bg-black/10" />
            {/* Insert Row */}
            <button
              type="button"
              onClick={handleInsertRow}
              title="Insert row"
              aria-label="Insert row"
              className="flex h-7 w-7 items-center justify-center rounded border border-black/10 bg-white text-zinc-600 transition hover:bg-zinc-50"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" /></svg>
            </button>
            <div className="mx-0.5 h-5 w-px bg-black/10" />
            {/* Move Up */}
            <button
              type="button"
              onClick={handleMoveSelectedUp}
              disabled={!canMoveUp}
              title="Move selected up"
              aria-label="Move selected up"
              className="flex h-7 w-7 items-center justify-center rounded border border-black/10 bg-white text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path fillRule="evenodd" d="M9.47 6.47a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 1 1-1.06 1.06L10 8.06l-3.72 3.72a.75.75 0 0 1-1.06-1.06l4.25-4.25Z" clipRule="evenodd" /></svg>
            </button>
            {/* Move Down */}
            <button
              type="button"
              onClick={handleMoveSelectedDown}
              disabled={!canMoveDown}
              title="Move selected down"
              aria-label="Move selected down"
              className="flex h-7 w-7 items-center justify-center rounded border border-black/10 bg-white text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" /></svg>
            </button>
            <div className="mx-0.5 h-5 w-px bg-black/10" />
            {/* Delete Selected */}
            <button
              type="button"
              onClick={handleDeleteSelected}
              disabled={selectedRowIds.length === 0}
              title="Delete selected"
              aria-label="Delete selected"
              className="flex h-7 w-7 items-center justify-center rounded border border-red-200 bg-white text-red-500 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" /></svg>
            </button>
          </div>

          <div className={`max-h-[256px] overflow-y-auto overflow-x-auto rounded-lg border border-black/10 ${panelClassName}`}>
            <table className="w-full border-collapse">
              <thead>
                <tr className={`sticky top-0 z-10 text-left text-[11px] uppercase tracking-[0.14em] text-zinc-500 ${subtlePanelClassName}`}>
                  <th className="w-6 border-b border-black/10 px-1 py-1.5">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={allSelected}
                      onChange={handleSelectAllToggle}
                      aria-label="Select all rows"
                    />
                  </th>
                  <th className="w-5 border-b border-black/10 px-1 py-1.5 text-center">#</th>
                  <th className="border-b border-black/10 px-1 py-1.5">Src</th>
                  <th className="border-b border-black/10 px-1 py-1.5">Meaning</th>
                </tr>
              </thead>
              <tbody>
                {draftRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-2 py-4 text-center text-sm text-zinc-500">
                      No word-meaning rows yet. Use Insert Row to start the table.
                    </td>
                  </tr>
                ) : (
                  draftRows.map((row, index) => (
                    <tr key={row.id} className={selectedRowIdSet.has(row.id) ? "bg-blue-50/50" : ""}>
                      <td className="w-6 border-b border-black/10 px-1 py-1 align-top">
                        <input
                          type="checkbox"
                          checked={selectedRowIdSet.has(row.id)}
                          onChange={() => handleToggleRowSelection(row.id)}
                          aria-label={`Select row ${index + 1}`}
                        />
                      </td>
                      <td className="w-5 border-b border-black/10 px-1 py-1 text-center text-xs text-zinc-500 align-top">
                        {index + 1}
                      </td>
                      <td className="border-b border-black/10 px-1 py-1">
                        <input
                          type="text"
                          value={sourceDisplayValueFromRow(row)}
                          onChange={(event) => handleDraftSourceChange(row.id, event.target.value)}
                          className="w-full min-w-0 rounded border border-black/10 bg-white px-1.5 py-1 text-xs outline-none focus:border-[color:var(--accent)]"
                          placeholder="Source"
                        />
                      </td>
                      <td className="border-b border-black/10 px-1 py-1">
                        <input
                          type="text"
                          value={row.meanings[row.activeMeaningLanguage] || ""}
                          onChange={(event) => handleDraftMeaningChange(row.id, event.target.value)}
                          className="w-full min-w-0 rounded border border-black/10 bg-white px-1.5 py-1 text-xs outline-none focus:border-[color:var(--accent)]"
                          placeholder="Meaning"
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-zinc-500">No word-meaning rows yet.</p>
      ) : (
        <>
          {/* Mobile: stacked cards */}
          <div className="space-y-2 md:hidden">
            {rows.map((row, index) => (
              <div key={row.id} className="rounded-lg border border-black/10 bg-white p-2">
                <div className="mb-2 text-[10px] uppercase tracking-[0.12em] text-zinc-500">Row {index + 1}</div>
                <div className="grid grid-cols-1 gap-2 text-sm">
                  <div className="rounded bg-zinc-50 px-2 py-1.5">
                    <div className="mb-0.5 text-[10px] uppercase tracking-[0.12em] text-zinc-500">Source</div>
                    <div className="break-words text-zinc-900">{sourceDisplayValueFromRow(row)}</div>
                  </div>
                  <div className="rounded bg-zinc-50 px-2 py-1.5">
                    <div className="mb-0.5 text-[10px] uppercase tracking-[0.12em] text-zinc-500">Meaning</div>
                    <div className="break-words text-zinc-900">{row.meanings[row.activeMeaningLanguage] || "—"}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden overflow-x-auto rounded-lg border border-black/10 bg-white md:block">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="bg-zinc-50 text-left text-[11px] uppercase tracking-[0.14em] text-zinc-500">
                  <th className="border-b border-black/10 px-2 py-2">#</th>
                  <th className="border-b border-black/10 px-2 py-2">Source ({effectiveSourceLanguage})</th>
                  <th className="border-b border-black/10 px-2 py-2">
                    Meaning ({effectiveMeaningLanguage}){effectiveMeaningLanguage === requiredLanguage ? "*" : ""}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.id} className="align-top">
                    <td className="border-b border-black/10 px-2 py-2 text-xs text-zinc-500">{index + 1}</td>
                    <td className="border-b border-black/10 px-2 py-2">
                      <div className="text-sm text-zinc-900">{sourceDisplayValueFromRow(row)}</div>
                    </td>
                    <td className="border-b border-black/10 px-2 py-2">
                      <div className="text-sm text-zinc-900">{row.meanings[row.activeMeaningLanguage] || "—"}</div>
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
