"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { JSX } from "react";
import { getMe } from "@/lib/authClient";
import AppBanner from "@/components/scriptle/AppBanner";

type CitedVerse = {
  node_id: number;
  book_id: number;
  book_name: string;
  book_code: string | null;
  sequence_number: string | null;
  similarity: number;
  translation: string;
  sanskrit: string;
};

type Book = {
  id: number;
  book_name: string;
  book_code: string;
};

type ScopeType = "all" | "book" | "basket";

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "te", label: "Telugu" },
  { code: "hi", label: "Hindi" },
  { code: "ta", label: "Tamil" },
];

function inlineFormat(text: string): JSX.Element {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={i} className="font-semibold text-[color:var(--deep)]">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
          return <em key={i}>{part.slice(1, -1)}</em>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function renderMarkdown(text: string): JSX.Element[] {
  const blocks = text.split(/\n{2,}/);
  const result: JSX.Element[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const trimmed = block.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("### ")) {
      result.push(
        <h3 key={i} className="mt-4 mb-1 text-base font-semibold text-[color:var(--deep)]">
          {inlineFormat(trimmed.slice(4))}
        </h3>
      );
      continue;
    }
    if (trimmed.startsWith("## ")) {
      result.push(
        <h2 key={i} className="mt-4 mb-2 text-lg font-semibold text-[color:var(--deep)]">
          {inlineFormat(trimmed.slice(3))}
        </h2>
      );
      continue;
    }
    if (trimmed.startsWith("# ")) {
      result.push(
        <h1 key={i} className="mt-4 mb-2 text-xl font-semibold text-[color:var(--deep)]">
          {inlineFormat(trimmed.slice(2))}
        </h1>
      );
      continue;
    }

    const lines = trimmed.split("\n");
    const isList = lines.every((l) => /^[-*•]\s/.test(l.trim()) || !l.trim());
    if (isList) {
      result.push(
        <ul key={i} className="my-2 list-disc list-inside space-y-1 text-zinc-700">
          {lines
            .filter((l) => l.trim())
            .map((l, j) => (
              <li key={j}>{inlineFormat(l.trim().replace(/^[-*•]\s/, ""))}</li>
            ))}
        </ul>
      );
      continue;
    }

    result.push(
      <p key={i} className="my-2 leading-relaxed text-zinc-800">
        {lines.map((l, j) => (
          <span key={j}>
            {inlineFormat(l)}
            {j < lines.length - 1 && <br />}
          </span>
        ))}
      </p>
    );
  }

  return result;
}

export default function AskPage() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState("");
  const [citedVerses, setCitedVerses] = useState<CitedVerse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scopeType, setScopeType] = useState<ScopeType>("all");
  const [selectedBookCode, setSelectedBookCode] = useState<string>("");
  const [books, setBooks] = useState<Book[]>([]);
  const [languageCode, setLanguageCode] = useState("en");
  const [expandedVerse, setExpandedVerse] = useState<number | null>(null);
  const [basketId, setBasketId] = useState<number | null>(null);
  const [authUser, setAuthUser] = useState<{ email: string } | null>(null);
  const [addedToBasket, setAddedToBasket] = useState<Set<number>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const answerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const init = async () => {
      const me = await getMe();
      if (me?.email) setAuthUser({ email: me.email });

      try {
        const booksRes = await fetch("/api/books", { credentials: "include" });
        if (booksRes.ok) {
          const data = (await booksRes.json()) as Book[];
          setBooks(data);
        }
      } catch {
        // ignore
      }

      if (me) {
        try {
          const cartRes = await fetch("/api/cart/me", { credentials: "include" });
          if (cartRes.ok) {
            const cart = (await cartRes.json()) as { id?: number };
            setBasketId(cart.id ?? null);
          }
        } catch {
          // ignore
        }
      }
    };
    void init();
  }, []);

  const handleAsk = useCallback(async () => {
    const q = question.trim();
    if (!q || loading) return;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setAnswer("");
    setCitedVerses([]);
    setError(null);
    setAddedToBasket(new Set());
    setExpandedVerse(null);

    const scope: Record<string, unknown> = { type: scopeType };
    if (scopeType === "book" && selectedBookCode) {
      scope.book_codes = [selectedBookCode];
    } else if (scopeType === "basket" && basketId) {
      scope.basket_id = basketId;
    }

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          question: q,
          language_code: languageCode,
          scope,
          stream: true,
          limit: 15,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { detail?: string } | null;
        setError(payload?.detail ?? "Something went wrong. Please try again.");
        return;
      }

      const reader = res.body!.getReader();
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
                setAnswer((prev) => prev + event.text);
                if (answerRef.current) {
                  answerRef.current.scrollTop = answerRef.current.scrollHeight;
                }
              } else if (event.type === "cited_verses") {
                setCitedVerses(event.verses ?? []);
              } else if (event.type === "error") {
                setError(event.detail ?? "An error occurred.");
              }
            } catch {
              // malformed SSE event — skip
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setError("Connection failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [question, loading, scopeType, selectedBookCode, basketId, languageCode]);

  const handleAddToBasket = async (nodeId: number) => {
    if (!authUser) return;
    try {
      const res = await fetch("/api/cart/items", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_type: "library_node", item_id: nodeId }),
      });
      if (res.ok) {
        setAddedToBasket((prev) => new Set([...prev, nodeId]));
      }
    } catch {
      // ignore
    }
  };

  const pct = (similarity: number) => Math.round(similarity * 100);

  const askDisabled =
    loading ||
    !question.trim() ||
    (scopeType === "book" && !selectedBookCode) ||
    (scopeType === "basket" && (!authUser || !basketId));

  return (
    <div data-scriptle="true">
      <AppBanner active="search" />
      <main className="page-shell" style={{ maxWidth: 780 }}>
        <header>
          <p className="page-eyebrow">Ask</p>
          <h1 className="page-h1">Ask the scriptures</h1>
          <p className="page-lede">
            Answers grounded in Hindu scripture — every claim is cited back to
            a specific verse.
          </p>
        </header>

        {/* Scope + Language row */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-black/10 bg-zinc-100 p-0.5">
            {(["all", "book", "basket"] as ScopeType[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScopeType(s)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  scopeType === s
                    ? "bg-white text-[color:var(--deep)] shadow-sm"
                    : "text-zinc-600 hover:text-zinc-800"
                }`}
              >
                {s === "all" ? "All Scriptures" : s === "book" ? "Specific Book" : "My Basket"}
              </button>
            ))}
          </div>

          <select
            value={languageCode}
            onChange={(e) => setLanguageCode(e.target.value)}
            className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs text-zinc-700 focus:outline-none focus:border-[color:var(--accent)]"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        {/* Book selector */}
        {scopeType === "book" && (
          <div className="mb-4">
            <select
              value={selectedBookCode}
              onChange={(e) => setSelectedBookCode(e.target.value)}
              className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-zinc-700 focus:outline-none focus:border-[color:var(--accent)]"
            >
              <option value="">— Select a book —</option>
              {books.map((b) => (
                <option key={b.book_code} value={b.book_code}>
                  {b.book_name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Basket notices */}
        {scopeType === "basket" && !authUser && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Sign in to use your basket scope.
          </div>
        )}
        {scopeType === "basket" && authUser && !basketId && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Your basket is empty. Add verses from any scripture to use basket scope.
          </div>
        )}

        {/* Question input */}
        <div className="mb-6">
          <div className="relative">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void handleAsk();
                }
              }}
              placeholder="e.g. What does the Gita say about performing one's duty without attachment to results?"
              rows={4}
              maxLength={2000}
              disabled={loading}
              className="w-full resize-none rounded-xl border border-black/10 bg-white px-4 py-3 pr-28 text-sm text-zinc-800 placeholder-zinc-400 shadow-sm focus:outline-none focus:border-[color:var(--accent)] disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => void handleAsk()}
              disabled={askDisabled}
              className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--accent)] px-4 py-2 text-xs font-medium uppercase tracking-[0.15em] text-white shadow transition hover:-translate-y-0.5 hover:shadow-md disabled:opacity-50 disabled:translate-y-0 disabled:shadow-none"
            >
              {loading ? (
                <>
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Asking…
                </>
              ) : (
                "Ask →"
              )}
            </button>
          </div>
          <p className="mt-1.5 text-right text-[11px] text-zinc-400">
            {question.length}/2000 · Cmd+Enter to submit
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Answer */}
        {(answer || loading) && (
          <div className="mb-6">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">
              Answer
            </h2>
            <div
              ref={answerRef}
              className="max-h-[60vh] overflow-y-auto rounded-xl border border-black/10 bg-white px-5 py-4 shadow-sm"
            >
              {renderMarkdown(answer)}
              {loading && (
                <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-[color:var(--accent)] align-text-bottom" />
              )}
            </div>
          </div>
        )}

        {/* Cited verses */}
        {citedVerses.length > 0 && (
          <div>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">
              Cited Verses ({citedVerses.length})
            </h2>
            <div className="space-y-2">
              {citedVerses.map((verse) => {
                const match = pct(verse.similarity);
                const isExpanded = expandedVerse === verse.node_id;
                const added = addedToBasket.has(verse.node_id);
                const viewUrl =
                  verse.book_id
                    ? `/scriptures?book=${verse.book_id}&node=${verse.node_id}`
                    : null;

                return (
                  <div
                    key={verse.node_id}
                    className="overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm"
                  >
                    {/* Card header — always visible */}
                    <div
                      className="flex cursor-pointer items-start gap-3 px-4 py-3 transition hover:bg-zinc-50"
                      onClick={() =>
                        setExpandedVerse(isExpanded ? null : verse.node_id)
                      }
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-[color:var(--deep)]">
                            {verse.book_name}
                            {verse.sequence_number && ` ${verse.sequence_number}`}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              match >= 70
                                ? "bg-emerald-100 text-emerald-700"
                                : match >= 50
                                ? "bg-amber-100 text-amber-700"
                                : "bg-zinc-100 text-zinc-600"
                            }`}
                          >
                            {match}% match
                          </span>
                        </div>
                        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-zinc-100">
                          <div
                            className={`h-full rounded-full transition-all ${
                              match >= 70
                                ? "bg-emerald-400"
                                : match >= 50
                                ? "bg-amber-400"
                                : "bg-zinc-400"
                            }`}
                            style={{ width: `${match}%` }}
                          />
                        </div>
                      </div>
                      <span className="mt-1 shrink-0 text-xs text-zinc-400">
                        {isExpanded ? "▲" : "▼"}
                      </span>
                    </div>

                    {/* Expanded content */}
                    {isExpanded && (
                      <div className="space-y-3 border-t border-black/5 px-4 pb-4 pt-3">
                        {verse.translation && (
                          <div>
                            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-400">
                              Translation
                            </div>
                            <p className="text-sm leading-relaxed text-zinc-700">
                              {verse.translation}
                            </p>
                          </div>
                        )}
                        {verse.sanskrit && (
                          <div>
                            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-400">
                              Sanskrit
                            </div>
                            <p className="font-serif text-sm leading-relaxed text-zinc-600">
                              {verse.sanskrit}
                            </p>
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          {viewUrl && (
                            <a
                              href={viewUrl}
                              className="rounded-lg border border-black/10 px-3 py-1.5 text-xs text-zinc-600 transition hover:bg-zinc-50 hover:text-[color:var(--deep)]"
                            >
                              View Verse →
                            </a>
                          )}
                          {authUser && (
                            <button
                              type="button"
                              onClick={() => void handleAddToBasket(verse.node_id)}
                              disabled={added}
                              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                                added
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-black/10 text-zinc-600 hover:bg-zinc-50 hover:text-[color:var(--deep)]"
                              }`}
                            >
                              {added ? "✓ Added to Basket" : "+ Add to Basket"}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
