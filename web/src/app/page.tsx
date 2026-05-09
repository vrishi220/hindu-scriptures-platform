"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Wordmark from "@/components/scriptle/Wordmark";
import SearchInput from "@/components/scriptle/SearchInput";
import SearchResultsTabs, {
  type TabKey,
} from "@/components/scriptle/SearchResultsTabs";
import KeywordResults, {
  type KeywordResult,
} from "@/components/scriptle/KeywordResults";
import SemanticResults, {
  type SemanticResult,
} from "@/components/scriptle/SemanticResults";
import AskResult from "@/components/scriptle/AskResult";
import { MutedNote } from "@/components/scriptle/typography";
import { useDebounced } from "@/lib/useDebounced";
import { hasDevanagariLetters } from "@/lib/indicScript";
import { getMe } from "@/lib/authClient";

type Stats = {
  books_count: number;
  nodes_count: number;
  users_count: number;
};

const QUESTION_OPENERS =
  /^(what|how|why|who|when|where|which|is|are|does|do|can|should|did)\b/i;

function defaultTabFor(query: string, askAvailable: boolean): TabKey {
  const trimmed = query.trim();
  if (!trimmed) return "keyword";
  if (QUESTION_OPENERS.test(trimmed) || trimmed.endsWith("?")) {
    return askAvailable ? "ask" : "semantic";
  }
  return "keyword";
}

function modeHintFor(query: string, askAvailable: boolean): string {
  const trimmed = query.trim();
  if (!trimmed) return "Search keyword, meaning, or ask the scriptures.";
  if (QUESTION_OPENERS.test(trimmed) || trimmed.endsWith("?")) {
    return askAvailable
      ? "Will ask the scriptures…"
      : "Searching keyword and meaning…";
  }
  if (hasDevanagariLetters(trimmed)) return "Searching keyword…";
  return "Searching keyword and meaning…";
}

function formatStat(value: number | undefined): string {
  if (value == null) return "—";
  if (value >= 1000) {
    const k = value / 1000;
    return k >= 100 ? `${Math.round(k)}K` : `${k.toFixed(k >= 10 ? 0 : 1)}K`;
  }
  return value.toString();
}

function HomeContent() {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query, 300);

  const [keywordResults, setKeywordResults] = useState<KeywordResult[]>([]);
  const [keywordLoading, setKeywordLoading] = useState(false);
  const [keywordError, setKeywordError] = useState<string | null>(null);

  const [semanticResults, setSemanticResults] = useState<SemanticResult[]>([]);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [semanticError, setSemanticError] = useState<string | null>(null);

  const [askedQuestion, setAskedQuestion] = useState<string | null>(null);

  const [askAvailable, setAskAvailable] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("keyword");
  const [tabSetByUser, setTabSetByUser] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);

  // Identity (for Ask gating) + library stats — both fire-and-forget.
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

  // Keyword search — debounced.
  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    if (!trimmed) {
      queueMicrotask(() => {
        setKeywordResults([]);
        setKeywordError(null);
        setKeywordLoading(false);
      });
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setKeywordLoading(true);
      setKeywordError(null);
    });
    fetch(
      `/api/search?${new URLSearchParams({
        q: trimmed,
        limit: "10",
      }).toString()}`,
      { credentials: "include" }
    )
      .then(async (r) => {
        if (!r.ok) throw new Error("Search failed");
        const data = (await r.json()) as { results?: KeywordResult[] };
        if (!cancelled) setKeywordResults(data.results ?? []);
      })
      .catch((err) => {
        if (!cancelled) {
          setKeywordError(err instanceof Error ? err.message : "Search failed");
        }
      })
      .finally(() => {
        if (!cancelled) setKeywordLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  // Semantic search — debounced.
  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    if (!trimmed) {
      queueMicrotask(() => {
        setSemanticResults([]);
        setSemanticError(null);
        setSemanticLoading(false);
      });
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setSemanticLoading(true);
      setSemanticError(null);
    });
    fetch("/api/search/semantic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        query: trimmed,
        language_code: "en",
        limit: 10,
      }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("Semantic search failed");
        const data = (await r.json()) as { results?: SemanticResult[] };
        if (!cancelled) setSemanticResults(data.results ?? []);
      })
      .catch((err) => {
        if (!cancelled) {
          setSemanticError(
            err instanceof Error ? err.message : "Search failed"
          );
        }
      })
      .finally(() => {
        if (!cancelled) setSemanticLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  // Auto-pick default tab when query arrives, until the user picks manually.
  useEffect(() => {
    if (tabSetByUser) return;
    queueMicrotask(() =>
      setActiveTab(defaultTabFor(debouncedQuery, askAvailable))
    );
  }, [debouncedQuery, askAvailable, tabSetByUser]);

  const tabs = useMemo(() => {
    const list: { key: TabKey; count?: number | null; loading?: boolean }[] = [
      {
        key: "keyword",
        count: query.trim() ? keywordResults.length : null,
        loading: keywordLoading,
      },
      {
        key: "semantic",
        count: query.trim() ? semanticResults.length : null,
        loading: semanticLoading,
      },
    ];
    if (askAvailable) {
      list.push({ key: "ask" });
    }
    return list;
  }, [
    askAvailable,
    keywordLoading,
    semanticLoading,
    keywordResults.length,
    semanticResults.length,
    query,
  ]);

  const onSubmit = () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    if (askAvailable) {
      setAskedQuestion(trimmed);
      setActiveTab("ask");
      setTabSetByUser(true);
    }
  };

  const showResults = query.trim().length > 0;

  return (
    <div
      data-scriptle="true"
      className="flex min-h-[calc(100vh-3rem)] w-full flex-col items-center px-4 pb-16 pt-16 sm:px-6 sm:pt-24"
    >
      <div className="flex w-full max-w-[640px] flex-col items-center gap-6">
        <Wordmark />
        <SearchInput value={query} onChange={setQuery} onSubmit={onSubmit} />
        <p
          className="text-center"
          style={{
            fontFamily: "var(--font-scriptle-sans)",
            fontSize: "11px",
            letterSpacing: "0.06em",
            color: "var(--color-text-faint)",
            minHeight: "16px",
          }}
        >
          {modeHintFor(query, askAvailable)}
        </p>
        {!showResults ? (
          <div
            className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center"
            style={{
              fontFamily: "var(--font-scriptle-sans)",
              fontSize: "11px",
              letterSpacing: "0.08em",
              color: "var(--color-text-faint)",
              textTransform: "uppercase",
            }}
          >
            <span>{formatStat(stats?.books_count)} texts</span>
            <span aria-hidden>·</span>
            <span>{formatStat(stats?.nodes_count)} verses</span>
            <span aria-hidden>·</span>
            <span>4 languages</span>
          </div>
        ) : null}
      </div>

      {showResults ? (
        <div className="mt-8 w-full max-w-[720px]">
          <SearchResultsTabs
            tabs={tabs}
            active={activeTab}
            onChange={(next) => {
              setActiveTab(next);
              setTabSetByUser(true);
            }}
          >
            {activeTab === "keyword" ? (
              <KeywordResults
                results={keywordResults}
                loading={keywordLoading}
                error={keywordError}
                empty={
                  !keywordLoading &&
                  keywordError === null &&
                  keywordResults.length === 0
                }
              />
            ) : activeTab === "semantic" ? (
              <SemanticResults
                results={semanticResults}
                loading={semanticLoading}
                error={semanticError}
                empty={
                  !semanticLoading &&
                  semanticError === null &&
                  semanticResults.length === 0
                }
              />
            ) : askAvailable ? (
              <AskResult question={askedQuestion} />
            ) : (
              <MutedNote>Ask is available to researchers.</MutedNote>
            )}
          </SearchResultsTabs>
        </div>
      ) : null}
    </div>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div
          data-scriptle="true"
          className="flex min-h-[calc(100vh-3rem)] items-center justify-center"
        />
      }
    >
      <HomeContent />
    </Suspense>
  );
}
