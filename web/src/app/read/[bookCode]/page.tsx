"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import VerseViewerLayout from "@/components/scriptle/VerseViewerLayout";
import VerseTopBar, {
  type VerseViewMode,
} from "@/components/scriptle/VerseTopBar";
import VersePane, { type VerseNode } from "@/components/scriptle/VersePane";
import ChapterOverview from "@/components/scriptle/ChapterOverview";
import type { TocNode } from "@/components/scriptle/VerseTOC";
import { MutedNote } from "@/components/scriptle/typography";
import { resolveBook, type RawBook, type ResolvedBook } from "@/lib/scriptle/bookAdapter";
import {
  buildTreeIndex,
  getAncestorSet,
  getPath,
  type TreeIndex,
  type TreeIndexEntry,
} from "@/lib/scriptle/treeIndex";
import { useFieldVisibility } from "@/lib/useFieldVisibility";
import { useLanguagePair } from "@/lib/useLanguagePair";

function useResolvedBook(bookCode: string): {
  book: ResolvedBook | null;
  error: string | null;
} {
  const [book, setBook] = useState<ResolvedBook | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bookCode) return;
    let cancelled = false;
    fetch("/api/books", { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error("Could not load library");
        return r.json() as Promise<RawBook[]>;
      })
      .then((data) => {
        if (cancelled) return;
        const match = data.find((b) => b.book_code === bookCode);
        if (!match) setError(`No book with code "${bookCode}".`);
        else setBook(resolveBook(match));
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load book");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [bookCode]);

  return { book, error };
}

function useBookTree(bookId: number | null): {
  tree: TocNode[];
  loading: boolean;
  error: string | null;
} {
  const [tree, setTree] = useState<TocNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (bookId === null) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });
    fetch(`/api/books/${bookId}/tree`, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error("Could not load tree");
        return r.json() as Promise<TocNode[]>;
      })
      .then((data) => {
        if (!cancelled) {
          setTree(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoading(false);
          setError(err instanceof Error ? err.message : "Could not load tree");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  return { tree, loading, error };
}

function useNodeContent(
  nodeId: number | null,
  enabled: boolean
): { content: VerseNode | null; loading: boolean } {
  const [content, setContent] = useState<VerseNode | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!nodeId || !enabled) {
      queueMicrotask(() => setContent(null));
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });
    fetch(`/api/content/nodes/${nodeId}`, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error("Could not load verse");
        return r.json() as Promise<VerseNode>;
      })
      .then((data) => {
        if (!cancelled) {
          setContent(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setContent(null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [nodeId, enabled]);

  return { content, loading };
}

function ReadBookContent() {
  const params = useParams<{ bookCode: string }>();
  const bookCode = decodeURIComponent(params?.bookCode ?? "");
  const router = useRouter();
  const searchParams = useSearchParams();

  const { book, error: bookError } = useResolvedBook(bookCode);
  const {
    tree,
    loading: treeLoading,
    error: treeError,
  } = useBookTree(book?.id ?? null);

  const treeIndex = useMemo<TreeIndex<TocNode> | null>(
    () => (tree.length > 0 ? buildTreeIndex(tree) : null),
    [tree]
  );

  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [mode, setMode] = useState<VerseViewMode>(
    searchParams.get("mode") === "scroll" ? "scroll" : "verse"
  );

  const fieldVis = useFieldVisibility();
  const langPair = useLanguagePair(
    bookCode,
    book?.primaryLanguage ?? "sa",
    "en"
  );

  // Pick a default selection once the index is ready.
  useEffect(() => {
    if (!treeIndex || selectedNodeId !== null) return;
    queueMicrotask(() => {
      const fromUrl = Number(searchParams.get("node"));
      if (Number.isFinite(fromUrl) && treeIndex.entries.has(fromUrl)) {
        setSelectedNodeId(fromUrl);
      } else if (treeIndex.leaves.length > 0) {
        setSelectedNodeId(treeIndex.leaves[0].id);
      }
    });
  }, [treeIndex, selectedNodeId, searchParams]);

  const selectedEntry = useMemo(
    () =>
      selectedNodeId !== null && treeIndex
        ? treeIndex.entries.get(selectedNodeId)
        : null,
    [treeIndex, selectedNodeId]
  );

  const isLeaf = selectedEntry?.isLeaf ?? false;

  const { content: nodeContent, loading: nodeContentLoading } = useNodeContent(
    selectedNodeId,
    isLeaf
  );

  // Sync selection + mode to the URL. Skip the replace when nothing changed.
  useEffect(() => {
    if (selectedNodeId === null) return;
    const currentNode = searchParams.get("node");
    const currentMode = searchParams.get("mode") ?? "verse";
    const desiredMode = mode === "scroll" ? "scroll" : "verse";
    if (currentNode === String(selectedNodeId) && currentMode === desiredMode) {
      return;
    }
    const next = new URLSearchParams(searchParams.toString());
    next.set("node", String(selectedNodeId));
    if (mode === "scroll") next.set("mode", "scroll");
    else next.delete("mode");
    const search = next.toString();
    router.replace(
      `/read/${encodeURIComponent(bookCode)}${search ? `?${search}` : ""}`,
      { scroll: false }
    );
  }, [selectedNodeId, mode, searchParams, router, bookCode]);

  const ancestorSet = useMemo(
    () => (treeIndex ? getAncestorSet(treeIndex, selectedNodeId) : new Set<number>()),
    [treeIndex, selectedNodeId]
  );

  const breadcrumbs = useMemo(() => {
    if (!book || !treeIndex) return [];
    const path = selectedNodeId !== null ? getPath(treeIndex, selectedNodeId) : [];
    const crumbs: { label: string; onClick?: () => void }[] = [
      {
        label: book.titleEnglish,
        onClick: () => {
          if (treeIndex.leaves.length > 0) {
            setSelectedNodeId(treeIndex.leaves[0].id);
          }
        },
      },
    ];
    for (const node of path) {
      crumbs.push({
        label: labelOf(node),
        onClick: () => setSelectedNodeId(node.id),
      });
    }
    return crumbs;
  }, [book, treeIndex, selectedNodeId]);

  const leafCount = treeIndex?.leaves.length ?? 0;
  const leafIndex = selectedEntry?.leafIndex ?? -1;
  const prevLeaf =
    leafIndex > 0 && treeIndex ? treeIndex.leaves[leafIndex - 1] : null;
  const nextLeaf =
    leafIndex >= 0 && treeIndex && leafIndex < leafCount - 1
      ? treeIndex.leaves[leafIndex + 1]
      : null;

  if (bookError) {
    return (
      <div
        data-scriptle="true"
        className="flex min-h-[calc(100vh-3rem)] items-center justify-center px-6 text-center"
      >
        <MutedNote>{bookError}</MutedNote>
      </div>
    );
  }

  if (!book) {
    return (
      <div
        data-scriptle="true"
        className="flex min-h-[calc(100vh-3rem)] items-center justify-center"
      >
        <MutedNote>Loading…</MutedNote>
      </div>
    );
  }

  return (
    <div
      data-scriptle="true"
      className="min-h-[calc(100vh-3rem)] w-full px-4 pb-16 pt-4 sm:px-6"
    >
      <div className="mx-auto w-full max-w-6xl">
        <VerseViewerLayout
          bookCode={book.bookCode}
          bookTitleEnglish={book.titleEnglish}
          bookTitleSanskrit={book.titleSanskrit}
          totalVerseCount={leafCount}
          languages={book.languages}
          coverImageUrl={book.coverImageUrl}
          toc={tree}
          selectedNodeId={selectedNodeId}
          ancestorSet={ancestorSet}
          onSelectNode={(node) => setSelectedNodeId(node.id)}
        >
          <VerseTopBar
            crumbs={breadcrumbs}
            mode={mode}
            onModeChange={setMode}
            langPair={langPair}
            fieldVis={fieldVis}
            availableTrgLanguages={book.languages.filter((c) => c !== "sa")}
          />

          <ReadBody
            mode={mode}
            treeLoading={treeLoading}
            treeError={treeError}
            treeIndex={treeIndex}
            selectedEntry={selectedEntry ?? null}
            isLeaf={isLeaf}
            nodeContent={nodeContent}
            nodeContentLoading={nodeContentLoading}
            fieldVis={fieldVis}
            langPair={langPair}
            leafIndex={leafIndex}
            leafCount={leafCount}
            prevLeaf={prevLeaf}
            nextLeaf={nextLeaf}
            onSelectNode={setSelectedNodeId}
          />
        </VerseViewerLayout>
      </div>
    </div>
  );
}

const labelOf = (node: TocNode): string =>
  node.title_english ||
  node.title_sanskrit ||
  node.title_transliteration ||
  `${node.level_name} ${node.sequence_number ?? ""}`.trim();

type ReadBodyProps = {
  mode: VerseViewMode;
  treeLoading: boolean;
  treeError: string | null;
  treeIndex: TreeIndex<TocNode> | null;
  selectedEntry: TreeIndexEntry<TocNode> | null;
  isLeaf: boolean;
  nodeContent: VerseNode | null;
  nodeContentLoading: boolean;
  fieldVis: ReturnType<typeof useFieldVisibility>;
  langPair: ReturnType<typeof useLanguagePair>;
  leafIndex: number;
  leafCount: number;
  prevLeaf: TocNode | null;
  nextLeaf: TocNode | null;
  onSelectNode: (id: number) => void;
};

function ReadBody({
  mode,
  treeLoading,
  treeError,
  treeIndex,
  selectedEntry,
  isLeaf,
  nodeContent,
  nodeContentLoading,
  fieldVis,
  langPair,
  leafIndex,
  leafCount,
  prevLeaf,
  nextLeaf,
  onSelectNode,
}: ReadBodyProps) {
  if (treeLoading) {
    return (
      <div className="py-8">
        <MutedNote>Loading the table of contents…</MutedNote>
      </div>
    );
  }
  if (treeError) {
    return (
      <div className="py-8">
        <MutedNote>{treeError}</MutedNote>
      </div>
    );
  }
  if (mode === "scroll") {
    return (
      <div className="py-12">
        <MutedNote>
          Scroll mode is coming in the next step. Switch back to Verse mode to
          keep reading.
        </MutedNote>
      </div>
    );
  }
  if (!selectedEntry) {
    return (
      <div className="py-8">
        <MutedNote>Select a node from the table of contents to begin.</MutedNote>
      </div>
    );
  }
  if (!isLeaf) {
    const node = selectedEntry.node;
    const firstLeaf =
      treeIndex?.entries.get(selectedEntry.firstLeafId)?.node ?? null;
    return (
      <ChapterOverview
        node={node}
        summary={null}
        verseCount={selectedEntry.leafCount}
        firstLeaf={firstLeaf}
        onBeginReading={(leaf) => onSelectNode(leaf.id)}
      />
    );
  }
  if (nodeContentLoading && !nodeContent) {
    return (
      <div className="py-8">
        <MutedNote>Loading verse…</MutedNote>
      </div>
    );
  }
  if (!nodeContent) {
    return (
      <div className="py-8">
        <MutedNote>Could not load this verse.</MutedNote>
      </div>
    );
  }
  return (
    <>
      <VersePane
        node={nodeContent}
        fields={fieldVis.fields}
        src={langPair.src}
        trg={langPair.trg}
        onResetFields={fieldVis.reset}
      />
      <LeafNav
        leafIndex={leafIndex}
        leafCount={leafCount}
        prevLeaf={prevLeaf}
        nextLeaf={nextLeaf}
        onSelectNode={onSelectNode}
      />
    </>
  );
}

function LeafNav({
  leafIndex,
  leafCount,
  prevLeaf,
  nextLeaf,
  onSelectNode,
}: {
  leafIndex: number;
  leafCount: number;
  prevLeaf: TocNode | null;
  nextLeaf: TocNode | null;
  onSelectNode: (id: number) => void;
}) {
  return (
    <div
      className="mt-8 flex items-center justify-between border-t pt-4"
      style={{ borderColor: "var(--color-border-soft)" }}
    >
      <NavButton
        label="Previous"
        disabled={!prevLeaf}
        onClick={() => prevLeaf && onSelectNode(prevLeaf.id)}
      />
      <span
        style={{
          fontFamily: "var(--font-scriptle-sans)",
          fontSize: "11px",
          letterSpacing: "0.08em",
          color: "var(--color-text-faint)",
          textTransform: "uppercase",
        }}
      >
        {leafIndex >= 0
          ? `${leafIndex + 1} of ${leafCount}`
          : `${leafCount} verses`}
      </span>
      <NavButton
        label="Next"
        disabled={!nextLeaf}
        onClick={() => nextLeaf && onSelectNode(nextLeaf.id)}
        rightAligned
      />
    </div>
  );
}

function NavButton({
  label,
  disabled,
  onClick,
  rightAligned,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  rightAligned?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border px-3 py-1.5 transition disabled:opacity-40"
      style={{
        background: "white",
        borderColor: "var(--color-border)",
        color: "var(--color-text)",
        fontFamily: "var(--font-scriptle-sans)",
        fontSize: "12px",
      }}
    >
      {rightAligned ? `${label} →` : `← ${label}`}
    </button>
  );
}

export default function ReadBookPage() {
  return (
    <Suspense
      fallback={
        <div
          data-scriptle="true"
          className="flex min-h-[calc(100vh-3rem)] items-center justify-center"
        >
          <MutedNote>Loading…</MutedNote>
        </div>
      }
    >
      <ReadBookContent />
    </Suspense>
  );
}
