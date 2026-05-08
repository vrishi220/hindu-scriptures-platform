"use client";

import React from "react";
import InlineClearButton from "../../components/InlineClearButton";
import WordMeaningsEditor from "../../components/WordMeaningsEditor";
import type { AuthorVariantDraft, BookDetails, TreeNode } from "../../lib/scriptureTypes";
import type { EditableTranslationLanguage } from "../../lib/translationUtils";
import {
  EDITABLE_TRANSLATION_LANGUAGES,
  SORTED_EDITABLE_TRANSLATION_LANGUAGES,
  translationLanguageLabel,
  normalizeSelectedEditableTranslationLanguages,
  buildEmptyAuthorVariantDraft,
  getVariantAuthorOptions,
  applyVariantAuthorSelection,
  applyVariantLanguageSelection,
} from "../../lib/translationUtils";
import { DEFAULT_CONTENT_FIELD_LABELS, formatValue } from "../../lib/scriptureUtils";
import {
  WORD_MEANINGS_REQUIRED_LANGUAGE,
  WORD_MEANINGS_ALLOWED_MEANING_LANGUAGES,
  type WordMeaningRow,
} from "../../lib/wordMeanings";
import type { TransliterationScriptOption } from "../../lib/indicScript";

export type NodeEditorFormData = {
  levelName: string;
  titleSanskrit: string;
  titleTransliteration: string;
  titleEnglish: string;
  sequenceNumber: string;
  hasContent: boolean;
  contentSanskrit: string;
  contentTransliteration: string;
  contentEnglish: string;
  tags: string;
  wordMeanings: WordMeaningRow[];
};

type Props = {
  action: "add" | "edit" | null;
  actionNode: TreeNode | null;
  editorOpenedFromPreviewRef: React.MutableRefObject<boolean>;
  suppressNextAutoPreviewRef: React.MutableRefObject<boolean>;
  setAction: React.Dispatch<React.SetStateAction<"add" | "edit" | null>>;
  setActionNode: React.Dispatch<React.SetStateAction<TreeNode | null>>;
  setCreateParentNodeIdOverride: React.Dispatch<React.SetStateAction<number | null>>;
  setCreateInsertAfterNodeId: React.Dispatch<React.SetStateAction<number | null>>;
  setActionMessage: React.Dispatch<React.SetStateAction<string | null>>;
  formData: NodeEditorFormData;
  setFormData: React.Dispatch<React.SetStateAction<NodeEditorFormData>>;
  handleModalSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  currentBook: BookDetails | null;
  contentFieldLabels: Record<string, string>;
  getDisplayLevelName: (levelName: string | null | undefined) => string;
  modalSelectedTranslationLanguages: EditableTranslationLanguage[];
  setModalSelectedTranslationLanguages: React.Dispatch<React.SetStateAction<EditableTranslationLanguage[]>>;
  sourceLanguage: string;
  modalTranslationDrafts: Record<EditableTranslationLanguage, string>;
  setModalTranslationDrafts: React.Dispatch<React.SetStateAction<Record<EditableTranslationLanguage, string>>>;
  modalTranslationVariants: AuthorVariantDraft[];
  setModalTranslationVariants: React.Dispatch<React.SetStateAction<AuthorVariantDraft[]>>;
  modalCommentaryVariants: AuthorVariantDraft[];
  setModalCommentaryVariants: React.Dispatch<React.SetStateAction<AuthorVariantDraft[]>>;
  modalWordMeaningsEnabled: boolean;
  modalWordMeaningValidationErrors: string[];
  modalWordMeaningsMissingRequired: boolean;
  transliterationScript: TransliterationScriptOption;
  transliterationDisplayValue: (iastValue: string) => string;
  transliterationInputToIast: (displayValue: string) => string;
  handleAddModalWordMeaningRow: (sourceLanguage: string, meaningLanguage: string) => void;
  updateModalWordMeaningRows: (rows: WordMeaningRow[]) => void;
  handleMoveModalWordMeaningRow: (rowId: string, direction: "up" | "down") => void;
  handleRemoveModalWordMeaningRow: (rowId: string) => void;
  handleModalWordMeaningChange: (
    rowId: string,
    key: "sourceLanguage" | "sourceScriptText" | "sourceTransliterationIast",
    value: string
  ) => void;
  handleSelectModalMeaningLanguage: (rowId: string, language: string) => void;
  handleModalMeaningTextChange: (rowId: string, language: string, value: string) => void;
  actionMessage: string | null;
  createNextOnSubmit: boolean;
  setCreateNextOnSubmit: React.Dispatch<React.SetStateAction<boolean>>;
  submitting: boolean;
};

export default function NodeEditorForm({
  action,
  actionNode,
  editorOpenedFromPreviewRef,
  suppressNextAutoPreviewRef,
  setAction,
  setActionNode,
  setCreateParentNodeIdOverride,
  setCreateInsertAfterNodeId,
  setActionMessage,
  formData,
  setFormData,
  handleModalSubmit,
  currentBook,
  contentFieldLabels,
  getDisplayLevelName,
  modalSelectedTranslationLanguages,
  setModalSelectedTranslationLanguages,
  sourceLanguage,
  modalTranslationDrafts,
  setModalTranslationDrafts,
  modalTranslationVariants,
  setModalTranslationVariants,
  modalCommentaryVariants,
  setModalCommentaryVariants,
  modalWordMeaningsEnabled,
  modalWordMeaningValidationErrors,
  modalWordMeaningsMissingRequired,
  transliterationScript,
  transliterationDisplayValue,
  transliterationInputToIast,
  handleAddModalWordMeaningRow,
  updateModalWordMeaningRows,
  handleMoveModalWordMeaningRow,
  handleRemoveModalWordMeaningRow,
  handleModalWordMeaningChange,
  handleSelectModalMeaningLanguage,
  handleModalMeaningTextChange,
  actionMessage,
  createNextOnSubmit,
  setCreateNextOnSubmit,
  submitting,
}: Props) {
  if (!action || !actionNode) return null;

  return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-3 overflow-y-auto">
            <div className="my-6 flex max-h-[calc(100svh-3rem)] w-full max-w-2xl flex-col rounded-3xl bg-[color:var(--paper)] shadow-2xl">
              <div className="flex-shrink-0 border-b border-black/10 p-4 pb-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-[var(--font-display)] text-2xl text-[color:var(--deep)]">
                    {action === "add"
                      ? `Add ${getDisplayLevelName(formData.levelName) || "New Node"}`
                      : `Edit ${getDisplayLevelName(formatValue(formData.levelName || actionNode?.level_name)) || "Node"}`}
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      if (editorOpenedFromPreviewRef.current) {
                        suppressNextAutoPreviewRef.current = true;
                      }
                      editorOpenedFromPreviewRef.current = false;
                      setAction(null);
                      setActionNode(null);
                      setCreateParentNodeIdOverride(null);
                      setCreateInsertAfterNodeId(null);
                      setActionMessage(null);
                    }}
                    className="rounded-md border border-black/10 px-2.5 py-1 text-sm text-zinc-700"
                  >
                    X
                  </button>
                </div>
              </div>

              <form onSubmit={handleModalSubmit} className="flex min-h-0 flex-1 flex-col">
                <div className="flex-1 space-y-3 overflow-y-auto p-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Level Name
                      {action === "add" && <span className="ml-1 text-[10px]">(from schema)</span>}
                    </label>
                    {action === "add" ? (
                      <input
                        type="text"
                        value={getDisplayLevelName(formData.levelName)}
                        className="mt-1 w-full rounded-lg border border-black/10 bg-gray-100 px-3 py-2 text-sm text-gray-700 cursor-not-allowed outline-none"
                        placeholder="e.g., Kanda, Sarga, Shloka"
                        required
                        readOnly
                      />
                    ) : (
                      <select
                        value={formData.levelName}
                        onChange={(e) =>
                          setFormData({ ...formData, levelName: e.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                        required
                      >
                        <option value="">Select level</option>
                        {currentBook?.schema?.levels?.map((level) => (
                          <option key={level} value={level}>
                            {getDisplayLevelName(level)}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Sequence Number
                    </label>
                    <input
                      type="number"
                      value={formData.sequenceNumber}
                      onChange={(e) =>
                        setFormData({ ...formData, sequenceNumber: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                      placeholder="Auto-calculated if empty"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                    Title (English)
                  </label>
                  <div className="group relative mt-1">
                    <input
                      type="text"
                      value={formData.titleEnglish}
                      onChange={(e) =>
                        setFormData({ ...formData, titleEnglish: e.target.value })
                      }
                      className="w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 pr-10 text-sm outline-none focus:border-[color:var(--accent)]"
                      placeholder="English title"
                    />
                    <InlineClearButton
                      visible={Boolean(formData.titleEnglish)}
                      onClear={() => setFormData((prev) => ({ ...prev, titleEnglish: "" }))}
                      ariaLabel="Clear title English"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Title (Sanskrit)
                    </label>
                    <div className="group relative mt-1">
                      <input
                        type="text"
                        value={formData.titleSanskrit}
                        onChange={(e) =>
                          setFormData({ ...formData, titleSanskrit: e.target.value })
                        }
                        className="w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 pr-10 text-sm outline-none focus:border-[color:var(--accent)]"
                        placeholder="Sanskrit title"
                      />
                      <InlineClearButton
                        visible={Boolean(formData.titleSanskrit)}
                        onClear={() => setFormData((prev) => ({ ...prev, titleSanskrit: "" }))}
                        ariaLabel="Clear title Sanskrit"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Title (Transliteration)
                    </label>
                    <div className="group relative mt-1">
                      <input
                        type="text"
                        value={transliterationDisplayValue(formData.titleTransliteration)}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            titleTransliteration: transliterationInputToIast(e.target.value),
                          })
                        }
                        className="w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 pr-10 text-sm outline-none focus:border-[color:var(--accent)]"
                        placeholder="Transliteration"
                      />
                      <InlineClearButton
                        visible={Boolean(formData.titleTransliteration)}
                        onClear={() =>
                          setFormData((prev) => ({ ...prev, titleTransliteration: "" }))
                        }
                        ariaLabel="Clear title transliteration"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.hasContent}
                      onChange={(e) =>
                        setFormData({ ...formData, hasContent: e.target.checked })
                      }
                      className="rounded border-black/10"
                    />
                    <span className="text-sm text-zinc-600">Add content now</span>
                  </label>
                </div>

                {formData.hasContent && (
                  <div className="flex flex-col gap-3 rounded-lg border border-black/10 bg-blue-50/30 p-3">
                    <div>
                      <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                        {contentFieldLabels.sanskrit || DEFAULT_CONTENT_FIELD_LABELS.sanskrit}
                      </label>
                      <div className="group relative mt-1">
                        <textarea
                          value={formData.contentSanskrit}
                          onChange={(e) =>
                            setFormData({ ...formData, contentSanskrit: e.target.value })
                          }
                          className="w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 pr-10 text-sm outline-none focus:border-[color:var(--accent)]"
                          placeholder={contentFieldLabels.sanskrit || DEFAULT_CONTENT_FIELD_LABELS.sanskrit}
                          rows={3}
                        />
                        <InlineClearButton
                          visible={Boolean(formData.contentSanskrit)}
                          onClear={() => setFormData((prev) => ({ ...prev, contentSanskrit: "" }))}
                          ariaLabel="Clear content Sanskrit"
                          position="top"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                        {contentFieldLabels.transliteration || DEFAULT_CONTENT_FIELD_LABELS.transliteration}
                      </label>
                      <div className="group relative mt-1">
                        <textarea
                          value={transliterationDisplayValue(formData.contentTransliteration)}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              contentTransliteration: transliterationInputToIast(e.target.value),
                            })
                          }
                          className="w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 pr-10 text-sm outline-none focus:border-[color:var(--accent)]"
                          placeholder={contentFieldLabels.transliteration || DEFAULT_CONTENT_FIELD_LABELS.transliteration}
                          rows={3}
                        />
                        <InlineClearButton
                          visible={Boolean(formData.contentTransliteration)}
                          onClear={() =>
                            setFormData((prev) => ({ ...prev, contentTransliteration: "" }))
                          }
                          ariaLabel="Clear content transliteration"
                          position="top"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">Translations</label>
                      <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg border border-black/10 bg-white/70 px-2 py-1.5">
                        {EDITABLE_TRANSLATION_LANGUAGES.map((language) => (
                          <label key={`modal-translation-select-${language}`} className="flex items-center gap-1.5 text-xs text-zinc-700">
                            <input
                              type="checkbox"
                              checked={modalSelectedTranslationLanguages.includes(language)}
                              onChange={(event) => {
                                const nextValues = event.target.checked
                                  ? [...modalSelectedTranslationLanguages, language]
                                  : modalSelectedTranslationLanguages.filter((value) => value !== language);
                                setModalSelectedTranslationLanguages(
                                  normalizeSelectedEditableTranslationLanguages(nextValues, sourceLanguage)
                                );
                              }}
                            />
                            {translationLanguageLabel(language)}
                          </label>
                        ))}
                      </div>
                      <div className="mt-2 flex flex-col gap-2">
                        {modalSelectedTranslationLanguages.map((language) => (
                          <div key={`modal-translation-input-${language}`}>
                            <label className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                              {translationLanguageLabel(language)} Translation
                            </label>
                            <div className="group relative mt-1">
                              <textarea
                                value={modalTranslationDrafts[language] || ""}
                                onChange={(e) =>
                                  setModalTranslationDrafts((prev) => ({
                                    ...prev,
                                    [language]: e.target.value,
                                  }))
                                }
                                className="w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 pr-10 text-sm outline-none focus:border-[color:var(--accent)]"
                                rows={3}
                              />
                              <InlineClearButton
                                visible={Boolean((modalTranslationDrafts[language] || "").trim())}
                                onClear={() =>
                                  setModalTranslationDrafts((prev) => ({
                                    ...prev,
                                    [language]: "",
                                  }))
                                }
                                ariaLabel={`Clear ${translationLanguageLabel(language)} translation`}
                                position="top"
                              />
                            </div>
                          </div>
                        ))}
                      </div>

                      <details className="mt-2 rounded-lg border border-black/10 bg-white/70 p-2">
                        <summary className="cursor-pointer text-xs uppercase tracking-[0.16em] text-zinc-600">
                          Translation Variants By Author ({modalTranslationVariants.length})
                        </summary>
                        <div className="mt-2 flex flex-col gap-2">
                          {modalTranslationVariants.map((entry, index) => (
                            <div key={`modal-translation-variant-${index}`} className="rounded-lg border border-black/10 bg-white p-2">
                              <label className="mb-2 flex flex-col gap-1">
                                <span className="text-xs uppercase tracking-[0.16em] text-zinc-500">Author</span>
                                <select
                                  value={entry.author_slug}
                                  onChange={(event) =>
                                    setModalTranslationVariants((prev) =>
                                      prev.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? applyVariantAuthorSelection(item, event.target.value, currentBook)
                                          : item
                                      )
                                    )
                                  }
                                  disabled={getVariantAuthorOptions(currentBook, entry).length === 0}
                                  className="w-full rounded-lg border border-black/10 bg-white/90 px-2 py-1.5 text-sm outline-none focus:border-[color:var(--accent)] disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500"
                                >
                                  <option value="">
                                    {getVariantAuthorOptions(currentBook, entry).length > 0
                                      ? "Select author"
                                      : "No authors in registry"}
                                  </option>
                                  {getVariantAuthorOptions(currentBook, entry).map((option) => (
                                    <option key={option.slug} value={option.slug}>{option.name}</option>
                                  ))}
                                </select>
                              </label>
                              <div>
                                <label className="flex flex-col gap-1">
                                  <span className="text-xs uppercase tracking-[0.16em] text-zinc-500">Language</span>
                                  <select
                                    value={entry.language}
                                    onChange={(event) =>
                                      setModalTranslationVariants((prev) =>
                                        prev.map((item, itemIndex) =>
                                          itemIndex === index
                                            ? applyVariantLanguageSelection(item, event.target.value, "translation")
                                            : item
                                        )
                                      )
                                    }
                                    className="rounded-lg border border-black/10 bg-white/90 px-2 py-1.5 text-sm outline-none focus:border-[color:var(--accent)]"
                                  >
                                    <option value="">Select language</option>
                                    {SORTED_EDITABLE_TRANSLATION_LANGUAGES.map((language) => (
                                      <option key={language} value={language}>{translationLanguageLabel(language)}</option>
                                    ))}
                                  </select>
                                </label>
                              </div>
                              <textarea
                                value={entry.text}
                                onChange={(event) =>
                                  setModalTranslationVariants((prev) =>
                                    prev.map((item, itemIndex) =>
                                      itemIndex === index
                                        ? { ...item, text: event.target.value }
                                        : item
                                    )
                                  )
                                }
                                placeholder="Variant translation text"
                                rows={3}
                                className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-2 py-1.5 text-sm outline-none focus:border-[color:var(--accent)]"
                              />
                              <div className="mt-2 flex justify-end">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setModalTranslationVariants((prev) =>
                                      prev.filter((_, itemIndex) => itemIndex !== index)
                                    )
                                  }
                                  className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs uppercase tracking-[0.14em] text-red-700"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() =>
                              setModalTranslationVariants((prev) => [
                                ...prev,
                                buildEmptyAuthorVariantDraft(),
                              ])
                            }
                            className="self-start rounded-lg border border-black/10 bg-white px-2 py-1 text-xs uppercase tracking-[0.14em] text-zinc-700"
                          >
                            Add Translation Variant
                          </button>
                        </div>
                      </details>

                      <details className="mt-2 rounded-lg border border-black/10 bg-white/70 p-2">
                        <summary className="cursor-pointer text-xs uppercase tracking-[0.16em] text-zinc-600">
                          Commentary Variants By Author ({modalCommentaryVariants.length})
                        </summary>
                        <div className="mt-2 flex flex-col gap-2">
                          {modalCommentaryVariants.map((entry, index) => (
                            <div key={`modal-commentary-variant-${index}`} className="rounded-lg border border-black/10 bg-white p-2">
                              <label className="mb-2 flex flex-col gap-1">
                                <span className="text-xs uppercase tracking-[0.16em] text-zinc-500">Author</span>
                                <select
                                  value={entry.author_slug}
                                  onChange={(event) =>
                                    setModalCommentaryVariants((prev) =>
                                      prev.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? applyVariantAuthorSelection(item, event.target.value, currentBook)
                                          : item
                                      )
                                    )
                                  }
                                  disabled={getVariantAuthorOptions(currentBook, entry).length === 0}
                                  className="w-full rounded-lg border border-black/10 bg-white/90 px-2 py-1.5 text-sm outline-none focus:border-[color:var(--accent)] disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500"
                                >
                                  <option value="">
                                    {getVariantAuthorOptions(currentBook, entry).length > 0
                                      ? "Select author"
                                      : "No authors in registry"}
                                  </option>
                                  {getVariantAuthorOptions(currentBook, entry).map((option) => (
                                    <option key={option.slug} value={option.slug}>{option.name}</option>
                                  ))}
                                </select>
                              </label>
                              <div>
                                <label className="flex flex-col gap-1">
                                  <span className="text-xs uppercase tracking-[0.16em] text-zinc-500">Language</span>
                                  <select
                                    value={entry.language}
                                    onChange={(event) =>
                                      setModalCommentaryVariants((prev) =>
                                        prev.map((item, itemIndex) =>
                                          itemIndex === index
                                            ? applyVariantLanguageSelection(item, event.target.value, "commentary")
                                            : item
                                        )
                                      )
                                    }
                                    className="rounded-lg border border-black/10 bg-white/90 px-2 py-1.5 text-sm outline-none focus:border-[color:var(--accent)]"
                                  >
                                    <option value="">Select language</option>
                                    {SORTED_EDITABLE_TRANSLATION_LANGUAGES.map((language) => (
                                      <option key={language} value={language}>{translationLanguageLabel(language)}</option>
                                    ))}
                                  </select>
                                </label>
                              </div>
                              <textarea
                                value={entry.text}
                                onChange={(event) =>
                                  setModalCommentaryVariants((prev) =>
                                    prev.map((item, itemIndex) =>
                                      itemIndex === index
                                        ? { ...item, text: event.target.value }
                                        : item
                                    )
                                  )
                                }
                                placeholder="Variant commentary text"
                                rows={3}
                                className="mt-2 w-full rounded-lg border border-black/10 bg-white/90 px-2 py-1.5 text-sm outline-none focus:border-[color:var(--accent)]"
                              />
                              <div className="mt-2 flex justify-end">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setModalCommentaryVariants((prev) =>
                                      prev.filter((_, itemIndex) => itemIndex !== index)
                                    )
                                  }
                                  className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs uppercase tracking-[0.14em] text-red-700"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() =>
                              setModalCommentaryVariants((prev) => [
                                ...prev,
                                buildEmptyAuthorVariantDraft(),
                              ])
                            }
                            className="self-start rounded-lg border border-black/10 bg-white px-2 py-1 text-xs uppercase tracking-[0.14em] text-zinc-700"
                          >
                            Add Commentary Variant
                          </button>
                        </div>
                      </details>
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                        Tags (comma-separated)
                      </label>
                      <div className="group relative mt-1">
                        <input
                          type="text"
                          value={formData.tags}
                          onChange={(e) =>
                            setFormData({ ...formData, tags: e.target.value })
                          }
                          className="w-full rounded-lg border border-black/10 bg-white/90 px-3 py-2 pr-10 text-sm outline-none focus:border-[color:var(--accent)]"
                          placeholder="tag1, tag2, tag3"
                        />
                        <InlineClearButton
                          visible={Boolean(formData.tags)}
                          onClear={() => setFormData((prev) => ({ ...prev, tags: "" }))}
                          ariaLabel="Clear tags"
                        />
                      </div>
                    </div>

                    {modalWordMeaningsEnabled && (
                      <WordMeaningsEditor
                        rows={formData.wordMeanings}
                        validationErrors={modalWordMeaningValidationErrors}
                        missingRequired={modalWordMeaningsMissingRequired}
                        requiredLanguage={WORD_MEANINGS_REQUIRED_LANGUAGE}
                        allowedMeaningLanguages={WORD_MEANINGS_ALLOWED_MEANING_LANGUAGES}
                        sourceDisplayScript={transliterationScript}
                        onAddRow={handleAddModalWordMeaningRow}
                        onReplaceRows={updateModalWordMeaningRows}
                        onMoveRow={handleMoveModalWordMeaningRow}
                        onRemoveRow={handleRemoveModalWordMeaningRow}
                        onSourceFieldChange={handleModalWordMeaningChange}
                        onSelectMeaningLanguage={handleSelectModalMeaningLanguage}
                        onMeaningTextChange={handleModalMeaningTextChange}
                      />
                    )}
                  </div>
                )}
                </div>

                <div className="sticky bottom-0 z-10 flex-shrink-0 border-t border-black/10 bg-[color:var(--paper)] p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
                  {actionMessage && (
                    <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {actionMessage}
                    </div>
                  )}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    {action === "add" ? (
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={createNextOnSubmit}
                          onChange={(e) => setCreateNextOnSubmit(e.target.checked)}
                          className="rounded border-black/10"
                        />
                        <span className="text-sm text-zinc-600">Create next after save</span>
                      </label>
                    ) : null}
                    <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (editorOpenedFromPreviewRef.current) {
                          suppressNextAutoPreviewRef.current = true;
                        }
                        editorOpenedFromPreviewRef.current = false;
                        setAction(null);
                        setActionNode(null);
                        setCreateParentNodeIdOverride(null);
                        setCreateInsertAfterNodeId(null);
                        setActionMessage(null);
                      }}
                      className="rounded-lg border border-black/10 bg-white/80 px-4 py-2 text-sm text-zinc-600 transition hover:border-black/20"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting || modalWordMeaningValidationErrors.length > 0}
                      className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-2 font-medium text-white transition disabled:opacity-50"
                    >
                      {submitting ? "Submitting..." : action === "add" ? "Create" : "Save"}
                    </button>
                    </div>
                  </div>
                </div>
              </form>
            </div>
          </div>
  );
}
