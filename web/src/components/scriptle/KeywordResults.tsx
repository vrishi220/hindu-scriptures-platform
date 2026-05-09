"use client";

import Link from "next/link";
import { MutedNote } from "./typography";

export type KeywordResult = {
  node: {
    id: number;
    book_id: number;
    title_english?: string | null;
    title_sanskrit?: string | null;
    title_transliteration?: string | null;
    level_name: string;
    sequence_number?: number | null;
    content_data?: {
      basic?: { sanskrit?: string; transliteration?: string };
      translations?: { english?: string };
    };
  };
  snippet?: string | null;
};

type KeywordResultsProps = {
  results: KeywordResult[];
  loading: boolean;
  error: string | null;
  empty: boolean;
};

export default function KeywordResults({
  results,
  loading,
  error,
  empty,
}: KeywordResultsProps) {
  if (loading && results.length === 0) {
    return <MutedNote>Searching…</MutedNote>;
  }
  if (error) return <MutedNote>{error}</MutedNote>;
  if (empty) return <MutedNote>No matches found.</MutedNote>;

  return (
    <ul className="flex flex-col gap-3">
      {results.map((result) => (
        <li key={result.node.id}>
          <ResultRow result={result} />
        </li>
      ))}
    </ul>
  );
}

function ResultRow({ result }: { result: KeywordResult }) {
  const sanskrit = result.node.content_data?.basic?.sanskrit ?? "";
  const translation = result.node.content_data?.translations?.english ?? "";
  const ref =
    `${result.node.level_name}${
      result.node.sequence_number ? ` ${result.node.sequence_number}` : ""
    }`.trim();

  return (
    <Link
      href={`/scriptures?book=${result.node.book_id}&node=${result.node.id}&preview=node&from=home`}
      className="block rounded-[8px] border bg-white p-3 transition hover:border-[color:var(--color-accent)]"
      style={{ borderColor: "var(--color-border)" }}
    >
      <div
        style={{
          fontFamily: "var(--font-scriptle-sans)",
          fontSize: "10px",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--color-text-muted)",
        }}
      >
        {ref}
      </div>
      {sanskrit ? (
        <p
          className="mt-1 line-clamp-1"
          style={{
            fontFamily: "var(--font-scriptle-devanagari)",
            color: "var(--color-sanskrit)",
            fontSize: "15px",
            lineHeight: 1.4,
          }}
        >
          {sanskrit}
        </p>
      ) : null}
      {result.snippet ? (
        <p
          className="mt-1.5 line-clamp-2"
          style={{
            fontFamily: "var(--font-scriptle-serif)",
            fontSize: "13px",
            color: "var(--color-text)",
            lineHeight: 1.6,
          }}
          dangerouslySetInnerHTML={{ __html: highlight(result.snippet) }}
        />
      ) : translation ? (
        <p
          className="mt-1.5 line-clamp-2"
          style={{
            fontFamily: "var(--font-scriptle-serif)",
            fontSize: "13px",
            color: "var(--color-text-muted)",
            lineHeight: 1.6,
          }}
        >
          {translation}
        </p>
      ) : null}
    </Link>
  );
}

function highlight(snippet: string): string {
  const escaped = snippet.replace(/[<&>]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"
  );
  return escaped
    .replace(/&lt;mark&gt;/g, '<mark style="background:#FCEACB;padding:0 2px;border-radius:2px">')
    .replace(/&lt;\/mark&gt;/g, "</mark>");
}
