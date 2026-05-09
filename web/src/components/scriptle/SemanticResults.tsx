"use client";

import Link from "next/link";
import { MutedNote } from "./typography";

export type SemanticResult = {
  node_id: number;
  book_id: number;
  book_name: string;
  book_code: string | null;
  sequence_number: string | null;
  similarity: number;
  translation: string;
  sanskrit: string;
};

type SemanticResultsProps = {
  results: SemanticResult[];
  loading: boolean;
  error: string | null;
  empty: boolean;
};

export default function SemanticResults({
  results,
  loading,
  error,
  empty,
}: SemanticResultsProps) {
  if (loading && results.length === 0) {
    return <MutedNote>Searching by meaning…</MutedNote>;
  }
  if (error) return <MutedNote>{error}</MutedNote>;
  if (empty) return <MutedNote>No related verses found.</MutedNote>;

  return (
    <ul className="flex flex-col gap-3">
      {results.map((result) => (
        <li key={result.node_id}>
          <ResultRow result={result} />
        </li>
      ))}
    </ul>
  );
}

function ResultRow({ result }: { result: SemanticResult }) {
  const pct = Math.round(result.similarity * 100);
  const dotIntensity = Math.min(1, Math.max(0.25, result.similarity));
  return (
    <Link
      href={`/scriptures?book=${result.book_id}&node=${result.node_id}&preview=node&from=home`}
      className="block rounded-[8px] border bg-white p-3 transition hover:border-[color:var(--color-accent)]"
      style={{ borderColor: "var(--color-border)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div
          style={{
            fontFamily: "var(--font-scriptle-sans)",
            fontSize: "10px",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--color-text-muted)",
          }}
        >
          {result.book_name}
          {result.sequence_number ? ` · ${result.sequence_number}` : ""}
        </div>
        <div className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="block h-[6px] w-[6px] rounded-full"
            style={{
              background: "#3B6D11",
              opacity: dotIntensity,
            }}
          />
          <span
            style={{
              fontSize: "10px",
              color: "var(--color-text-faint)",
              fontFamily: "var(--font-scriptle-sans)",
            }}
          >
            {pct}%
          </span>
        </div>
      </div>
      {result.sanskrit ? (
        <p
          className="mt-1 line-clamp-1"
          style={{
            fontFamily: "var(--font-scriptle-devanagari)",
            color: "var(--color-sanskrit)",
            fontSize: "15px",
            lineHeight: 1.4,
          }}
        >
          {result.sanskrit}
        </p>
      ) : null}
      {result.translation ? (
        <p
          className="mt-1.5 line-clamp-2"
          style={{
            fontFamily: "var(--font-scriptle-serif)",
            fontSize: "13px",
            color: "var(--color-text)",
            lineHeight: 1.6,
          }}
        >
          {result.translation}
        </p>
      ) : null}
    </Link>
  );
}
