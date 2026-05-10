"use client";

import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  hasDevanagariLetters,
  normalizeTransliterationScript,
  transliterateFromDevanagari,
  transliterateFromIast,
  type TransliterationScriptOption,
} from "@/lib/indicScript";
import { getBookByCode } from "@/lib/booksClient";
import { getMe } from "@/lib/authClient";
import AppBanner from "@/components/scriptle/AppBanner";
import {
  resolveBook,
  type ResolvedBook,
} from "@/lib/scriptle/bookAdapter";
import {
  buildTreeIndex,
  getAncestorSet,
  getPath,
  type TreeIndex,
  type TreeIndexEntry,
} from "@/lib/scriptle/treeIndex";
import { coverGradientForBook } from "@/lib/scriptle/covers";
import {
  ALL_LANGUAGE_CODES,
  LANGUAGE_NAMES,
  type ScriptleLanguageCode,
} from "@/lib/scriptle/languages";
import { useFieldVisibility, type FieldKey } from "@/lib/useFieldVisibility";
import { useLanguagePair } from "@/lib/useLanguagePair";

type TocNode = {
  id: number;
  level_name: string;
  sequence_number?: number | string | null;
  title_english?: string | null;
  title_sanskrit?: string | null;
  title_transliteration?: string | null;
  children?: TocNode[];
};

type VerseNode = {
  id: number;
  level_name: string;
  sequence_number?: number | string | null;
  title_english?: string | null;
  title_sanskrit?: string | null;
  content_data?: {
    basic?: { sanskrit?: string; transliteration?: string; text?: string };
    translations?: Record<string, string>;
    translation_variants?: Array<{
      slug?: string;
      author_name?: string;
      text?: string;
      language?: string;
      verified?: boolean;
    }>;
    commentary_variants?: Array<{
      slug?: string;
      author_name?: string;
      text?: string;
      language?: string;
    }>;
    word_meanings?: Array<{ word: string; meaning: string }>;
  } | null;
};

type ViewMode = "verse" | "scroll";

const TRG_LANG_KEY: Record<ScriptleLanguageCode, string> = {
  sa: "sanskrit",
  en: "english",
  hi: "hindi",
  te: "telugu",
  ta: "tamil",
};

const SRC_TO_SCRIPT: Record<
  ScriptleLanguageCode,
  TransliterationScriptOption | null
> = {
  sa: null,
  en: null,
  hi: "devanagari",
  te: "telugu",
  ta: "tamil",
};

const LANG_DOT_COLOR: Record<ScriptleLanguageCode, string> = {
  sa: "#1C3A2E",
  en: "#97C459",
  hi: "#85B7EB",
  te: "#EF9F27",
  ta: "#ED93B1",
};

const LANG_NATIVE: Record<ScriptleLanguageCode, string> = {
  sa: "देवनागरी",
  en: "",
  hi: "हिन्दी",
  te: "తెలుగు",
  ta: "தமிழ்",
};

const SOURCE_OPTIONS: ScriptleLanguageCode[] = ["sa", "te", "hi", "ta"];
const TARGET_OPTIONS: ScriptleLanguageCode[] = ["en", "te", "hi", "ta"];

const FIELD_DEFS: { key: FieldKey; icon: string; name: string; desc: string }[] = [
  { key: "original", icon: "ॐ", name: "Original text", desc: "Sanskrit in Devanagari" },
  { key: "iast", icon: "Aa", name: "IAST", desc: "Roman transliteration" },
  { key: "srcScript", icon: "अ", name: "Source script", desc: "Sanskrit in Telugu / Hindi" },
  { key: "w2w", icon: "≡", name: "Word for word", desc: "Token-by-token meanings" },
  { key: "translation", icon: "¶", name: "Translation", desc: "Multiple authors available" },
  { key: "commentary", icon: "“", name: "Commentary", desc: "Scholarly interpretations" },
];

const labelOf = (node: TocNode): string =>
  node.title_english ||
  node.title_sanskrit ||
  node.title_transliteration ||
  `${node.level_name} ${node.sequence_number ?? ""}`.trim();

function useResolvedBook(bookCode: string): {
  book: ResolvedBook | null;
  error: string | null;
} {
  const [book, setBook] = useState<ResolvedBook | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!bookCode) return;
    let cancelled = false;
    getBookByCode(bookCode)
      .then((match) => {
        if (cancelled) return;
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
  const [mode, setMode] = useState<ViewMode>(
    searchParams.get("mode") === "scroll" ? "scroll" : "verse"
  );
  const [isAdmin, setIsAdmin] = useState(false);

  // Banner shows the "Add scripture" button for admins; cheap getMe() lookup
  // (the authClient cache makes this free after first call).
  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((me) => {
        if (cancelled || !me) return;
        setIsAdmin(me.role === "admin" || (me.permissions?.can_admin ?? false));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const fieldVis = useFieldVisibility();
  const langPair = useLanguagePair(
    bookCode,
    book?.primaryLanguage ?? "sa",
    "en"
  );

  // Default selection
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
        ? treeIndex.entries.get(selectedNodeId) ?? null
        : null,
    [treeIndex, selectedNodeId]
  );

  const isLeaf = selectedEntry?.isLeaf ?? false;

  const { content: nodeContent, loading: nodeContentLoading } = useNodeContent(
    selectedNodeId,
    isLeaf
  );

  // URL sync
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
    () =>
      treeIndex ? getAncestorSet(treeIndex, selectedNodeId) : new Set<number>(),
    [treeIndex, selectedNodeId]
  );

  // Compute leaf navigation
  const leafCount = treeIndex?.leaves.length ?? 0;
  const leafIndex = selectedEntry?.leafIndex ?? -1;
  const prevLeaf =
    leafIndex > 0 && treeIndex ? treeIndex.leaves[leafIndex - 1] : null;
  const nextLeaf =
    leafIndex >= 0 && treeIndex && leafIndex < leafCount - 1
      ? treeIndex.leaves[leafIndex + 1]
      : null;

  // Prefetch the next verse's content during browser idle time so a Next click
  // resolves from HTTP cache instead of round-tripping. Cancelled if the user
  // navigates away or switches selection.
  useEffect(() => {
    if (!nextLeaf || !isLeaf) return;
    const ric =
      typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback
        : (cb: IdleRequestCallback) =>
            window.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 200);
    const cic =
      typeof window.cancelIdleCallback === "function"
        ? window.cancelIdleCallback
        : window.clearTimeout;
    const controller = new AbortController();
    const handle = ric(
      () => {
        fetch(`/api/content/nodes/${nextLeaf.id}`, {
          credentials: "include",
          signal: controller.signal,
        }).catch(() => {
          // ignore: this is a speculative warm-up
        });
      },
      { timeout: 1500 }
    );
    return () => {
      controller.abort();
      cic(handle as number);
    };
  }, [nextLeaf, isLeaf]);

  if (bookError) {
    return (
      <div data-scriptle="true" style={{ padding: "60px 24px", textAlign: "center" }}>
        <p style={{ color: "var(--color-text-muted)", fontSize: "13px" }}>
          {bookError}
        </p>
        <p style={{ marginTop: 12 }}>
          <Link
            href="/library"
            style={{ color: "var(--color-accent)", fontSize: "12px" }}
          >
            ← Back to Library
          </Link>
        </p>
      </div>
    );
  }
  if (!book || !treeIndex) {
    return (
      <div data-scriptle="true" style={{ padding: "60px 24px", textAlign: "center" }}>
        <p style={{ color: "var(--color-text-muted)", fontSize: "13px" }}>
          Loading…
        </p>
      </div>
    );
  }

  return (
    <div data-scriptle="true">
      <AppBanner active="library" showAddScripture={isAdmin} />
      <div className="vv">
        <Sidebar
          book={book}
          tree={tree}
          treeIndex={treeIndex}
          selectedNodeId={selectedNodeId}
          ancestorSet={ancestorSet}
          mode={mode}
          isLeaf={isLeaf}
          onSelectNode={setSelectedNodeId}
        />
        <div className="vv-main">
          <TopBar
            book={book}
            tree={tree}
            treeIndex={treeIndex}
            selectedEntry={selectedEntry}
            mode={mode}
            onModeChange={setMode}
            langPair={langPair}
            fieldVis={fieldVis}
            availableTrgLanguages={book.languages.filter((c) => c !== "sa")}
            onSelectNode={setSelectedNodeId}
          />
          <Body
            book={book}
            mode={mode}
            treeLoading={treeLoading}
            treeError={treeError}
            treeIndex={treeIndex}
            selectedEntry={selectedEntry}
            isLeaf={isLeaf}
            nodeContent={nodeContent}
            nodeContentLoading={nodeContentLoading}
            fieldVis={fieldVis}
            langPair={langPair}
            leafCount={leafCount}
            prevLeaf={prevLeaf}
            nextLeaf={nextLeaf}
            onSelectNode={setSelectedNodeId}
            onModeChange={setMode}
          />
        </div>
      </div>
    </div>
  );
}

function Sidebar({
  book,
  tree,
  treeIndex,
  selectedNodeId,
  ancestorSet,
  mode,
  isLeaf,
  onSelectNode,
}: {
  book: ResolvedBook;
  tree: TocNode[];
  treeIndex: TreeIndex<TocNode>;
  selectedNodeId: number | null;
  ancestorSet: Set<number>;
  mode: ViewMode;
  isLeaf: boolean;
  onSelectNode: (id: number) => void;
}) {
  const totalLeaves = treeIndex.leaves.length;
  const topLevelCount = tree.length;

  return (
    <div className="vv-sb">
      <div className="vv-sbh">
        <Link href="/library" className="vv-back">
          ← Library
        </Link>
        <div className="vv-bkrow">
          <div
            className="vv-cv"
            style={{ background: coverGradientForBook(book.bookCode) }}
          >
            <div className="vv-cv-sp" />
            {book.titleSanskrit ? (
              <div className="vv-cv-sk">{book.titleSanskrit}</div>
            ) : null}
          </div>
          <div>
            <div className="vv-bkt">{book.titleEnglish}</div>
            <div className="vv-bkm">
              {totalLeaves.toLocaleString()} verse
              {totalLeaves === 1 ? "" : "s"}
              {topLevelCount > 0 ? ` · ${topLevelCount} ch` : ""}
            </div>
          </div>
        </div>
      </div>
      <div className="vv-toc">
        {tree.map((node) => (
          <SidebarNode
            key={node.id}
            node={node}
            depth={0}
            treeIndex={treeIndex}
            selectedNodeId={selectedNodeId}
            ancestorSet={ancestorSet}
            mode={mode}
            isLeaf={isLeaf}
            onSelectNode={onSelectNode}
          />
        ))}
      </div>
    </div>
  );
}

function SidebarNode({
  node,
  depth,
  treeIndex,
  selectedNodeId,
  ancestorSet,
  mode,
  isLeaf,
  onSelectNode,
}: {
  node: TocNode;
  depth: number;
  treeIndex: TreeIndex<TocNode>;
  selectedNodeId: number | null;
  ancestorSet: Set<number>;
  mode: ViewMode;
  isLeaf: boolean;
  onSelectNode: (id: number) => void;
}) {
  const entry = treeIndex.entries.get(node.id);
  const hasChildren = (node.children?.length ?? 0) > 0;
  const onPath = ancestorSet.has(node.id);
  const isSelectedChapter =
    !isLeaf && selectedNodeId === node.id && mode === "verse";
  const expanded = onPath;

  if (depth === 0 && hasChildren) {
    const children = node.children ?? [];
    const previewChildren = children.slice(0, 6);
    const remaining = children.length - previewChildren.length;
    const meta = entry
      ? `${entry.leafCount}v`
      : "";
    return (
      <div className="vv-node">
        <div
          className={`vv-nh${expanded ? " open" : ""}${
            isSelectedChapter ? " active-node" : ""
          }`}
          onClick={() => onSelectNode(node.id)}
        >
          <div className="vv-nl">
            <span className="vv-nm">
              {node.level_name}
              {node.sequence_number != null ? ` ${node.sequence_number}` : ""}
            </span>
            <span className="vv-nn">{labelOf(node)}</span>
          </div>
          <div className="vv-nc">
            {meta}
            {hasChildren ? <span>{expanded ? "▴" : "▾"}</span> : null}
          </div>
        </div>
        {expanded ? (
          <div className="vv-vlist open">
            {previewChildren.map((child) => (
              <ChildRow
                key={child.id}
                node={child}
                treeIndex={treeIndex}
                selectedNodeId={selectedNodeId}
                onSelectNode={onSelectNode}
              />
            ))}
            {remaining > 0 ? (
              <div
                className="vv-vrow"
                style={{ opacity: 0.35, fontStyle: "italic" }}
              >
                +{remaining} more
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }
  return null;
}

function ChildRow({
  node,
  treeIndex,
  selectedNodeId,
  onSelectNode,
}: {
  node: TocNode;
  treeIndex: TreeIndex<TocNode>;
  selectedNodeId: number | null;
  onSelectNode: (id: number) => void;
}) {
  const entry = treeIndex.entries.get(node.id);
  const isLeaf = entry?.isLeaf ?? false;
  const targetId = isLeaf ? node.id : entry?.firstLeafId ?? node.id;
  const isActive = selectedNodeId === targetId;
  return (
    <div
      className={`vv-vrow${isActive ? " active" : ""}`}
      onClick={() => onSelectNode(targetId)}
    >
      {labelOf(node)}
    </div>
  );
}

function TopBar({
  book,
  tree,
  treeIndex,
  selectedEntry,
  mode,
  onModeChange,
  langPair,
  fieldVis,
  availableTrgLanguages,
  onSelectNode,
}: {
  book: ResolvedBook;
  tree: TocNode[];
  treeIndex: TreeIndex<TocNode>;
  selectedEntry: TreeIndexEntry<TocNode> | null;
  mode: ViewMode;
  onModeChange: (next: ViewMode) => void;
  langPair: ReturnType<typeof useLanguagePair>;
  fieldVis: ReturnType<typeof useFieldVisibility>;
  availableTrgLanguages: ScriptleLanguageCode[];
  onSelectNode: (id: number) => void;
}) {
  const [openLd, setOpenLd] = useState<"src" | "trg" | null>(null);
  const [openFv, setOpenFv] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpenLd(null);
        setOpenFv(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const path = selectedEntry ? getPath(treeIndex, selectedEntry.node.id) : [];

  return (
    <div className="vv-tb" ref={wrapperRef}>
      <div className="vv-bc">
        <span onClick={() => onSelectNode(treeIndex.leaves[0]?.id ?? 0)}>
          {book.titleEnglish}
        </span>
        {path.map((node, idx) => {
          const isLast = idx === path.length - 1;
          return (
            <span key={node.id} style={{ display: "contents" }}>
              <span style={{ opacity: 0.4 }}>›</span>
              <span
                style={isLast ? { color: "var(--color-text)" } : undefined}
                onClick={() => onSelectNode(node.id)}
              >
                {labelOf(node)}
              </span>
            </span>
          );
        })}
      </div>
      <div className="vv-tr-r">
        <div className="vv-tabs">
          <button
            className={`vv-tab${mode === "verse" ? " active" : ""}`}
            onClick={() => onModeChange("verse")}
          >
            <svg
              width={12}
              height={12}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
            >
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
            Verse
          </button>
          <button
            className={`vv-tab${mode === "scroll" ? " active" : ""}`}
            onClick={() => onModeChange("scroll")}
          >
            <svg
              width={12}
              height={12}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
            >
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
            Scroll
          </button>
        </div>
        <div className="vv-lpair">
          <div
            className="vv-lp-side"
            onClick={() => setOpenLd(openLd === "src" ? null : "src")}
          >
            <span
              className="vv-ldot"
              style={{ background: LANG_DOT_COLOR[langPair.src] }}
            />
            <div className="vv-lp-info">
              <span className="vv-lp-tag">Source</span>
              <span className="vv-lp-name">{LANGUAGE_NAMES[langPair.src]}</span>
            </div>
            {openLd === "src" ? (
              <Dropdown
                align="left"
                title="Source script"
                options={SOURCE_OPTIONS.map((code) => ({
                  code,
                  available: true,
                  unavailableLabel: "no script",
                }))}
                value={langPair.src}
                onSelect={(code) => {
                  langPair.setSrcLang(code);
                  setOpenLd(null);
                }}
              />
            ) : null}
          </div>
          <span className="vv-lp-arrow">→</span>
          <div
            className="vv-lp-side"
            onClick={() => setOpenLd(openLd === "trg" ? null : "trg")}
          >
            <span
              className="vv-ldot"
              style={{ background: LANG_DOT_COLOR[langPair.trg] }}
            />
            <div className="vv-lp-info">
              <span className="vv-lp-tag">Translation</span>
              <span className="vv-lp-name">{LANGUAGE_NAMES[langPair.trg]}</span>
            </div>
            {openLd === "trg" ? (
              <Dropdown
                align="right"
                title="Translation"
                options={TARGET_OPTIONS.map((code) => ({
                  code,
                  available: availableTrgLanguages.includes(code),
                  unavailableLabel: "not generated",
                }))}
                value={langPair.trg}
                onSelect={(code) => {
                  langPair.setTrgLang(code);
                  setOpenLd(null);
                }}
              />
            ) : null}
          </div>
        </div>
        <div className="vv-fv-wrap">
          <button
            type="button"
            className={`vv-fv-btn${
              fieldVis.hiddenCount > 0 ? " has-hidden" : ""
            }`}
            onClick={() => setOpenFv((v) => !v)}
            aria-expanded={openFv}
          >
            <svg
              width={13}
              height={13}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
            >
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            Fields
            {fieldVis.hiddenCount > 0 ? (
              <span className="vv-fv-count">
                {fieldVis.hiddenCount} hidden
              </span>
            ) : null}
          </button>
          {openFv ? (
            <div className="vv-fv-pop open">
              <div className="vv-fv-h">
                <span>Show fields</span>
                <button
                  type="button"
                  className="vv-fv-h-r"
                  onClick={fieldVis.reset}
                >
                  Show all
                </button>
              </div>
              {FIELD_DEFS.map((def) => (
                <div
                  key={def.key}
                  className={`vv-fv-row${fieldVis.fields[def.key] ? " on" : ""}`}
                  onClick={() => fieldVis.toggle(def.key)}
                >
                  <div className="vv-fv-toggle" />
                  <span className="vv-fv-icon">{def.icon}</span>
                  <div className="vv-fv-info">
                    <div className="vv-fv-name">{def.name}</div>
                    <div className="vv-fv-desc">{def.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Dropdown({
  align,
  title,
  options,
  value,
  onSelect,
}: {
  align: "left" | "right";
  title: string;
  options: {
    code: ScriptleLanguageCode;
    available: boolean;
    unavailableLabel?: string;
  }[];
  value: ScriptleLanguageCode;
  onSelect: (code: ScriptleLanguageCode) => void;
}) {
  return (
    <div
      className={`vv-ld open ${align === "left" ? "left-aligned" : "right-aligned"}`}
    >
      <div className="vv-ld-h">{title}</div>
      {options.map(({ code, available, unavailableLabel }) => {
        const active = code === value;
        return (
          <div
            key={code}
            className={`vv-lo${active ? " active" : ""}${
              !available ? " vv-lna" : ""
            }`}
            onClick={(event) => {
              event.stopPropagation();
              if (available) onSelect(code);
            }}
          >
            <span
              className="vv-ldot"
              style={{ background: LANG_DOT_COLOR[code] }}
            />
            <div className="vv-ldb">
              <span>{LANGUAGE_NAMES[code]}</span>
              {LANG_NATIVE[code] ? (
                <span className="vv-lnat">{LANG_NATIVE[code]}</span>
              ) : null}
            </div>
            {available ? (
              <span className="vv-lck">✓</span>
            ) : (
              <span
                style={{
                  fontSize: "9px",
                  marginLeft: "auto",
                  opacity: 0.7,
                }}
              >
                {unavailableLabel ?? "not available"}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Body({
  book,
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
  leafCount,
  prevLeaf,
  nextLeaf,
  onSelectNode,
  onModeChange,
}: {
  book: ResolvedBook;
  mode: ViewMode;
  treeLoading: boolean;
  treeError: string | null;
  treeIndex: TreeIndex<TocNode>;
  selectedEntry: TreeIndexEntry<TocNode> | null;
  isLeaf: boolean;
  nodeContent: VerseNode | null;
  nodeContentLoading: boolean;
  fieldVis: ReturnType<typeof useFieldVisibility>;
  langPair: ReturnType<typeof useLanguagePair>;
  leafCount: number;
  prevLeaf: TocNode | null;
  nextLeaf: TocNode | null;
  onSelectNode: (id: number) => void;
  onModeChange: (mode: ViewMode) => void;
}) {
  if (treeLoading) {
    return (
      <div className="vv-panel active">
        <div className="vv-vbody">
          <p
            style={{
              color: "var(--color-text-muted)",
              fontSize: "13px",
              fontStyle: "italic",
              fontFamily: "var(--font-serif)",
            }}
          >
            Loading…
          </p>
        </div>
      </div>
    );
  }
  if (treeError) {
    return (
      <div className="vv-panel active">
        <div className="vv-vbody">
          <p
            style={{
              color: "var(--color-text-muted)",
              fontSize: "13px",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
            }}
          >
            {treeError}
          </p>
        </div>
      </div>
    );
  }
  if (mode === "scroll") {
    return (
      <div className="vv-panel active">
        <ScrollPanel
          book={book}
          treeIndex={treeIndex}
          fieldVis={fieldVis}
          langPair={langPair}
          onSelectNode={onSelectNode}
          onModeChange={onModeChange}
        />
      </div>
    );
  }
  if (!selectedEntry) {
    return (
      <div className="vv-panel active">
        <div className="vv-vbody">
          <p
            style={{
              color: "var(--color-text-muted)",
              fontSize: "13px",
              fontStyle: "italic",
              fontFamily: "var(--font-serif)",
            }}
          >
            Select a node from the table of contents to begin.
          </p>
        </div>
      </div>
    );
  }
  if (!isLeaf) {
    return (
      <div className="vv-panel active">
        <ChapterOverview
          book={book}
          entry={selectedEntry}
          treeIndex={treeIndex}
          langPair={langPair}
          onSelectNode={onSelectNode}
        />
      </div>
    );
  }
  if (nodeContentLoading && !nodeContent) {
    return (
      <div className="vv-panel active">
        <div className="vv-vbody">
          <p
            style={{
              color: "var(--color-text-muted)",
              fontSize: "13px",
              fontStyle: "italic",
              fontFamily: "var(--font-serif)",
            }}
          >
            Loading verse…
          </p>
        </div>
      </div>
    );
  }
  if (!nodeContent) {
    return (
      <div className="vv-panel active">
        <div className="vv-vbody">
          <p
            style={{
              color: "var(--color-text-muted)",
              fontSize: "13px",
              fontStyle: "italic",
              fontFamily: "var(--font-serif)",
            }}
          >
            Could not load this verse.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="vv-panel active">
      <VersePane
        book={book}
        node={nodeContent}
        fieldVis={fieldVis}
        langPair={langPair}
      />
      <div className="vv-nav">
        <button
          type="button"
          className="vv-nb"
          disabled={!prevLeaf}
          onClick={() => prevLeaf && onSelectNode(prevLeaf.id)}
        >
          ← Prev
        </button>
        <span className="vv-npos">
          {selectedEntry.leafIndex >= 0
            ? `${selectedEntry.leafIndex + 1} of ${leafCount}`
            : `${leafCount} verses`}
        </span>
        <button
          type="button"
          className="vv-nb"
          disabled={!nextLeaf}
          onClick={() => nextLeaf && onSelectNode(nextLeaf.id)}
        >
          Next →
        </button>
      </div>
    </div>
  );
}

function VersePane({
  book,
  node,
  fieldVis,
  langPair,
}: {
  book: ResolvedBook;
  node: VerseNode;
  fieldVis: ReturnType<typeof useFieldVisibility>;
  langPair: ReturnType<typeof useLanguagePair>;
}) {
  const sanskrit = node.content_data?.basic?.sanskrit ?? "";
  const transliteration = node.content_data?.basic?.transliteration ?? "";
  const wordMeanings = node.content_data?.word_meanings ?? [];
  const translationVariants = node.content_data?.translation_variants ?? [];
  const commentaryVariants = node.content_data?.commentary_variants ?? [];
  const directTranslation =
    node.content_data?.translations?.[TRG_LANG_KEY[langPair.trg]]?.trim() ||
    null;

  const targetScript = SRC_TO_SCRIPT[langPair.src];
  const showSourceScript =
    fieldVis.fields.srcScript &&
    targetScript !== null &&
    targetScript !== "devanagari";
  const sourceScriptText = useMemo(() => {
    if (!showSourceScript || !sanskrit || !targetScript) return "";
    const normalized = normalizeTransliterationScript(targetScript);
    return hasDevanagariLetters(sanskrit)
      ? transliterateFromDevanagari(sanskrit, normalized)
      : transliterateFromIast(sanskrit, normalized);
  }, [showSourceScript, sanskrit, targetScript]);

  const allHidden = Object.values(fieldVis.fields).every((v) => !v);
  const verseRef = `${book.titleEnglish} · ${
    node.sequence_number ?? node.level_name
  }`;

  if (allHidden) {
    return (
      <div className="vv-vbody">
        <div className="vv-vno">{verseRef}</div>
        <div className="vv-empty">
          All fields are hidden.
          <br />
          <button type="button" className="vv-empty-a" onClick={fieldVis.reset}>
            Show all fields
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="vv-vbody">
      <div className="vv-vno">{verseRef}</div>
      {(fieldVis.fields.original && sanskrit) ||
      (fieldVis.fields.iast && transliteration) ? (
        <div className="vv-orig">
          {fieldVis.fields.original && sanskrit ? (
            <div className="vv-sk-main">{sanskrit}</div>
          ) : null}
          {fieldVis.fields.iast && transliteration ? (
            <div className="vv-ia">{transliteration}</div>
          ) : null}
        </div>
      ) : null}

      {showSourceScript && sourceScriptText ? (
        <Section
          label={
            <>
              Source script{" "}
              <span className="vv-sec-tag">{LANGUAGE_NAMES[langPair.src]}</span>
            </>
          }
        >
          <div className={`vv-st script-${langPair.src}`}>{sourceScriptText}</div>
        </Section>
      ) : null}

      {fieldVis.fields.w2w && wordMeanings.length > 0 ? (
        <Section
          label="Word for word"
          tag={`${wordMeanings.length} words`}
        >
          <AuthoredCard
            authorName="HSP AI"
            isAi
            tag={`${wordMeanings.length} words`}
          >
            <div className="vv-flow">
              {wordMeanings.map((pair, idx) => (
                <span key={idx} className="vv-flow-tok">
                  <span className={`vv-flow-src script-${langPair.src}`}>
                    {pair.word}
                  </span>
                  <span className="vv-flow-sep">·</span>
                  <span className={`vv-flow-mn script-${langPair.trg}`}>
                    {pair.meaning}
                  </span>
                </span>
              ))}
            </div>
          </AuthoredCard>
        </Section>
      ) : null}

      {fieldVis.fields.translation ? (
        <Section
          label="Translation"
          tag={
            translationVariants.length > 0
              ? `${translationVariants.length} ${
                  translationVariants.length === 1 ? "author" : "authors"
                }`
              : "1 author"
          }
        >
          {translationVariants.length > 0 ? (
            translationVariants.map((variant, idx) => (
              <AuthoredCard
                key={idx}
                authorName={variant.author_name || "Unknown"}
                isAi={!variant.author_name || variant.author_name === "HSP AI"}
                isVerified={variant.verified === true}
                tag={LANGUAGE_NAMES[langPair.trg]}
              >
                <div className={`vv-tr-text script-${langPair.trg}`}>
                  {variant.text || ""}
                </div>
              </AuthoredCard>
            ))
          ) : directTranslation ? (
            <AuthoredCard
              authorName="HSP AI"
              isAi
              tag={LANGUAGE_NAMES[langPair.trg]}
            >
              <div className={`vv-tr-text script-${langPair.trg}`}>
                {directTranslation}
              </div>
            </AuthoredCard>
          ) : (
            <div className="vv-empty" style={{ marginTop: 0 }}>
              No translation available in {LANGUAGE_NAMES[langPair.trg]}.
            </div>
          )}
        </Section>
      ) : null}

      {fieldVis.fields.commentary && commentaryVariants.length > 0 ? (
        <Section
          label="Commentary"
          tag={`${commentaryVariants.length} ${
            commentaryVariants.length === 1 ? "author" : "authors"
          }`}
        >
          {commentaryVariants.map((variant, idx) => (
            <AuthoredCard
              key={idx}
              authorName={variant.author_name || "Unknown"}
              isAi={!variant.author_name || variant.author_name === "HSP AI"}
              tag={LANGUAGE_NAMES[langPair.trg]}
            >
              <div className={`vv-tr-text script-${langPair.trg}`}>
                {variant.text || ""}
              </div>
            </AuthoredCard>
          ))}
        </Section>
      ) : null}
    </div>
  );
}

function Section({
  label,
  tag,
  children,
}: {
  label: ReactNode;
  tag?: string;
  children: ReactNode;
}) {
  return (
    <div className="vv-sec">
      <div className="vv-sec-h">
        <div className="vv-sec-lbl">{label}</div>
        {tag ? <div className="vv-sec-tag">{tag}</div> : null}
      </div>
      {children}
    </div>
  );
}

function AuthoredCard({
  authorName,
  isAi,
  isVerified,
  tag,
  children,
}: {
  authorName: string;
  isAi?: boolean;
  isVerified?: boolean;
  tag?: string;
  children: ReactNode;
}) {
  return (
    <div className="vv-ac">
      <div className="vv-ac-h">
        <div className="vv-ac-auth">
          {authorName}
          {isAi ? <span className="vv-aibadge">AI</span> : null}
          {isVerified ? <span className="vv-vbadge">Verified</span> : null}
        </div>
        {tag ? <div className="vv-ac-tag">{tag}</div> : null}
      </div>
      <div className="vv-ac-b">{children}</div>
    </div>
  );
}

function ChapterOverview({
  book,
  entry,
  treeIndex,
  langPair,
  onSelectNode,
}: {
  book: ResolvedBook;
  entry: TreeIndexEntry<TocNode>;
  treeIndex: TreeIndex<TocNode>;
  langPair: ReturnType<typeof useLanguagePair>;
  onSelectNode: (id: number) => void;
}) {
  const node = entry.node;
  const firstLeafEntry = treeIndex.entries.get(entry.firstLeafId);
  const firstLeaf = firstLeafEntry?.node;
  const [firstLeafContent, setFirstLeafContent] = useState<VerseNode | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => {
    if (!firstLeaf) return;
    let cancelled = false;
    fetch(`/api/content/nodes/${firstLeaf.id}`, { credentials: "include" })
      .then((r) => (r.ok ? (r.json() as Promise<VerseNode>) : null))
      .then((data) => {
        if (!cancelled && data) setFirstLeafContent(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [firstLeaf?.id]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/content/nodes/${node.id}/overview`, { credentials: "include" })
      .then((r) => (r.ok ? (r.json() as Promise<{ summary?: string | null }>) : null))
      .then((data) => {
        if (!cancelled && data?.summary) setSummary(data.summary);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [node.id]);

  const flSk = firstLeafContent?.content_data?.basic?.sanskrit?.split("\n")[0] ?? "";
  const flTrans =
    firstLeafContent?.content_data?.translations?.[TRG_LANG_KEY[langPair.trg]] ??
    firstLeafContent?.content_data?.translations?.english ??
    "";
  const flTransShort =
    flTrans.length > 120 ? flTrans.slice(0, 120) + "…" : flTrans;

  return (
    <div className="vv-overview">
      <div className="vv-ov-meta">
        {node.level_name}
        {node.sequence_number != null ? ` ${node.sequence_number}` : ""}
      </div>
      {node.title_sanskrit ? (
        <div className="vv-ov-sk">{node.title_sanskrit}</div>
      ) : null}
      <div className="vv-ov-name">{labelOf(node)}</div>
      <div className="vv-ov-sub">
        {entry.leafCount} verse{entry.leafCount === 1 ? "" : "s"}
      </div>
      <div className="vv-ov-stats">
        <div className="vv-ov-stat">
          <strong>{entry.leafCount}</strong>
          verses
        </div>
        <div className="vv-ov-stat">
          <strong>{node.level_name}</strong>
          type
        </div>
      </div>
      {summary ? (
        <>
          <div className="vv-ov-divider" />
          <div className="vv-ov-summary-label">About this {node.level_name.toLowerCase()}</div>
          <div className="vv-ov-summary">{summary}</div>
        </>
      ) : null}
      {firstLeaf ? (
        <button
          type="button"
          className="vv-ov-firstv"
          onClick={() => onSelectNode(firstLeaf.id)}
        >
          <div className="vv-ov-firstv-lbl">
            Begin reading · {labelOf(firstLeaf)}
          </div>
          {flSk ? <div className="vv-ov-firstv-sk">{flSk}</div> : null}
          {flTransShort ? (
            <div className="vv-ov-firstv-tr">{flTransShort}</div>
          ) : null}
        </button>
      ) : null}
      {/* book param ensures TS uses it */}
      <span style={{ display: "none" }}>{book.id}</span>
    </div>
  );
}

function ScrollPanel({
  book,
  treeIndex,
  fieldVis,
  langPair,
  onSelectNode,
  onModeChange,
}: {
  book: ResolvedBook;
  treeIndex: TreeIndex<TocNode>;
  fieldVis: ReturnType<typeof useFieldVisibility>;
  langPair: ReturnType<typeof useLanguagePair>;
  onSelectNode: (id: number) => void;
  onModeChange: (mode: ViewMode) => void;
}) {
  const [verses, setVerses] = useState<VerseSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [expandedFull, setExpandedFull] = useState<VerseNode | null>(null);
  const limit = 30;

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });
    fetch(
      `/api/content/books/${book.id}/verses?${new URLSearchParams({
        offset: "0",
        limit: String(limit),
        trg_lang: langPair.trg,
      }).toString()}`,
      { credentials: "include" }
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data) {
          setVerses(data.verses ?? []);
          setTotal(data.total ?? 0);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setVerses([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [book.id, langPair.trg]);

  useEffect(() => {
    if (expanded === null) {
      queueMicrotask(() => setExpandedFull(null));
      return;
    }
    let cancelled = false;
    fetch(`/api/content/nodes/${expanded}`, { credentials: "include" })
      .then((r) => (r.ok ? (r.json() as Promise<VerseNode>) : null))
      .then((data) => {
        if (!cancelled && data) setExpandedFull(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [expanded]);

  if (loading) {
    return (
      <div className="vv-scroll">
        <div className="vv-lmore">Loading verses…</div>
      </div>
    );
  }
  if (!verses || verses.length === 0) {
    return (
      <div className="vv-scroll">
        <div className="vv-lmore">No verses available.</div>
      </div>
    );
  }

  return (
    <div className="vv-scroll">
      {verses.map((verse) => {
        const isE = expanded === verse.id;
        const sk = verse.sanskrit ?? "";
        const ia = verse.transliteration ?? "";
        return (
          <div
            key={verse.id}
            className={`vv-srow${isE ? " exp" : ""}`}
            onClick={() => setExpanded(isE ? null : verse.id)}
          >
            <div className="vv-srn">
              {book.titleEnglish} ·{" "}
              {verse.sequence_number ?? verse.level_name}
            </div>
            {fieldVis.fields.original && sk ? (
              <div className="vv-srsk">
                {sk.split("\n").slice(0, 2).join("\n")}
              </div>
            ) : null}
            {fieldVis.fields.iast && ia ? (
              <div className="vv-sria">
                {ia.split("\n").slice(0, 2).join("\n")}
              </div>
            ) : null}
            {isE ? (
              <ScrollExpansion
                full={expandedFull}
                fieldVis={fieldVis}
                langPair={langPair}
                onOpenFull={() => {
                  onSelectNode(verse.id);
                  onModeChange("verse");
                }}
              />
            ) : null}
          </div>
        );
      })}
      {total > verses.length ? (
        <div className="vv-lmore">
          {verses.length} of {total} verses · pagination coming soon
        </div>
      ) : null}
    </div>
  );
}

type VerseSummary = {
  id: number;
  level_name: string;
  sequence_number?: string | null;
  sanskrit?: string | null;
  transliteration?: string | null;
};

function ScrollExpansion({
  full,
  fieldVis,
  langPair,
  onOpenFull,
}: {
  full: VerseNode | null;
  fieldVis: ReturnType<typeof useFieldVisibility>;
  langPair: ReturnType<typeof useLanguagePair>;
  onOpenFull: () => void;
}) {
  if (!full) {
    return (
      <div className="vv-srx open">
        <div className="vv-empty" style={{ margin: 0 }}>
          Loading…
        </div>
      </div>
    );
  }
  const sanskrit = full.content_data?.basic?.sanskrit ?? "";
  const targetScript = SRC_TO_SCRIPT[langPair.src];
  const showSourceScript =
    fieldVis.fields.srcScript &&
    targetScript !== null &&
    targetScript !== "devanagari";
  const sourceScriptText =
    showSourceScript && sanskrit && targetScript
      ? hasDevanagariLetters(sanskrit)
        ? transliterateFromDevanagari(
            sanskrit,
            normalizeTransliterationScript(targetScript)
          )
        : transliterateFromIast(
            sanskrit,
            normalizeTransliterationScript(targetScript)
          )
      : "";
  const w2w = full.content_data?.word_meanings ?? [];
  const trVariants = full.content_data?.translation_variants ?? [];
  const cmVariants = full.content_data?.commentary_variants ?? [];
  const directTr =
    full.content_data?.translations?.[TRG_LANG_KEY[langPair.trg]] ?? "";

  const sections: ReactNode[] = [];
  if (showSourceScript && sourceScriptText) {
    sections.push(
      <div className="vv-srx-sec" key="src">
        <div className="vv-srx-sec-lbl">
          Source · {LANGUAGE_NAMES[langPair.src]}
        </div>
        <div
          className={`vv-st script-${langPair.src}`}
          style={{ fontSize: 15 }}
        >
          {sourceScriptText}
        </div>
      </div>
    );
  }
  if (fieldVis.fields.w2w && w2w.length > 0) {
    sections.push(
      <div className="vv-srx-sec" key="w2w">
        <div className="vv-srx-sec-lbl">Word for word · HSP AI</div>
        <div className="vv-ac">
          <div className="vv-ac-b">
            <div className="vv-flow">
              {w2w.map((pair, idx) => (
                <span key={idx} className="vv-flow-tok">
                  <span className={`vv-flow-src script-${langPair.src}`}>
                    {pair.word}
                  </span>
                  <span className="vv-flow-sep">·</span>
                  <span className={`vv-flow-mn script-${langPair.trg}`}>
                    {pair.meaning}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (fieldVis.fields.translation) {
    const trText = trVariants[0]?.text ?? directTr ?? "";
    if (trText) {
      sections.push(
        <div className="vv-srx-sec" key="tr">
          <div className="vv-srx-sec-lbl">
            Translation · {trVariants[0]?.author_name ?? "HSP AI"}
          </div>
          <div className="vv-ac">
            <div className="vv-ac-b">
              <div
                className={`vv-tr-text script-${langPair.trg}`}
                style={{ fontSize: 13 }}
              >
                {trText}
              </div>
            </div>
          </div>
        </div>
      );
    }
  }
  if (fieldVis.fields.commentary && cmVariants.length > 0) {
    sections.push(
      <div className="vv-srx-sec" key="cm">
        <div className="vv-srx-sec-lbl">
          Commentary · {cmVariants[0]?.author_name ?? "HSP AI"}
        </div>
        <div className="vv-ac">
          <div className="vv-ac-b">
            <div
              className={`vv-tr-text script-${langPair.trg}`}
              style={{ fontSize: 13 }}
            >
              {cmVariants[0]?.text ?? ""}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="vv-srx open">
      {sections.length > 0 ? sections : (
        <div className="vv-empty" style={{ margin: 0 }}>
          All supporting fields are hidden.
        </div>
      )}
      <div className="vv-sracts">
        <button
          type="button"
          className="vv-srbtn"
          onClick={(event) => {
            event.stopPropagation();
            onOpenFull();
          }}
        >
          Full view →
        </button>
      </div>
    </div>
  );
}

export default function ReadBookPage() {
  return (
    <Suspense
      fallback={
        <div data-scriptle="true" style={{ padding: "60px 24px", textAlign: "center" }}>
          <p style={{ color: "var(--color-text-muted)", fontSize: "13px" }}>
            Loading…
          </p>
        </div>
      }
    >
      <ReadBookContent />
    </Suspense>
  );
}
