"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MutedNote } from "./typography";

type CitedVerse = {
  node_id: number;
  book_id: number;
  book_name?: string;
  book_code?: string | null;
  sequence_number?: string | null;
  reference?: string;
};

type AskResultProps = {
  question: string | null;
};

export default function AskResult({ question }: AskResultProps) {
  const [answer, setAnswer] = useState("");
  const [citedVerses, setCitedVerses] = useState<CitedVerse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!question) {
      queueMicrotask(() => {
        setAnswer("");
        setCitedVerses([]);
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
      setCitedVerses([]);
      setError(null);
      setLoading(true);
    });

    void streamAsk(question, controller.signal, {
      onText: (chunk) => setAnswer((prev) => prev + chunk),
      onCitedVerses: (verses) => setCitedVerses(verses),
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

  if (!question) {
    return (
      <MutedNote>
        Press <kbd>Enter</kbd> or click the arrow to ask the scriptures.
      </MutedNote>
    );
  }

  if (error) return <MutedNote>{error}</MutedNote>;

  return (
    <div
      className="rounded-[10px] border bg-white p-5"
      style={{ borderColor: "var(--color-border)" }}
    >
      <div
        style={{
          fontFamily: "var(--font-scriptle-sans)",
          fontSize: "10px",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--color-accent)",
          marginBottom: "12px",
        }}
      >
        Answer
      </div>
      <p
        style={{
          fontFamily: "var(--font-scriptle-serif)",
          fontSize: "15px",
          lineHeight: 1.85,
          color: "var(--color-text)",
          whiteSpace: "pre-wrap",
        }}
      >
        {answer}
        {loading ? (
          <span
            aria-hidden
            className="ml-1 inline-block h-3 w-[2px] animate-pulse"
            style={{ background: "var(--color-accent)" }}
          />
        ) : null}
      </p>
      {citedVerses.length > 0 ? (
        <div
          className="mt-5 flex flex-wrap gap-1.5 border-t pt-3"
          style={{ borderColor: "var(--color-border-soft)" }}
        >
          {citedVerses.map((verse) => (
            <Link
              key={verse.node_id}
              href={`/scriptures?book=${verse.book_id}&node=${verse.node_id}&preview=node&from=home`}
              className="rounded-full border px-2.5 py-0.5 transition hover:border-[color:var(--color-accent)]"
              style={{
                borderColor: "var(--color-border)",
                background: "var(--color-surface)",
                fontFamily: "var(--font-scriptle-sans)",
                fontSize: "11px",
                color: "var(--color-text-muted)",
              }}
            >
              {verse.reference ||
                `${verse.book_name ?? verse.book_code ?? "Source"}${
                  verse.sequence_number ? ` ${verse.sequence_number}` : ""
                }`}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
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
          // malformed SSE event — skip
        }
      }
    }
  }
}
