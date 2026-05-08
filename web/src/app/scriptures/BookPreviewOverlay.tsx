"use client";

import React from "react";
import {
  X,
  ChevronLeft,
  ChevronRight,
  Share2,
  BookOpen,
  SlidersHorizontal,
  FileText,
} from "lucide-react";
import {
  TRANSLITERATION_SCRIPT_OPTIONS,
  normalizeTransliterationScript,
  transliterationScriptLabel,
  type TransliterationScriptOption,
} from "../../lib/indicScript";
import {
  EDITABLE_TRANSLATION_LANGUAGES,
  translationLanguageLabel,
  normalizeSelectedEditableTranslationLanguages,
  type EditableTranslationLanguage,
} from "../../lib/translationUtils";
import {
  normalizePreviewWordMeaningsDisplayMode,
  normalizePreviewFontSizePercent,
} from "../../lib/previewUtils";
import {
  PREVIEW_FONT_SIZE_PERCENT_MIN,
  PREVIEW_FONT_SIZE_PERCENT_MAX,
  PREVIEW_FONT_SIZE_PERCENT_STEP,
} from "../../lib/translationUtils";
import type {
  BookPreviewArtifact,
  BookPreviewLanguageSettings,
  BookDetails,
  ShareDialogState,
  ShareDialogLinkOption,
} from "../../lib/scriptureTypes";

type Props = {
  // Artifact (guaranteed non-null by outer guard)
  bookPreviewArtifact: BookPreviewArtifact;

  // Refs
  bookPreviewOverlayRef: React.MutableRefObject<HTMLDivElement | null>;
  bookPreviewScrollContainerRef: React.MutableRefObject<HTMLDivElement | null>;
  previewShareMenuRef: React.MutableRefObject<HTMLDivElement | null>;

  // Loading state
  bookPreviewLoading: boolean;
  bookPreviewLoadingMore: boolean;
  previewLoadingMessageWithElapsed: string;
  previewLinkMessage: string | null;

  // Controls visibility
  showPreviewControls: boolean;
  setShowPreviewControls: React.Dispatch<React.SetStateAction<boolean>>;
  previewControlsTab: "content" | "translations";
  setPreviewControlsTab: React.Dispatch<React.SetStateAction<"content" | "translations">>;

  // Content settings
  showPreviewTitles: boolean;
  setShowPreviewTitles: React.Dispatch<React.SetStateAction<boolean>>;
  showPreviewLabels: boolean;
  setShowPreviewLabels: React.Dispatch<React.SetStateAction<boolean>>;
  showPreviewLevelNumbers: boolean;
  setShowPreviewLevelNumbers: React.Dispatch<React.SetStateAction<boolean>>;
  showPreviewDetails: boolean;
  setShowPreviewDetails: React.Dispatch<React.SetStateAction<boolean>>;
  showPreviewMedia: boolean;
  setShowPreviewMedia: React.Dispatch<React.SetStateAction<boolean>>;
  previewEditModeEnabled: boolean;
  setPreviewEditModeEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  previewWordMeaningsDisplayMode: string;
  setPreviewWordMeaningsDisplayMode: React.Dispatch<React.SetStateAction<"inline" | "table" | "hide">>;
  previewFontSizePercent: number;
  setPreviewFontSizePercent: React.Dispatch<React.SetStateAction<number>>;
  hiddenPreviewLevels: Set<string>;
  setHiddenPreviewLevels: React.Dispatch<React.SetStateAction<Set<string>>>;

  // Language settings
  bookPreviewLanguageSettings: BookPreviewLanguageSettings;
  setBookPreviewLanguageSettings: React.Dispatch<React.SetStateAction<BookPreviewLanguageSettings>>;
  previewTransliterationScript: TransliterationScriptOption;
  setBookPreviewTransliterationScript: React.Dispatch<React.SetStateAction<TransliterationScriptOption>>;
  previewTranslationLanguages: EditableTranslationLanguage[];
  setPreviewTranslationLanguages: React.Dispatch<React.SetStateAction<EditableTranslationLanguage[]>>;
  previewVariantAuthorSlugs: string[];
  setPreviewVariantAuthorSlugs: React.Dispatch<React.SetStateAction<string[]>>;

  // Computed display state
  anyPreviewLanguageVisible: boolean;
  hasPendingPreviewSettingChanges: boolean;
  availablePreviewLevels: string[];
  availableVariantAuthors: Map<string, string>;
  appliedShowPreviewDetails: boolean;
  appliedShowPreviewMedia: boolean;
  previewBodyTextStyle: React.CSSProperties;
  previewBodyBlockElements: React.ReactElement[];

  // Context
  selectedId: number | null;
  bookId: string;
  currentBook: BookDetails | null;
  canEditCurrentBook: boolean;
  canBrowseCurrentNode: boolean;
  sourceLanguage: string;

  // Handlers
  handleClosePreview: () => void;
  handlePreviewBook: (scope: "book" | "node") => Promise<void>;
  handlePreviewSiblingNavigation: (direction: "previous" | "next") => Promise<void>;
  handleBrowseFromPreview: (targetBookId: string, targetNodeId?: number | null) => void;
  openShareDialogForBook: (state: ShareDialogState) => Promise<void>;
  openPdfExportDialog: (bookId: number, bookName?: string, options?: { preferPreviewScope?: boolean }) => void;
  handleBookPreviewScroll: () => void;

  // Component-level helpers (close over treeData or other state)
  getBookMediaLabel: (media: import("../../lib/scriptureTypes").BookMediaItem) => string;
  getPreviewBreadcrumbTitle: (artifact: BookPreviewArtifact) => string;
  getPreviewHierarchicalPath: (artifact: BookPreviewArtifact) => string;
  getPreviewSiblingNavigation: (artifact: BookPreviewArtifact) => { previousSiblingId: number | null; nextSiblingId: number | null };
  getDisplayLevelName: (levelName: string | null | undefined) => string;
  resolveBookVisibility: (value: unknown) => "private" | "public";
  buildScripturesPreviewPath: (scope: "book" | "node", bookId: string, nodeId?: number | null) => string;
  toAbsoluteUrl: (relativePath: string) => string;
  renderInlineMediaPreview: (mediaType: string, rawUrl: string, label: string, mode?: "thumb" | "full") => React.ReactNode;
};

export default function BookPreviewOverlay({
  bookPreviewArtifact,
  bookPreviewOverlayRef,
  bookPreviewScrollContainerRef,
  previewShareMenuRef,
  bookPreviewLoading,
  bookPreviewLoadingMore,
  previewLoadingMessageWithElapsed,
  previewLinkMessage,
  showPreviewControls,
  setShowPreviewControls,
  previewControlsTab,
  setPreviewControlsTab,
  showPreviewTitles,
  setShowPreviewTitles,
  showPreviewLabels,
  setShowPreviewLabels,
  showPreviewLevelNumbers,
  setShowPreviewLevelNumbers,
  showPreviewDetails,
  setShowPreviewDetails,
  showPreviewMedia,
  setShowPreviewMedia,
  previewEditModeEnabled,
  setPreviewEditModeEnabled,
  previewWordMeaningsDisplayMode,
  setPreviewWordMeaningsDisplayMode,
  previewFontSizePercent,
  setPreviewFontSizePercent,
  hiddenPreviewLevels,
  setHiddenPreviewLevels,
  bookPreviewLanguageSettings,
  setBookPreviewLanguageSettings,
  previewTransliterationScript,
  setBookPreviewTransliterationScript,
  previewTranslationLanguages,
  setPreviewTranslationLanguages,
  previewVariantAuthorSlugs,
  setPreviewVariantAuthorSlugs,
  anyPreviewLanguageVisible,
  hasPendingPreviewSettingChanges,
  availablePreviewLevels,
  availableVariantAuthors,
  appliedShowPreviewDetails,
  appliedShowPreviewMedia,
  previewBodyTextStyle,
  previewBodyBlockElements,
  selectedId,
  bookId,
  currentBook,
  canEditCurrentBook,
  canBrowseCurrentNode,
  sourceLanguage,
  handleClosePreview,
  handlePreviewBook,
  handlePreviewSiblingNavigation,
  handleBrowseFromPreview,
  openShareDialogForBook,
  openPdfExportDialog,
  handleBookPreviewScroll,
  getBookMediaLabel,
  getPreviewBreadcrumbTitle,
  getPreviewHierarchicalPath,
  getPreviewSiblingNavigation,
  getDisplayLevelName,
  resolveBookVisibility,
  buildScripturesPreviewPath,
  toAbsoluteUrl,
  renderInlineMediaPreview,
}: Props) {
  return (
          <div
            ref={bookPreviewOverlayRef}
            className="fixed inset-0 z-50 overflow-x-hidden bg-[color:var(--paper)]/98 backdrop-blur-[1px]"
          >
            <div className="flex h-[100svh] w-full min-w-0 flex-col overflow-x-hidden bg-[color:var(--paper)]">
              <div className="border-b border-black/10 bg-[color:var(--paper)] px-3 py-2 sm:px-4 sm:py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                  <h2 className="font-[var(--font-display)] text-xl text-[color:var(--deep)] sm:text-2xl">
                    {bookPreviewArtifact.preview_scope === "node"
                      ? (() => {
                          const hierarchicalPath = getPreviewHierarchicalPath(bookPreviewArtifact);
                          return hierarchicalPath ? `Reader View (${hierarchicalPath})` : "Reader View";
                        })()
                      : "Book Preview"}
                  </h2>
                  <p className="text-xs text-zinc-600 sm:text-sm">
                    {getPreviewBreadcrumbTitle(bookPreviewArtifact)}
                  </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleClosePreview}
                    disabled={showPreviewControls}
                    title="Close preview"
                    aria-label="Close preview"
                    className="shrink-0 rounded-full p-1 text-zinc-400 transition hover:bg-black/5 hover:text-zinc-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <X className="h-6 w-6 sm:h-7 sm:w-7" />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 sm:justify-end">
                  {(() => {
                    const previewScope = bookPreviewArtifact.preview_scope === "node" ? "node" : "book";
                    const targetNodeId =
                      previewScope === "node" && typeof bookPreviewArtifact.root_node_id === "number"
                        ? bookPreviewArtifact.root_node_id
                        : previewScope === "node"
                          ? selectedId
                          : null;
                    const previewPath = buildScripturesPreviewPath(previewScope, bookId, targetNodeId);
                    const { previousSiblingId, nextSiblingId } = getPreviewSiblingNavigation(
                      bookPreviewArtifact
                    );
                    return (
                      <>
                        {previewScope === "node" && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                void handlePreviewSiblingNavigation("previous");
                              }}
                              disabled={showPreviewControls || !previousSiblingId}
                              title="Previous sibling"
                              aria-label="Previous sibling"
                              className="rounded-full border border-black/10 p-2 text-zinc-600 transition hover:border-black/20 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                void handlePreviewSiblingNavigation("next");
                              }}
                              disabled={showPreviewControls || !nextSiblingId}
                              title="Next sibling"
                              aria-label="Next sibling"
                              className="rounded-full border border-black/10 p-2 text-zinc-600 transition hover:border-black/20 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        <div ref={previewShareMenuRef} className="relative">
                          <button
                            type="button"
                            onClick={() => {
                              const visibility = resolveBookVisibility(currentBook?.visibility);
                              const shareTarget: ShareDialogLinkOption["target"] = previewScope === "node"
                                ? "node"
                                : "book";
                              const linkOptions: ShareDialogLinkOption[] = visibility === "public"
                                ? [
                                    {
                                      key: "preview",
                                      label: "Preview link",
                                      url: toAbsoluteUrl(previewPath),
                                      emailSubject: "Shared scripture preview link",
                                      emailBody: `Here is the preview link:\n\n${toAbsoluteUrl(previewPath)}`,
                                      target: shareTarget,
                                    },
                                  ]
                                : [];
                              void openShareDialogForBook({
                                  bookId,
                                  bookName: currentBook?.book_name || "Book",
                                  visibility,
                                  canManageShares: visibility === "private" && canEditCurrentBook,
                                  description: visibility === "public"
                                    ? "Copy or email a public link for this view."
                                    : "Invite existing or new users to this private book. Invitees must finish registration before access is granted.",
                                  linkOptions,
                                  privateAccessPath:
                                    previewScope === "node"
                                      ? buildScripturesPreviewPath("node", bookId, targetNodeId)
                                      : buildScripturesPreviewPath("book", bookId),
                                  privateCopyTarget: shareTarget,
                                });
                              }}
                            disabled={showPreviewControls}
                            title="Share"
                            aria-label="Share"
                            className="rounded-full border border-black/10 p-2 text-zinc-600 transition hover:border-black/20 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Share2 className="h-4 w-4" />
                          </button>
                        </div>
                        {canBrowseCurrentNode && (
                          <button
                            type="button"
                            onClick={() => {
                              handleBrowseFromPreview(bookId, targetNodeId);
                            }}
                            disabled={showPreviewControls}
                            title="Browse"
                            aria-label="Browse"
                            className="rounded-full border border-black/10 p-2 text-zinc-600 transition hover:border-black/20 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <BookOpen className="h-4 w-4" />
                          </button>
                        )}
                      </>
                    );
                  })()}
                  <button
                    type="button"
                    onClick={() => setShowPreviewControls((prev) => !prev)}
                    title={showPreviewControls ? "Hide controls" : "Show controls"}
                    aria-label={showPreviewControls ? "Hide controls" : "Show controls"}
                    className={`rounded-full border p-2 transition ${
                      showPreviewControls
                        ? "border-[color:var(--accent)] bg-[color:var(--accent)] text-white shadow-sm"
                        : "border-black/10 text-zinc-600 hover:border-black/20"
                    }`}
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      openPdfExportDialog(bookPreviewArtifact.book_id, bookPreviewArtifact.book_name, {
                        preferPreviewScope: true,
                      });
                    }}
                    disabled={showPreviewControls}
                    title="View PDF"
                    aria-label="View PDF"
                    className="rounded-full border border-black/10 p-2 text-zinc-600 transition hover:border-black/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <FileText className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {showPreviewControls && (
                <div className="border-b border-black/10 bg-[color:var(--paper)] px-3 py-2 sm:px-4 sm:py-2.5">
                  <div className="w-full rounded-lg border border-black/10 bg-white/90 p-2.5">
                    <div className="mb-2 flex items-center gap-2 border-b border-black/10 pb-2">
                      <button
                        type="button"
                        onClick={() => setPreviewControlsTab("content")}
                        className={`rounded-full px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] transition ${
                          previewControlsTab === "content"
                            ? "bg-[color:var(--accent)] text-white"
                            : "border border-black/10 bg-white text-zinc-600 hover:border-black/20"
                        }`}
                      >
                        Content
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewControlsTab("translations")}
                        className={`rounded-full px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] transition ${
                          previewControlsTab === "translations"
                            ? "bg-[color:var(--accent)] text-white"
                            : "border border-black/10 bg-white text-zinc-600 hover:border-black/20"
                        }`}
                      >
                        Translations & Commentaries
                      </button>
                    </div>

                    {/* Scrollable options area — capped on mobile so Apply is never buried */}
                    <div className="max-h-[40vh] space-y-2 overflow-y-auto sm:max-h-none">
                      {previewControlsTab === "content" && (
                        <>
                          <div>
                            <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Preview Options</div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-sm text-zinc-700">
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={showPreviewTitles}
                                  onChange={(event) => setShowPreviewTitles(event.target.checked)}
                                  disabled={bookPreviewLoading}
                                />
                                Show titles
                              </label>
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={showPreviewLabels}
                                  onChange={(event) => setShowPreviewLabels(event.target.checked)}
                                  disabled={bookPreviewLoading}
                                />
                                Show labels
                              </label>
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={showPreviewLevelNumbers}
                                  onChange={(event) => setShowPreviewLevelNumbers(event.target.checked)}
                                  disabled={bookPreviewLoading}
                                />
                                Show level numbers
                              </label>
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={showPreviewDetails}
                                  onChange={(event) => setShowPreviewDetails(event.target.checked)}
                                  disabled={bookPreviewLoading}
                                />
                                Show template details
                              </label>
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={showPreviewMedia}
                                  onChange={(event) => setShowPreviewMedia(event.target.checked)}
                                  disabled={bookPreviewLoading}
                                />
                                Show multimedia
                              </label>
                              {canEditCurrentBook && (
                                <label className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={previewEditModeEnabled}
                                    onChange={(event) => setPreviewEditModeEnabled(event.target.checked)}
                                    disabled={bookPreviewLoading}
                                  />
                                  Edit Mode
                                </label>
                              )}
                              <label className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-zinc-500">
                                Word meanings
                                <select
                                  value={previewWordMeaningsDisplayMode}
                                  onChange={(event) =>
                                    setPreviewWordMeaningsDisplayMode(
                                      normalizePreviewWordMeaningsDisplayMode(event.target.value)
                                    )
                                  }
                                  disabled={bookPreviewLoading}
                                  className="rounded-lg border border-black/10 bg-white/90 px-2 py-1 text-xs normal-case tracking-normal text-zinc-700 outline-none focus:border-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <option value="hide">Hide</option>
                                  <option value="inline">Inline</option>
                                  <option value="table">Table</option>
                                </select>
                              </label>
                            </div>
                          </div>

                          <div className="rounded-lg border border-black/10 bg-white/70 px-2 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs uppercase tracking-[0.14em] text-zinc-600">
                                Reader Font Size
                              </span>
                              <span className="text-xs font-semibold text-zinc-700">{previewFontSizePercent}%</span>
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setPreviewFontSizePercent((prev) =>
                                    normalizePreviewFontSizePercent(prev - PREVIEW_FONT_SIZE_PERCENT_STEP)
                                  )
                                }
                                disabled={bookPreviewLoading}
                                className="min-h-9 min-w-9 rounded-lg border border-black/10 bg-white px-2 text-sm font-medium text-zinc-700 disabled:opacity-50"
                                aria-label="Decrease reader font size"
                              >
                                A-
                              </button>
                              <input
                                type="range"
                                min={PREVIEW_FONT_SIZE_PERCENT_MIN}
                                max={PREVIEW_FONT_SIZE_PERCENT_MAX}
                                step={PREVIEW_FONT_SIZE_PERCENT_STEP}
                                value={previewFontSizePercent}
                                onChange={(event) =>
                                  setPreviewFontSizePercent(
                                    normalizePreviewFontSizePercent(event.target.value)
                                  )
                                }
                                disabled={bookPreviewLoading}
                                className="h-9 w-full"
                                aria-label="Reader font size"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setPreviewFontSizePercent((prev) =>
                                    normalizePreviewFontSizePercent(prev + PREVIEW_FONT_SIZE_PERCENT_STEP)
                                  )
                                }
                                disabled={bookPreviewLoading}
                                className="min-h-9 min-w-9 rounded-lg border border-black/10 bg-white px-2 text-sm font-medium text-zinc-700 disabled:opacity-50"
                                aria-label="Increase reader font size"
                              >
                                A+
                              </button>
                            </div>
                          </div>

                          {availablePreviewLevels.length > 1 && (
                            <div>
                              <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Show Levels</div>
                              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-sm text-zinc-700">
                                {availablePreviewLevels.map((level) => (
                                  <label key={`preview-level-${level}`} className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={!hiddenPreviewLevels.has(level)}
                                      onChange={(event) => {
                                        setHiddenPreviewLevels((prev) => {
                                          const next = new Set(prev);
                                          if (event.target.checked) {
                                            next.delete(level);
                                          } else {
                                            next.add(level);
                                          }
                                          return next;
                                        });
                                      }}
                                      disabled={bookPreviewLoading}
                                    />
                                    {getDisplayLevelName(level)}
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}

                      {previewControlsTab === "translations" && (
                        <div>
                          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Preview Languages</div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-sm text-zinc-700">
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={bookPreviewLanguageSettings.show_sanskrit}
                                onChange={(event) =>
                                  setBookPreviewLanguageSettings((prev) => ({
                                    ...prev,
                                    show_sanskrit: event.target.checked,
                                  }))
                                }
                                disabled={bookPreviewLoading}
                              />
                              Sanskrit
                            </label>
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={bookPreviewLanguageSettings.show_transliteration}
                                onChange={(event) =>
                                  setBookPreviewLanguageSettings((prev) => ({
                                    ...prev,
                                    show_transliteration: event.target.checked,
                                  }))
                                }
                                disabled={bookPreviewLoading}
                              />
                              Transliteration
                            </label>
                            <label className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-zinc-500">
                              Script
                              <select
                                value={previewTransliterationScript}
                                onChange={(event) =>
                                  setBookPreviewTransliterationScript(
                                    normalizeTransliterationScript(event.target.value)
                                  )
                                }
                                disabled={bookPreviewLoading || !bookPreviewLanguageSettings.show_transliteration}
                                className="rounded-lg border border-black/10 bg-white/90 px-2 py-1 text-xs normal-case tracking-normal text-zinc-700 outline-none focus:border-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {TRANSLITERATION_SCRIPT_OPTIONS.map((scriptOption) => (
                                  <option key={scriptOption} value={scriptOption}>
                                    {transliterationScriptLabel(scriptOption)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={bookPreviewLanguageSettings.show_english}
                                onChange={(event) =>
                                  setBookPreviewLanguageSettings((prev) => ({
                                    ...prev,
                                    show_english: event.target.checked,
                                  }))
                                }
                                disabled={bookPreviewLoading}
                              />
                              Translations
                            </label>
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={bookPreviewLanguageSettings.show_commentary}
                                onChange={(event) =>
                                  setBookPreviewLanguageSettings((prev) => ({
                                    ...prev,
                                    show_commentary: event.target.checked,
                                  }))
                                }
                                disabled={bookPreviewLoading}
                              />
                              Commentaries
                            </label>
                            <details className="rounded-lg border border-black/10 bg-white/70 px-2 py-1.5">
                              <summary className="cursor-pointer list-none text-xs uppercase tracking-[0.14em] text-zinc-600">
                                Languages ({previewTranslationLanguages.length} selected)
                              </summary>
                              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-zinc-700 sm:grid-cols-3">
                                {EDITABLE_TRANSLATION_LANGUAGES.map((language) => (
                                  <label key={`preview-translation-${language}`} className="flex items-center gap-1.5">
                                    <input
                                      type="checkbox"
                                      checked={previewTranslationLanguages.includes(language)}
                                      onChange={(event) => {
                                        const nextValues = event.target.checked
                                          ? [...previewTranslationLanguages, language]
                                          : previewTranslationLanguages.filter((value) => value !== language);
                                        setPreviewTranslationLanguages(
                                          normalizeSelectedEditableTranslationLanguages(nextValues, sourceLanguage)
                                        );
                                      }}
                                      disabled={bookPreviewLoading}
                                    />
                                    {translationLanguageLabel(language)}
                                  </label>
                                ))}
                              </div>
                            </details>
                            {availableVariantAuthors.size > 0 && (
                              <details className="rounded-lg border border-black/10 bg-white/70 px-2 py-1.5">
                                <summary className="cursor-pointer list-none text-xs uppercase tracking-[0.14em] text-zinc-600">
                                  Authors ({previewVariantAuthorSlugs.length === 0 ? "all" : `${previewVariantAuthorSlugs.length} selected`})
                                </summary>
                                <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-zinc-700">
                                  {Array.from(availableVariantAuthors.entries()).map(([slug, name]) => {
                                    const allSlugs = Array.from(availableVariantAuthors.keys());
                                    const isChecked = previewVariantAuthorSlugs.length === 0 || previewVariantAuthorSlugs.includes(slug);
                                    return (
                                      <label key={`author-filter-${slug}`} className="flex items-center gap-1.5">
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={(event) => {
                                            setPreviewVariantAuthorSlugs((prev) => {
                                              const currentSet = new Set(prev.length === 0 ? allSlugs : prev);
                                              if (event.target.checked) {
                                                currentSet.add(slug);
                                              } else {
                                                currentSet.delete(slug);
                                              }
                                              // Empty array means "all selected"
                                              if (currentSet.size >= allSlugs.length) return [];
                                              return Array.from(currentSet);
                                            });
                                          }}
                                          disabled={bookPreviewLoading}
                                        />
                                        {name}
                                        <span className="text-zinc-400">({slug})</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </details>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    {/* Apply button — always visible outside the scrollable area */}
                    <div className="mt-2.5 flex justify-end border-t border-black/[0.06] pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          const currentScope =
                            bookPreviewArtifact.preview_scope === "node" ? "node" : "book";
                          void handlePreviewBook(currentScope);
                        }}
                        disabled={
                          bookPreviewLoading || !anyPreviewLanguageVisible || !hasPendingPreviewSettingChanges
                        }
                        className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {bookPreviewLoading ? "Applying..." : "Apply"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div
                ref={bookPreviewScrollContainerRef}
                onScroll={handleBookPreviewScroll}
                className="flex-1 w-full overflow-y-auto overflow-x-hidden px-2.5 pb-1.5 pt-0.5 sm:px-3"
              >
                {previewLinkMessage && (
                  <div className="mb-1.5 rounded-lg border border-black/10 bg-white/90 px-3 py-1.5 text-xs text-zinc-700">
                    {previewLinkMessage}
                  </div>
                )}
                {bookPreviewLoading && (
                  <div className="mb-1.5 flex items-center gap-2 rounded-lg border border-black/10 bg-white/90 px-3 py-1.5 text-sm text-zinc-700">
                    <span
                      aria-hidden
                      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700"
                    />
                    <span>{previewLoadingMessageWithElapsed}</span>
                  </div>
                )}

                {bookPreviewArtifact.warnings && bookPreviewArtifact.warnings.length > 0 && (
                  <div className="mb-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-700">
                    {bookPreviewArtifact.warnings.join(" ")}
                  </div>
                )}

                {appliedShowPreviewDetails && bookPreviewArtifact.book_template && (
                  <div className="mb-1.5 rounded-lg border border-black/10 bg-white/90 p-2">
                    <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      {bookPreviewArtifact.preview_scope === "node" ? "Level Template" : "Book Template"}
                    </div>
                    <div className="mt-0.5 text-sm font-semibold text-[color:var(--deep)]">
                      {bookPreviewArtifact.book_template.template_key}
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      Children rendered: {bookPreviewArtifact.book_template.child_count}
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-zinc-700" style={previewBodyTextStyle}>
                      {bookPreviewArtifact.book_template.rendered_text ||
                        (bookPreviewArtifact.preview_scope === "node"
                          ? "No rendered level summary."
                          : "No rendered book-level summary.")}
                    </p>
                  </div>
                )}

                {bookPreviewArtifact.preview_scope === "book" && appliedShowPreviewMedia && (bookPreviewArtifact.book_media_items || []).length > 0 && (
                  <div className="mb-1.5 flex flex-col gap-2">
                    {(bookPreviewArtifact.book_media_items || []).map((media, index) => {
                      const label = getBookMediaLabel(media);
                      const mediaType = (media.media_type || "link").trim().toLowerCase();
                      return (
                        <div key={`${mediaType}:${media.url}:${media.asset_id || index}`} className="contents">
                          {renderInlineMediaPreview(mediaType, media.url, label)}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="space-y-1.5 [&_input]:text-base [&_textarea]:text-base [&_select]:text-base sm:[&_input]:text-sm sm:[&_textarea]:text-sm sm:[&_select]:text-sm">
                  {previewBodyBlockElements.length === 0 ? (
                    <p className="rounded-lg border border-black/10 bg-white/70 px-3 py-1.5 text-sm text-zinc-500">
                      {bookPreviewArtifact.preview_scope === "node"
                        ? "No previewable content found under this level."
                        : "No previewable content found for this book."}
                    </p>
                  ) : (
                    previewBodyBlockElements
                  )}

                  {(bookPreviewLoadingMore || (bookPreviewArtifact.preview_scope === "book" && bookPreviewArtifact.has_more)) && (
                    <div className="py-1.5 text-center text-xs text-zinc-500">
                      {bookPreviewLoadingMore ? "Loading more…" : "Scroll to load more"}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
  );
}
