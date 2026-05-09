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
import {
  ALL_LANGUAGE_CODES,
  type ScriptleLanguageCode,
} from "@/lib/scriptle/languages";
import { useFieldVisibility } from "@/lib/useFieldVisibility";
import { useLanguagePair } from "@/lib/useLanguagePair";

type RawBook = {
  id: number;
  book_name: string;
  book_code?: string | null;
  language_primary?: string | null;
  visibility?: string | null;
  metadata?: Record<string, unknown> | null;
  metadata_json?: Record<string, unknown> | null;
};

type ResolvedBook = {
  id: number;
  bookCode: string;
  titleEnglish: string;
  titleSanskrit: string | null;
  languages: ScriptleLanguageCode[];
  coverImageUrl: string | null;
  primaryLanguage: ScriptleLanguageCode;
};

function readMetadataValue(book: RawBook, key: string): unknown {
  if (book.metadata && typeof book.metadata === "object" && key in book.metadata) {
    return book.metadata[key];
  }
  if (
    book.metadata_json &&
    typeof book.metadata_json === "object" &&
    key in book.metadata_json
  ) {
    return book.metadata_json[key];
  }
  return undefined;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asLanguageList(value: unknown): ScriptleLanguageCode[] | null {
  if (!Array.isArray(value)) return null;
  const filtered = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.toLowerCase().slice(0, 2))
    .filter((code): code is ScriptleLanguageCode =>
      ALL_LANGUAGE_CODES.includes(code as ScriptleLanguageCode)
    );
  return filtered.length > 0 ? Array.from(new Set(filtered)) : null;
}

function asLanguageCode(value: string | null | undefined): ScriptleLanguageCode {
  if (!value) return "sa";
  const lower = value.toLowerCase().slice(0, 2);
  return ALL_LANGUAGE_CODES.includes(lower as ScriptleLanguageCode)
    ? (lower as ScriptleLanguageCode)
    : "sa";
}

function resolveBook(raw: RawBook): ResolvedBook {
  return {
    id: raw.id,
    bookCode: raw.book_code ?? String(raw.id),
    titleEnglish:
      asString(readMetadataValue(raw, "title_english")) ??
      raw.book_name ??
      "Untitled",
    titleSanskrit: asString(readMetadataValue(raw, "title_sanskrit")),
    languages:
      asLanguageList(readMetadataValue(raw, "languages_available")) ??
      ["sa", "en"],
    coverImageUrl:
      asString(readMetadataValue(raw, "cover_image_url")) ??
      asString(readMetadataValue(raw, "thumbnail_url")),
    primaryLanguage: asLanguageCode(raw.language_primary),
  };
}

function flattenLeaves(nodes: TocNode[], out: TocNode[] = []): TocNode[] {
  for (const node of nodes) {
    if (!node.children || node.children.length === 0) {
      out.push(node);
    } else {
      flattenLeaves(node.children, out);
    }
  }
  return out;
}

function findFirstLeaf(node: TocNode): TocNode | null {
  if (!node.children || node.children.length === 0) return node;
  for (const child of node.children) {
    const leaf = findFirstLeaf(child);
    if (leaf) return leaf;
  }
  return null;
}

function findNode(nodes: TocNode[], id: number): TocNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const result = findNode(node.children, id);
      if (result) return result;
    }
  }
  return null;
}

function buildPath(
  nodes: TocNode[],
  id: number,
  current: TocNode[] = []
): TocNode[] | null {
  for (const node of nodes) {
    const next = [...current, node];
    if (node.id === id) return next;
    if (node.children) {
      const result = buildPath(node.children, id, next);
      if (result) return result;
    }
  }
  return null;
}

function countLeaves(nodes: TocNode[]): number {
  let count = 0;
  const stack = [...nodes];
  while (stack.length) {
    const next = stack.pop()!;
    if (!next.children || next.children.length === 0) {
      count += 1;
    } else {
      stack.push(...next.children);
    }
  }
  return count;
}

function ReadBookContent() {
  const params = useParams<{ bookCode: string }>();
  const bookCode = decodeURIComponent(params?.bookCode ?? "");
  const router = useRouter();
  const searchParams = useSearchParams();
  const nodeQueryParam = searchParams.get("node");
  const modeQueryParam = searchParams.get("mode");

  const [book, setBook] = useState<ResolvedBook | null>(null);
  const [bookError, setBookError] = useState<string | null>(null);
  const [tree, setTree] = useState<TocNode[]>([]);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treeLoading, setTreeLoading] = useState(true);

  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [nodeContent, setNodeContent] = useState<VerseNode | null>(null);
  const [nodeContentLoading, setNodeContentLoading] = useState(false);

  const [mode, setMode] = useState<VerseViewMode>(
    modeQueryParam === "scroll" ? "scroll" : "verse"
  );

  const fieldVis = useFieldVisibility();
  const langPair = useLanguagePair(
    bookCode,
    book?.primaryLanguage ?? "sa",
    "en"
  );

  // Resolve book by code via /api/books, then load tree
  useEffect(() => {
    if (!bookCode) return;
    let cancelled = false;
    void (async () => {
      try {
        setTreeLoading(true);
        const booksRes = await fetch("/api/books", { credentials: "include" });
        if (!booksRes.ok) throw new Error("Could not load library");
        const booksData = (await booksRes.json()) as RawBook[];
        const match = booksData.find((b) => b.book_code === bookCode);
        if (cancelled) return;
        if (!match) {
          setBookError(`No book with code "${bookCode}".`);
          setTreeLoading(false);
          return;
        }
        const resolved = resolveBook(match);
        setBook(resolved);

        const treeRes = await fetch(`/api/books/${match.id}/tree`, {
          credentials: "include",
        });
        if (!treeRes.ok) throw new Error("Could not load tree");
        const treeData = (await treeRes.json()) as TocNode[];
        if (cancelled) return;
        setTree(treeData);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Could not load book";
        if (!book) setBookError(message);
        else setTreeError(message);
      } finally {
        if (!cancelled) setTreeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookCode]);

  // Pick a default selected node once tree loads and URL had no override.
  useEffect(() => {
    if (tree.length === 0) return;
    if (selectedNodeId !== null) return;
    if (nodeQueryParam) {
      const parsed = Number(nodeQueryParam);
      if (Number.isFinite(parsed) && findNode(tree, parsed)) {
        setSelectedNodeId(parsed);
        return;
      }
    }
    const firstLeaf = tree
      .map((n) => findFirstLeaf(n))
      .find((n): n is TocNode => Boolean(n));
    if (firstLeaf) {
      setSelectedNodeId(firstLeaf.id);
    }
  }, [tree, nodeQueryParam, selectedNodeId]);

  const selectedNode = useMemo(
    () =>
      selectedNodeId !== null && tree.length > 0
        ? findNode(tree, selectedNodeId)
        : null,
    [tree, selectedNodeId]
  );

  const isLeaf = selectedNode
    ? !selectedNode.children || selectedNode.children.length === 0
    : false;

  // Load full node content for leaf selections
  useEffect(() => {
    if (!selectedNodeId || !isLeaf) {
      setNodeContent(null);
      return;
    }
    let cancelled = false;
    setNodeContentLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/content/nodes/${selectedNodeId}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Could not load verse");
        const data = (await res.json()) as VerseNode;
        if (cancelled) return;
        setNodeContent(data);
      } catch {
        if (cancelled) return;
        setNodeContent(null);
      } finally {
        if (!cancelled) setNodeContentLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedNodeId, isLeaf]);

  // Sync selected node + mode to URL (replace, not push, to avoid history spam)
  useEffect(() => {
    if (selectedNodeId === null) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set("node", String(selectedNodeId));
    if (mode === "scroll") next.set("mode", "scroll");
    else next.delete("mode");
    const search = next.toString();
    router.replace(
      `/read/${encodeURIComponent(bookCode)}${search ? `?${search}` : ""}`,
      { scroll: false }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId, mode]);

  const leaves = useMemo(() => flattenLeaves(tree), [tree]);
  const leafIndex = useMemo(
    () =>
      selectedNodeId !== null
        ? leaves.findIndex((leaf) => leaf.id === selectedNodeId)
        : -1,
    [leaves, selectedNodeId]
  );
  const prevLeaf = leafIndex > 0 ? leaves[leafIndex - 1] : null;
  const nextLeaf =
    leafIndex >= 0 && leafIndex < leaves.length - 1
      ? leaves[leafIndex + 1]
      : null;

  const breadcrumbs = useMemo(() => {
    if (!book) return [];
    const path =
      selectedNodeId !== null ? buildPath(tree, selectedNodeId) ?? [] : [];
    const crumbs: { label: string; onClick?: () => void }[] = [
      {
        label: book.titleEnglish,
        onClick: () => {
          const firstLeaf = tree
            .map((n) => findFirstLeaf(n))
            .find((n): n is TocNode => Boolean(n));
          if (firstLeaf) setSelectedNodeId(firstLeaf.id);
        },
      },
    ];
    for (const node of path) {
      const label =
        node.title_english ||
        node.title_sanskrit ||
        node.title_transliteration ||
        `${node.level_name} ${node.sequence_number ?? ""}`.trim();
      crumbs.push({
        label,
        onClick: () => setSelectedNodeId(node.id),
      });
    }
    return crumbs;
  }, [book, tree, selectedNodeId]);

  if (bookError) {
    return (
      <div
        data-scriptle="true"
        className="flex min-h-[calc(100vh-3rem)] items-center justify-center px-6 text-center"
      >
        <p
          style={{
            fontFamily: "var(--font-scriptle-sans)",
            color: "var(--color-text-muted)",
            fontSize: "14px",
          }}
        >
          {bookError}
        </p>
      </div>
    );
  }

  if (!book) {
    return (
      <div
        data-scriptle="true"
        className="flex min-h-[calc(100vh-3rem)] items-center justify-center"
      >
        <p
          style={{
            fontFamily: "var(--font-scriptle-sans)",
            color: "var(--color-text-muted)",
            fontSize: "13px",
          }}
        >
          Loading…
        </p>
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
          totalVerseCount={leaves.length}
          languages={book.languages}
          coverImageUrl={book.coverImageUrl}
          toc={tree}
          selectedNodeId={selectedNodeId}
          onSelectNode={(node) => setSelectedNodeId(node.id)}
        >
          <VerseTopBar
            crumbs={breadcrumbs}
            mode={mode}
            onModeChange={setMode}
            src={langPair.src}
            trg={langPair.trg}
            onSrcChange={langPair.setSrcLang}
            onTrgChange={langPair.setTrgLang}
            availableTrgLanguages={book.languages.filter((c) => c !== "sa")}
            fields={fieldVis.fields}
            hiddenCount={fieldVis.hiddenCount}
            toggleField={fieldVis.toggle}
            resetFields={fieldVis.reset}
          />

          {treeLoading ? (
            <p
              className="py-8"
              style={{
                fontFamily: "var(--font-scriptle-sans)",
                color: "var(--color-text-muted)",
                fontSize: "13px",
              }}
            >
              Loading the table of contents…
            </p>
          ) : treeError ? (
            <p
              className="py-8"
              style={{
                fontFamily: "var(--font-scriptle-sans)",
                color: "var(--color-text-muted)",
                fontSize: "13px",
              }}
            >
              {treeError}
            </p>
          ) : mode === "scroll" ? (
            <div className="py-12">
              <p
                style={{
                  fontFamily: "var(--font-scriptle-sans)",
                  color: "var(--color-text-muted)",
                  fontSize: "13px",
                }}
              >
                Scroll mode is coming in the next step. Switch back to Verse
                mode to keep reading.
              </p>
            </div>
          ) : !selectedNode ? (
            <p
              className="py-8"
              style={{
                fontFamily: "var(--font-scriptle-sans)",
                color: "var(--color-text-muted)",
                fontSize: "13px",
              }}
            >
              Select a node from the table of contents to begin.
            </p>
          ) : isLeaf ? (
            <>
              {nodeContentLoading && !nodeContent ? (
                <p
                  className="py-8"
                  style={{
                    fontFamily: "var(--font-scriptle-sans)",
                    color: "var(--color-text-muted)",
                    fontSize: "13px",
                  }}
                >
                  Loading verse…
                </p>
              ) : nodeContent ? (
                <VersePane
                  node={nodeContent}
                  fields={fieldVis.fields}
                  src={langPair.src}
                  trg={langPair.trg}
                  onResetFields={fieldVis.reset}
                />
              ) : (
                <p
                  className="py-8"
                  style={{
                    fontFamily: "var(--font-scriptle-sans)",
                    color: "var(--color-text-muted)",
                    fontSize: "13px",
                  }}
                >
                  Could not load this verse.
                </p>
              )}

              <div
                className="mt-8 flex items-center justify-between border-t pt-4"
                style={{ borderColor: "var(--color-border-soft)" }}
              >
                <NavButton
                  label="Previous"
                  disabled={!prevLeaf}
                  onClick={() => prevLeaf && setSelectedNodeId(prevLeaf.id)}
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
                    ? `${leafIndex + 1} of ${leaves.length}`
                    : `${leaves.length} verses`}
                </span>
                <NavButton
                  label="Next"
                  disabled={!nextLeaf}
                  onClick={() => nextLeaf && setSelectedNodeId(nextLeaf.id)}
                  rightAligned
                />
              </div>
            </>
          ) : (
            <ChapterOverview
              node={selectedNode}
              summary={null}
              verseCount={countLeaves(selectedNode.children ?? [])}
              firstLeaf={findFirstLeaf(selectedNode)}
              onBeginReading={(leaf) => setSelectedNodeId(leaf.id)}
            />
          )}
        </VerseViewerLayout>
      </div>
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
          <p
            style={{
              fontFamily: "var(--font-scriptle-sans)",
              color: "var(--color-text-muted)",
              fontSize: "13px",
            }}
          >
            Loading…
          </p>
        </div>
      }
    >
      <ReadBookContent />
    </Suspense>
  );
}
