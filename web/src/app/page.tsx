"use client";

import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useDebounced } from "@/lib/useDebounced";
import { hasDevanagariLetters } from "@/lib/indicScript";
import { getMe } from "@/lib/authClient";

type Stats = { books_count: number; nodes_count: number; users_count: number };

type KeywordResult = {
  node: {
    id: number;
    book_id: number;
    title_english?: string | null;
    title_sanskrit?: string | null;
    level_name: string;
    sequence_number?: number | null;
    content_data?: {
      basic?: { sanskrit?: string };
      translations?: { english?: string };
    };
  };
  snippet?: string | null;
};

type SemanticResult = {
  node_id: number;
  book_id: number;
  book_name: string;
  book_code: string | null;
  sequence_number: string | null;
  similarity: number;
  translation: string;
  sanskrit: string;
};

type CitedVerse = {
  node_id: number;
  book_id: number;
  book_name?: string;
  book_code?: string | null;
  sequence_number?: string | null;
  reference?: string;
};

type TabKey = "keyword" | "semantic" | "ask";

const PLACEHOLDERS = [
  "What is the nature of the Self?",
  "liberation from suffering",
  "कर्म yoga",
  "How to attain moksha?",
  "surrender to God",
  "मोक्ष",
  "nature of Brahman",
  "What did Krishna say about death?",
  "path of devotion",
];

const QUESTION_OPENERS =
  /^(what|how|why|who|when|where|which|is|are|does|do|can|should|did)\b/i;

function isQuestion(q: string): boolean {
  const t = q.trim();
  return QUESTION_OPENERS.test(t) || t.endsWith("?");
}

function defaultTab(query: string, askAvailable: boolean): TabKey {
  if (!query.trim()) return "keyword";
  if (isQuestion(query)) return askAvailable ? "ask" : "semantic";
  if (hasDevanagariLetters(query)) return "keyword";
  return "keyword";
}

function formatStat(value: number | undefined): string {
  if (value == null) return "—";
  if (value >= 1000) {
    const k = value / 1000;
    return k >= 100 ? `${Math.round(k)}K` : `${k.toFixed(k >= 10 ? 0 : 1)}K`;
  }
  return value.toString();
}

function buildVerseHref(bookId: number, nodeId: number): string {
  return `/scriptures?book=${bookId}&node=${nodeId}&preview=node&from=home`;
}

function HomeContent() {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query, 320);
  const [askAvailable, setAskAvailable] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);

  const [keywordResults, setKeywordResults] = useState<KeywordResult[]>([]);
  const [keywordLoading, setKeywordLoading] = useState(false);
  const [semanticResults, setSemanticResults] = useState<SemanticResult[]>([]);
  const [semanticLoading, setSemanticLoading] = useState(false);

  const [askedQuestion, setAskedQuestion] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("keyword");
  const [tabSetByUser, setTabSetByUser] = useState(false);

  // Identity + stats
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getMe().catch(() => null),
      fetch("/api/stats", { credentials: "include" })
        .then((r) => (r.ok ? (r.json() as Promise<Stats>) : null))
        .catch(() => null),
    ]).then(([me, statsResp]) => {
      if (cancelled) return;
      if (me) {
        const role = me.role;
        const canAdmin = me.permissions?.can_admin ?? false;
        setAskAvailable(role === "researcher" || role === "admin" || canAdmin);
      }
      if (statsResp) setStats(statsResp);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keyword search (debounced)
  useEffect(() => {
    const t = debouncedQuery.trim();
    if (!t) {
      queueMicrotask(() => {
        setKeywordResults([]);
        setKeywordLoading(false);
      });
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setKeywordLoading(true);
    });
    fetch(
      `/api/search?${new URLSearchParams({ q: t, limit: "10" }).toString()}`,
      { credentials: "include" }
    )
      .then(async (r) => {
        if (!r.ok) throw new Error("Search failed");
        const data = (await r.json()) as { results?: KeywordResult[] };
        if (!cancelled) setKeywordResults(data.results ?? []);
      })
      .catch(() => {
        if (!cancelled) setKeywordResults([]);
      })
      .finally(() => {
        if (!cancelled) setKeywordLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  // Semantic search (debounced)
  useEffect(() => {
    const t = debouncedQuery.trim();
    if (!t) {
      queueMicrotask(() => {
        setSemanticResults([]);
        setSemanticLoading(false);
      });
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setSemanticLoading(true);
    });
    fetch("/api/search/semantic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ query: t, language_code: "en", limit: 10 }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("Semantic search failed");
        const data = (await r.json()) as { results?: SemanticResult[] };
        if (!cancelled) setSemanticResults(data.results ?? []);
      })
      .catch(() => {
        if (!cancelled) setSemanticResults([]);
      })
      .finally(() => {
        if (!cancelled) setSemanticLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  // Auto-pick default tab until the user picks one manually
  useEffect(() => {
    if (tabSetByUser) return;
    queueMicrotask(() => setActiveTab(defaultTab(debouncedQuery, askAvailable)));
  }, [debouncedQuery, askAvailable, tabSetByUser]);

  const showResults = query.trim().length > 0;
  const isQ = isQuestion(query);
  const showEnterHint = isQ && askAvailable;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const t = query.trim();
    if (!t) return;
    if (askAvailable) {
      setAskedQuestion(t);
      setActiveTab("ask");
      setTabSetByUser(true);
    }
  };

  return (
    <div data-scriptle="true">
      <div className="sr-hero">
        <div className="sr-wordmark">
          <span className="sr-om">ॐ</span> Scriptle
        </div>
        <form className="sr-search-outer" onSubmit={onSubmit}>
          <div className="sr-search-wrap">
            <SearchIcon />
            <input
              className="sr-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-label="Search the scriptures"
            />
            <RotatingPlaceholder hidden={query.length > 0} />
            {showEnterHint ? <span className="sr-enter-hint">↵ ask</span> : null}
          </div>
        </form>
        {!showResults ? (
          <div className="sr-stats">
            <span className="sr-stat">
              <strong>{formatStat(stats?.books_count)}</strong> texts
            </span>
            <span className="sr-stat">
              <strong>{formatStat(stats?.nodes_count)}</strong> verses
            </span>
            <span className="sr-stat">
              <strong>4</strong> languages
            </span>
          </div>
        ) : null}
      </div>

      {showResults ? (
        <div className="sr-body" style={{ display: "block" }}>
          <div className="sr-divider" />
          <div className="sr-tabs">
            <Tab
              kind="keyword"
              active={activeTab === "keyword"}
              count={keywordResults.length}
              loading={keywordLoading}
              onClick={() => {
                setActiveTab("keyword");
                setTabSetByUser(true);
              }}
            />
            <Tab
              kind="semantic"
              active={activeTab === "semantic"}
              count={semanticResults.length}
              loading={semanticLoading}
              onClick={() => {
                setActiveTab("semantic");
                setTabSetByUser(true);
              }}
            />
            {askAvailable ? (
              <Tab
                kind="ask"
                active={activeTab === "ask"}
                count={askedQuestion ? 1 : 0}
                onClick={() => {
                  setActiveTab("ask");
                  setTabSetByUser(true);
                }}
              />
            ) : null}
          </div>
          <KeywordPanel
            active={activeTab === "keyword"}
            results={keywordResults}
            loading={keywordLoading}
          />
          <SemanticPanel
            active={activeTab === "semantic"}
            results={semanticResults}
            loading={semanticLoading}
          />
          {askAvailable ? (
            <AskPanel
              active={activeTab === "ask"}
              question={askedQuestion}
              isQuestion={isQ}
              draftQuery={query}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      className="sr-search-icon"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function RotatingPlaceholder({ hidden }: { hidden: boolean }) {
  const [idx, setIdx] = useState(0);
  const [animKey, setAnimKey] = useState(0);
  const elRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (hidden) return;
    const handle = window.setInterval(() => {
      setIdx((i) => (i + 1) % PLACEHOLDERS.length);
      setAnimKey((k) => k + 1);
    }, 3500);
    return () => window.clearInterval(handle);
  }, [hidden]);

  return (
    <span
      ref={elRef}
      key={animKey}
      className={`sr-placeholder${hidden ? " hidden" : " animating"}`}
    >
      {PLACEHOLDERS[idx]}
    </span>
  );
}

function Tab({
  kind,
  active,
  count,
  loading,
  onClick,
}: {
  kind: TabKey;
  active: boolean;
  count: number;
  loading?: boolean;
  onClick: () => void;
}) {
  const label = kind === "keyword" ? "Keyword" : kind === "semantic" ? "Semantic" : "Ask";
  return (
    <button
      type="button"
      className={`sr-tab t-${kind}${active ? " active" : ""}`}
      onClick={onClick}
    >
      {label}
      <span className="sr-tab-count">{loading ? "…" : count}</span>
    </button>
  );
}

function KeywordPanel({
  active,
  results,
  loading,
}: {
  active: boolean;
  results: KeywordResult[];
  loading: boolean;
}) {
  return (
    <div className={`sr-panel${active ? " active" : ""}`}>
      {loading && results.length === 0 ? (
        <EmptyMsg>Searching…</EmptyMsg>
      ) : results.length === 0 ? (
        <EmptyMsg>No matches found.</EmptyMsg>
      ) : (
        results.map((r) => {
          const sk = r.node.content_data?.basic?.sanskrit ?? "";
          const tr =
            stripMark(r.snippet ?? "") ||
            r.node.content_data?.translations?.english ||
            "";
          const ref = `${r.node.level_name}${
            r.node.sequence_number ? ` ${r.node.sequence_number}` : ""
          }`.trim();
          return (
            <Link
              key={r.node.id}
              className="sr-verse-row"
              href={buildVerseHref(r.node.book_id, r.node.id)}
            >
              <div className="sr-ref">{ref}</div>
              <div className="sr-vbody">
                {sk ? <div className="sr-sk">{sk}</div> : null}
                {tr ? <div className="sr-tr">{tr}</div> : null}
              </div>
            </Link>
          );
        })
      )}
    </div>
  );
}

function SemanticPanel({
  active,
  results,
  loading,
}: {
  active: boolean;
  results: SemanticResult[];
  loading: boolean;
}) {
  return (
    <div className={`sr-panel${active ? " active" : ""}`}>
      {loading && results.length === 0 ? (
        <EmptyMsg>Searching by meaning…</EmptyMsg>
      ) : results.length === 0 ? (
        <EmptyMsg>No related verses found.</EmptyMsg>
      ) : (
        results.map((r) => (
          <Link
            key={r.node_id}
            className="sr-verse-row"
            href={buildVerseHref(r.book_id, r.node_id)}
          >
            <div className="sr-ref">
              {`${r.book_name}${r.sequence_number ? ` · ${r.sequence_number}` : ""}`}
              <div className="sr-sim-row">
                <div className="sr-simbar">
                  <div
                    className="sr-simfill"
                    style={{ width: `${Math.round(r.similarity * 100)}%` }}
                  />
                </div>
                <span className="sr-simval">{r.similarity.toFixed(2)}</span>
              </div>
            </div>
            <div className="sr-vbody">
              {r.sanskrit ? <div className="sr-sk">{r.sanskrit}</div> : null}
              {r.translation ? <div className="sr-tr">{r.translation}</div> : null}
            </div>
          </Link>
        ))
      )}
    </div>
  );
}

function AskPanel({
  active,
  question,
  isQuestion,
  draftQuery,
}: {
  active: boolean;
  question: string | null;
  isQuestion: boolean;
  draftQuery: string;
}) {
  const [answer, setAnswer] = useState("");
  const [cites, setCites] = useState<CitedVerse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!question) {
      queueMicrotask(() => {
        setAnswer("");
        setCites([]);
        setError(null);
        setLoading(false);
      });
      return;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setAnswer("");
      setCites([]);
      setError(null);
      setLoading(true);
    });
    void streamAsk(question, controller.signal, {
      onText: (chunk) => setAnswer((prev) => prev + chunk),
      onCitedVerses: (verses) => setCites(verses),
      onError: (detail) => setError(detail),
    })
      .catch((err) => {
        if (err instanceof Error && err.name !== "AbortError") {
          setError("Connection failed. Please try again.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [question]);

  if (!active) return <div className="sr-panel" />;

  if (!question) {
    if (!isQuestion) {
      return (
        <div className="sr-panel active">
          <div className="sr-ask-gated">
            Rephrase as a question to get a synthesised answer.
            <br />
            <br />
            e.g. &quot;What do the scriptures say about {draftQuery || "dharma"}?&quot;
          </div>
        </div>
      );
    }
    return (
      <div className="sr-panel active">
        <div className="sr-ask-gated">
          Press <kbd>↵ Enter</kbd> to ask the scriptures.
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sr-panel active">
        <EmptyMsg>{error}</EmptyMsg>
      </div>
    );
  }

  return (
    <div className="sr-panel active">
      <div className="sr-ask-card">
        <div className="sr-ask-ans">
          {answer}
          {loading ? (
            <span
              aria-hidden
              style={{
                display: "inline-block",
                width: 2,
                height: "1em",
                marginLeft: 2,
                background: "var(--color-accent)",
                animation: "scriptle-fade-in 0.5s ease infinite alternate",
                verticalAlign: "middle",
              }}
            />
          ) : null}
        </div>
        {cites.length > 0 ? (
          <>
            <div className="sr-cites-label">Cited verses</div>
            <div className="sr-cites">
              {cites.map((v) => (
                <Link
                  key={v.node_id}
                  className="sr-cite"
                  href={buildVerseHref(v.book_id, v.node_id)}
                >
                  {v.reference ||
                    `${v.book_name ?? v.book_code ?? "Source"}${
                      v.sequence_number ? ` · ${v.sequence_number}` : ""
                    }`}
                </Link>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function EmptyMsg({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        padding: "16px 0",
        fontSize: "13px",
        color: "var(--color-text-muted)",
        fontFamily: "var(--font-serif)",
        fontStyle: "italic",
      }}
    >
      {children}
    </p>
  );
}

function stripMark(snippet: string): string {
  return snippet.replace(/<\/?mark>/g, "");
}

async function streamAsk(
  question: string,
  signal: AbortSignal,
  handlers: {
    onText: (chunk: string) => void;
    onCitedVerses: (verses: CitedVerse[]) => void;
    onError: (detail: string) => void;
  }
): Promise<void> {
  const res = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      question,
      language_code: "en",
      scope: { type: "all" },
      stream: true,
      limit: 15,
    }),
    signal,
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as
      | { detail?: string }
      | null;
    handlers.onError(payload?.detail ?? "Could not ask the scriptures.");
    return;
  }
  if (!res.body) {
    handlers.onError("No response stream.");
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      for (const line of block.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") continue;
        try {
          const event = JSON.parse(raw) as {
            type: string;
            text?: string;
            verses?: CitedVerse[];
            detail?: string;
          };
          if (event.type === "text" && event.text) {
            handlers.onText(event.text);
          } else if (event.type === "cited_verses") {
            handlers.onCitedVerses(event.verses ?? []);
          } else if (event.type === "error") {
            handlers.onError(event.detail ?? "An error occurred.");
          }
        } catch {
          // skip malformed events
        }
      }
    }
  }
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div data-scriptle="true" className="sr-hero">
          <div className="sr-wordmark">
            <span className="sr-om">ॐ</span> Scriptle
          </div>
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
