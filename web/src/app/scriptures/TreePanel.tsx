"use client";

import React from "react";
import {
  Pencil,
  ChevronsDown,
  ChevronsUp,
  ChevronUp,
  ChevronDown,
  MoreVertical,
} from "lucide-react";
import type { TreeNode, BookOption, BookDetails, AuthorVariantDraft } from "../../lib/scriptureTypes";
import type { EditableTranslationLanguage } from "../../lib/translationUtils";
import {
  buildEditableTranslationDrafts,
  normalizeSelectedEditableTranslationLanguages,
} from "../../lib/translationUtils";
import {
  formatValue,
  formatSequenceDisplay,
  parseSequenceNumber,
} from "../../lib/scriptureUtils";
import type { NodeEditorFormData } from "./NodeEditorForm";

const BOOK_ROOT_NODE_ID = 0;

type TreeDropTarget = { parentId: number; nodeId: number; position: "before" | "after" };

type Props = {
  // Tree data
  treeData: TreeNode[];
  treeLoading: boolean;
  treeError: string | null;
  bookId: string;
  selectedId: number | null;
  expandedIds: Set<number>;
  setExpandedIds: React.Dispatch<React.SetStateAction<Set<number>>>;
  selectedBookOption: BookOption | null;
  isBookRootSelected: boolean;
  currentBook: BookDetails | null;

  // Browse actions
  toggleNode: (nodeId: number) => void;
  selectNode: (nodeId: number, syncUrl?: boolean, expandPath?: boolean) => void;
  selectBookRoot: (syncUrl?: boolean) => void;

  // Tree edit mode
  treeEditMode: boolean;
  setTreeEditMode: React.Dispatch<React.SetStateAction<boolean>>;
  canContribute: boolean;
  canEditCurrentBook: boolean;

  // Reorder state
  treeReorderModeNodeId: number | null;
  setTreeReorderModeNodeId: (id: React.SetStateAction<number | null>) => void;
  treeReorderModeParentId: number | null;
  treeReorderingNodeId: number | null;
  treeReorderDraftByParentId: Record<number, number[]>;
  setTreeReorderDraftByParentId: React.Dispatch<React.SetStateAction<Record<number, number[]>>>;
  treeReorderDraggingNodeId: number | null;
  setTreeReorderDraggingNodeId: React.Dispatch<React.SetStateAction<number | null>>;
  treeReorderSavingParentId: number | null;
  setTreeReorderSavingParentId: React.Dispatch<React.SetStateAction<number | null>>;
  treeReorderHasPendingChanges: boolean;
  treeReorderDropTarget: TreeDropTarget | null;
  treeReorderDropTargetRef: React.MutableRefObject<TreeDropTarget | null>;
  setTreeReorderDropTargetSynced: (next: TreeDropTarget | null) => void;

  // Reorder actions
  applyTreeReorderDraft: (parentId: number, nextSiblingIds: number[]) => void;
  moveTreeReorderDraftNode: (parentId: number, draggedNodeId: number, targetNodeId: number) => void;
  applyTreeDropAtIndicator: (draggedId: number) => boolean;
  saveAllTreeReorderDrafts: () => Promise<void>;
  cancelAllTreeReorderDrafts: () => void;

  // Tree helpers (component-level, not module-level)
  canAddChild: (node: TreeNode) => boolean;
  getNextLevelName: (parentNode: TreeNode) => string;
  findPath: (nodes: TreeNode[], targetId: number) => TreeNode[] | null;
  findNodeById: (nodes: TreeNode[], id: number) => TreeNode | null;
  normalizeLevelName: (value: string) => string;
  getSchemaMatchedLevelName: (levelName: string, levelOrder?: number | null) => string;
  getDisplayLevelName: (levelName: string | null | undefined) => string;

  // Anonymous sign-in gate
  privateBookGate: boolean;
  signInFromShareHref: string;
  signUpFromShareHref: string;

  // Node creation (for add-child button in renderTree)
  sourceLanguage: string;
  setActionNode: React.Dispatch<React.SetStateAction<TreeNode | null>>;
  setCreateParentNodeIdOverride: React.Dispatch<React.SetStateAction<number | null>>;
  setCreateInsertAfterNodeId: React.Dispatch<React.SetStateAction<number | null>>;
  setFormData: React.Dispatch<React.SetStateAction<NodeEditorFormData>>;
  setModalTranslationDrafts: React.Dispatch<React.SetStateAction<Record<EditableTranslationLanguage, string>>>;
  setModalSelectedTranslationLanguages: React.Dispatch<React.SetStateAction<EditableTranslationLanguage[]>>;
  setModalTranslationVariants: React.Dispatch<React.SetStateAction<AuthorVariantDraft[]>>;
  setModalCommentaryVariants: React.Dispatch<React.SetStateAction<AuthorVariantDraft[]>>;
  setAction: React.Dispatch<React.SetStateAction<"add" | "edit" | null>>;

  // Mobile panel
  mobilePanel: string;
};

export default function TreePanel({
  treeData,
  treeLoading,
  treeError,
  bookId,
  selectedId,
  expandedIds,
  setExpandedIds,
  selectedBookOption,
  isBookRootSelected,
  currentBook,
  toggleNode,
  selectNode,
  selectBookRoot,
  treeEditMode,
  setTreeEditMode,
  canContribute,
  canEditCurrentBook,
  treeReorderModeNodeId,
  setTreeReorderModeNodeId,
  treeReorderModeParentId,
  treeReorderingNodeId,
  treeReorderDraftByParentId,
  setTreeReorderDraftByParentId,
  treeReorderDraggingNodeId,
  setTreeReorderDraggingNodeId,
  treeReorderSavingParentId,
  setTreeReorderSavingParentId,
  treeReorderHasPendingChanges,
  treeReorderDropTarget,
  treeReorderDropTargetRef,
  setTreeReorderDropTargetSynced,
  applyTreeReorderDraft,
  moveTreeReorderDraftNode,
  applyTreeDropAtIndicator,
  saveAllTreeReorderDrafts,
  cancelAllTreeReorderDrafts,
  canAddChild,
  getNextLevelName,
  findPath,
  findNodeById,
  normalizeLevelName,
  getSchemaMatchedLevelName,
  getDisplayLevelName,
  privateBookGate,
  signInFromShareHref,
  signUpFromShareHref,
  sourceLanguage,
  setActionNode,
  setCreateParentNodeIdOverride,
  setCreateInsertAfterNodeId,
  setFormData,
  setModalTranslationDrafts,
  setModalSelectedTranslationLanguages,
  setModalTranslationVariants,
  setModalCommentaryVariants,
  setAction,
  mobilePanel,
}: Props) {
  const renderTree = (nodes: TreeNode[], depth = 0) => {
    const canEditTreeOrder = treeEditMode && (canContribute || canEditCurrentBook);

    const canonicalSorted = [...nodes].sort((a, b) => {
      const seqA = parseSequenceNumber(a.sequence_number) ?? Infinity;
      const seqB = parseSequenceNumber(b.sequence_number) ?? Infinity;
      return seqA - seqB;
    });

    const parentIdForGroup =
      canonicalSorted.length > 0
        ? canonicalSorted[0].parent_node_id ?? BOOK_ROOT_NODE_ID
        : BOOK_ROOT_NODE_ID;
    const isReorderGroupActive =
      canEditTreeOrder &&
      treeReorderModeParentId !== null &&
      treeReorderModeParentId === parentIdForGroup;

    const canonicalSiblingIds = canonicalSorted.map((sibling) => sibling.id);
    const hasValidDraftForGroup = (candidate: number[] | undefined) =>
      Array.isArray(candidate) &&
      candidate.length === canonicalSiblingIds.length &&
      candidate.every((id) => canonicalSiblingIds.includes(id));

    const ensureDraftForGroup = () => {
      const currentDraft = treeReorderDraftByParentId[parentIdForGroup];
      if (!hasValidDraftForGroup(currentDraft)) {
        applyTreeReorderDraft(parentIdForGroup, canonicalSiblingIds);
      }
    };

    const draftOrder = treeReorderDraftByParentId[parentIdForGroup];
    const sorted =
      isReorderGroupActive && Array.isArray(draftOrder) && draftOrder.length === canonicalSorted.length
        ? (() => {
            const byId = new Map(canonicalSorted.map((node) => [node.id, node]));
            const reordered = draftOrder
              .map((id) => byId.get(id))
              .filter((node): node is TreeNode => Boolean(node));
            if (reordered.length === canonicalSorted.length) {
              return reordered;
            }
            return canonicalSorted;
          })()
        : canonicalSorted;

    const lastNodeInGroup = sorted.length > 0 ? sorted[sorted.length - 1] : null;

    return (
      <>
        {sorted.map((node, index) => (
          <div
            key={node.id}
            className="relative mt-2"
            onDragOver={(event) => {
              if (!canEditTreeOrder) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = "move";
              const rect = event.currentTarget.getBoundingClientRect();
              const nextPosition = event.clientY - rect.top < rect.height / 2 ? "before" : "after";
              const nextTarget = {
                parentId: parentIdForGroup,
                nodeId: node.id,
                position: nextPosition,
              } as const;
              const prev = treeReorderDropTargetRef.current;
              if (
                prev &&
                prev.parentId === nextTarget.parentId &&
                prev.nodeId === nextTarget.nodeId &&
                prev.position === nextTarget.position
              ) {
                return;
              }
              setTreeReorderDropTargetSynced(nextTarget);
            }}
            onDrop={(event) => {
              if (!canEditTreeOrder) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              const draggedIdRaw = event.dataTransfer.getData("text/plain");
              const draggedId = Number.parseInt(draggedIdRaw, 10);
              if (!Number.isFinite(draggedId)) {
                return;
              }
              applyTreeDropAtIndicator(draggedId);
            }}
          >
        <div
          className={`flex flex-nowrap items-start gap-2 text-sm ${
            isReorderGroupActive ? "rounded-md px-1 py-0.5" : ""
          } ${
            isReorderGroupActive && treeReorderDraggingNodeId === node.id
              ? "opacity-60"
              : ""
          } ${canEditTreeOrder ? "select-none" : ""}`}
          draggable={canEditTreeOrder}
          onDragStart={(event) => {
            if (!canEditTreeOrder) {
              return;
            }
            const target = event.target as HTMLElement | null;
            if (target?.closest('[data-no-row-drag="true"]')) {
              event.preventDefault();
              return;
            }
            ensureDraftForGroup();
            setTreeReorderModeNodeId(node.id);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", String(node.id));
            setTreeReorderDraggingNodeId(node.id);
          }}
          onDragEnd={() => {
            setTreeReorderDraggingNodeId(null);
            setTreeReorderDropTargetSynced(null);
          }}
          style={canEditTreeOrder ? { cursor: "grab" } : undefined}
        >
          {canEditTreeOrder ? (
            <span
              className="flex h-6 w-6 shrink-0 cursor-grab items-center justify-center rounded border border-black/10 bg-white/80 text-zinc-500 transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
              title="Drag to reorder"
              aria-label="Drag to reorder"
            >
              <MoreVertical size={14} />
            </span>
          ) : null}
          <span className="shrink-0">
            {node.children && node.children.length > 0 ? (
              <button
                type="button"
                data-no-row-drag="true"
                onClick={() => toggleNode(node.id)}
                className="h-6 w-6 rounded-full border border-black/10 bg-white/80 text-xs text-zinc-500 transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
              >
                {expandedIds.has(node.id) ? "-" : "+"}
              </button>
            ) : (
              <span aria-hidden className="block h-6 w-6" />
            )}
          </span>
          <button
            type="button"
            onClick={() => {
              if (!canEditTreeOrder) {
                selectNode(node.id, true, false);
                return;
              }
              ensureDraftForGroup();
              setTreeReorderModeNodeId(node.id);
            }}
            title={`${formatValue(node.level_name) || "Level"} ${
              formatSequenceDisplay(
                node.sequence_number ?? node.id,
                !node.children || node.children.length === 0
              ) || node.id
            }`}
            id={`tree-node-${node.id}`}
            className={`min-w-0 flex items-center gap-2 px-1 text-sm font-medium transition ${
              selectedId === node.id
                ? "text-[color:var(--accent)]"
                : "text-[color:var(--deep)] hover:text-[color:var(--accent)]"
            } ${canEditTreeOrder ? "select-none" : ""}`}
          >
            <span className="leading-snug truncate">
              {(() => {
                const isLeaf = !node.children || node.children.length === 0;
                const displaySeq =
                  formatSequenceDisplay(node.sequence_number ?? node.id, isLeaf) ||
                  node.id.toString();
                const titleText =
                  formatValue(node.title_english) ||
                  formatValue(node.title_sanskrit) ||
                  formatValue(node.title_transliteration);
                if (isLeaf) {
                  return titleText
                    ? `${displaySeq}. ${titleText}`
                    : `${formatValue(node.level_name) || "Level"} ${displaySeq}`;
                }
                if (titleText) {
                  return `${displaySeq}. ${titleText}`;
                }
                if (node.children && node.children.length > 0) {
                  return `${displaySeq}. ${formatValue(node.level_name) || "Untitled"}`;
                }
                return `${formatValue(node.level_name) || "Level"} ${displaySeq}`;
              })()}
            </span>
          </button>
          {canEditTreeOrder && (
            <div className="flex items-center gap-1">
              {isReorderGroupActive && treeReorderModeNodeId === node.id && (
                <>
                  <button
                    type="button"
                    data-no-row-drag="true"
                    onClick={() => {
                      if (index <= 0) {
                        return;
                      }
                      const previousSibling = sorted[index - 1];
                      if (!previousSibling) {
                        return;
                      }
                      moveTreeReorderDraftNode(parentIdForGroup, node.id, previousSibling.id);
                    }}
                    title="Move up"
                    aria-label="Move up"
                    disabled={index === 0 || treeReorderSavingParentId !== null}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-black/10 bg-white/80 text-zinc-600 transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    type="button"
                    data-no-row-drag="true"
                    onClick={() => {
                      if (index >= sorted.length - 1) {
                        return;
                      }
                      const nextSibling = sorted[index + 1];
                      if (!nextSibling) {
                        return;
                      }
                      moveTreeReorderDraftNode(parentIdForGroup, node.id, nextSibling.id);
                    }}
                    title="Move down"
                    aria-label="Move down"
                    disabled={index === sorted.length - 1 || treeReorderSavingParentId !== null}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-black/10 bg-white/80 text-zinc-600 transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <ChevronDown size={14} />
                  </button>
                </>
              )}
            </div>
          )}
          {treeEditMode && (canContribute || canEditCurrentBook) && canAddChild(node) && (
            <button
              type="button"
              data-no-row-drag="true"
              onClick={() => {
                const nextLevel = getNextLevelName(node);
                let insertAfterNodeId: number | null = null;

                if (selectedId) {
                  const selectedPath = findPath(treeData, selectedId);
                  const selectedNode = findNodeById(treeData, selectedId);
                  const selectedParentId =
                    selectedPath && selectedPath.length > 1
                      ? selectedPath[selectedPath.length - 2].id
                      : null;
                  const selectedLevelName = normalizeLevelName(
                    getSchemaMatchedLevelName(
                      selectedNode?.level_name || "",
                      selectedNode?.level_order
                    )
                  );
                  const nextLevelName = normalizeLevelName(
                    getSchemaMatchedLevelName(nextLevel)
                  );

                  if (selectedParentId === node.id && selectedLevelName === nextLevelName) {
                    insertAfterNodeId = selectedId;
                  }
                }

                setActionNode(node);
                setCreateParentNodeIdOverride(node.id);
                setCreateInsertAfterNodeId(insertAfterNodeId);
                setFormData({
                  levelName: nextLevel,
                  titleSanskrit: "",
                  titleTransliteration: "",
                  titleEnglish: "",
                  sequenceNumber: "",
                  hasContent: true,
                  contentSanskrit: "",
                  contentTransliteration: "",
                  contentEnglish: "",
                  tags: "",
                  wordMeanings: [],
                });
                setModalTranslationDrafts(buildEditableTranslationDrafts({}));
                setModalSelectedTranslationLanguages(
                  normalizeSelectedEditableTranslationLanguages([], sourceLanguage)
                );
                setModalTranslationVariants([]);
                setModalCommentaryVariants([]);
                setAction("add");
              }}
              title={`Add ${getDisplayLevelName(getNextLevelName(node))}`}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-green-500/30 bg-green-50 text-sm text-green-700 transition hover:border-green-500/60 hover:shadow-md"
            >
              +
            </button>
          )}
        </div>
        {canEditTreeOrder &&
          treeReorderDropTarget?.parentId === parentIdForGroup &&
          treeReorderDropTarget.nodeId === node.id &&
          treeReorderDropTarget.position === "before" && (
            <div className="pointer-events-none absolute -top-1 left-0 right-0 z-20 h-0.5 rounded bg-[color:var(--accent)]" />
          )}
        {canEditTreeOrder &&
          treeReorderDropTarget?.parentId === parentIdForGroup &&
          treeReorderDropTarget.nodeId === node.id &&
          treeReorderDropTarget.position === "after" && (
            <div className="pointer-events-none absolute -bottom-1 left-0 right-0 z-20 h-0.5 rounded bg-[color:var(--accent)]" />
          )}
            {node.children && node.children.length > 0 && expandedIds.has(node.id) && (
              <div className="ml-3 border-l border-black/10 pl-3">
                {renderTree(node.children, depth + 1)}
              </div>
            )}
          </div>
        ))}
        {canEditTreeOrder && lastNodeInGroup && (
          <div
            className="relative mt-1 h-5 rounded-md"
            onDragOver={(event) => {
              if (treeReorderDraggingNodeId === null) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = "move";
              const nextTarget = {
                parentId: parentIdForGroup,
                nodeId: lastNodeInGroup.id,
                position: "after",
              } as const;
              const prev = treeReorderDropTargetRef.current;
              if (
                prev &&
                prev.parentId === nextTarget.parentId &&
                prev.nodeId === nextTarget.nodeId &&
                prev.position === nextTarget.position
              ) {
                return;
              }
              setTreeReorderDropTargetSynced(nextTarget);
            }}
            onDrop={(event) => {
              if (treeReorderDraggingNodeId === null) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              const draggedIdRaw = event.dataTransfer.getData("text/plain");
              const draggedId = Number.parseInt(draggedIdRaw, 10);
              if (!Number.isFinite(draggedId)) {
                return;
              }
              applyTreeDropAtIndicator(draggedId);
            }}
          />
        )}
      </>
    );
  };

  return (
    <div
      className={`min-h-0 h-full rounded-2xl border border-black/10 bg-white/90 p-3 flex flex-col md:w-[320px] md:flex-none ${
        mobilePanel === "tree" ? "flex" : "hidden"
      } md:flex`}
      style={{ scrollbarGutter: "stable" }}
    >
      {(treeLoading || treeReorderingNodeId !== null || ((canContribute || canEditCurrentBook) && Boolean(bookId)) || (bookId && currentBook?.schema?.levels && currentBook.schema.levels.length > 1)) && (
        <div className="sticky top-0 z-10 bg-white/90 pb-1">
          <div className="flex items-center justify-end gap-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
            {treeLoading && <span>Loading</span>}
            {treeReorderingNodeId !== null && <span>Reordering</span>}
            {(canContribute || canEditCurrentBook) && bookId && (
              <button
                type="button"
                onClick={() => {
                  setTreeEditMode((prev) => {
                    const next = !prev;
                    if (!next) {
                      setTreeReorderModeNodeId(null);
                      setTreeReorderDraftByParentId({});
                      setTreeReorderDraggingNodeId(null);
                      setTreeReorderSavingParentId(null);
                      setTreeReorderDropTargetSynced(null);
                    }
                    return next;
                  });
                }}
                title={treeEditMode ? "Disable edit mode" : "Enable edit mode"}
                aria-label={treeEditMode ? "Disable edit mode" : "Enable edit mode"}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-full border transition ${
                  treeEditMode
                    ? "border-[color:var(--accent)] bg-[color:var(--sand)] text-[color:var(--accent)]"
                    : "border-black/10 bg-white/80 text-zinc-700 hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
                }`}
              >
                <Pencil size={14} />
              </button>
            )}
            {treeEditMode &&
              (canContribute || canEditCurrentBook) &&
              bookId && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      void saveAllTreeReorderDrafts();
                    }}
                    title="Save sibling order"
                    aria-label="Save sibling order"
                    disabled={
                      treeReorderingNodeId !== null ||
                      treeReorderSavingParentId !== null ||
                      !treeReorderHasPendingChanges
                    }
                    className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)]/10 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-[color:var(--accent)] transition hover:bg-[color:var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    {treeReorderSavingParentId !== null ? "Saving" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => cancelAllTreeReorderDrafts()}
                    title="Cancel reorder"
                    aria-label="Cancel reorder"
                    disabled={
                      treeReorderingNodeId !== null ||
                      treeReorderSavingParentId !== null ||
                      Object.keys(treeReorderDraftByParentId).length === 0
                    }
                    className="rounded-lg border border-black/10 bg-white/85 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-600 transition hover:border-black/20 hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    Cancel
                  </button>
                </>
              )}
            {bookId && treeData.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    setExpandedIds(new Set(treeData.map((node) => node.id)))
                  }
                  title="Expand all"
                  aria-label="Expand all"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-black/10 bg-white/80 text-zinc-700 transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
                >
                  <ChevronsDown size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setExpandedIds(new Set())}
                  title="Collapse all"
                  aria-label="Collapse all"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-black/10 bg-white/80 text-zinc-700 transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
                >
                  <ChevronsUp size={14} />
                </button>
              </>
            )}
          </div>
        </div>
      )}
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        style={{ scrollbarGutter: "stable" }}
      >
        {treeEditMode &&
          (canContribute || canEditCurrentBook) &&
          treeReorderModeParentId === null &&
          !privateBookGate && (
            <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-zinc-500">
              Tap a row to show up/down. Drag and drop is enabled in edit mode.
            </p>
          )}
        {privateBookGate ? (
          <div className="mx-2 mt-6 rounded-2xl border border-black/10 bg-white/80 p-5 text-center">
            <p className="text-sm font-medium text-zinc-700">🔒 Private book</p>
            <p className="mt-1 text-xs text-zinc-500">Sign in to view this book&apos;s contents.</p>
            <div className="mt-4 flex flex-col gap-2">
              <a
                href={signInFromShareHref}
                className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-2 text-xs font-medium text-white transition hover:shadow-md"
              >
                Sign in
              </a>
              <a
                href={signUpFromShareHref}
                className="rounded-lg border border-black/10 bg-white px-4 py-2 text-xs font-medium text-zinc-700 transition hover:border-black/20"
              >
                Create account
              </a>
            </div>
          </div>
        ) : (
          <>
            {treeError && (
              <p className="mt-3 text-sm text-[color:var(--accent)]">{treeError}</p>
            )}
            {!treeLoading && !treeError && treeData.length === 0 && bookId && (
              <p className="mt-3 text-sm text-zinc-600">No nodes yet.</p>
            )}
            {!treeLoading && !treeError && treeData.length > 0 && (
              <div
                className="mt-1 space-y-2"
                onDragOver={(event) => {
                  if (!treeEditMode || !(canContribute || canEditCurrentBook)) {
                    return;
                  }
                  if (treeReorderDraggingNodeId === null) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  if (!treeEditMode || !(canContribute || canEditCurrentBook)) {
                    return;
                  }
                  if (treeReorderDraggingNodeId === null) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  const draggedIdRaw = event.dataTransfer.getData("text/plain");
                  const draggedId = Number.parseInt(draggedIdRaw, 10);
                  if (!Number.isFinite(draggedId)) {
                    return;
                  }
                  applyTreeDropAtIndicator(draggedId);
                }}
              >
                <button
                  type="button"
                  onClick={() => selectBookRoot(true)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm font-medium transition ${
                    isBookRootSelected
                      ? "border-[color:var(--accent)] bg-[color:var(--sand)] text-[color:var(--accent)]"
                      : "border-black/10 bg-white/80 text-zinc-700 hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
                  }`}
                >
                  {selectedBookOption?.book_name || "Book"}
                </button>
                {renderTree(treeData)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
