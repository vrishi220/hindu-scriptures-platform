"use client";

import type { TocNode } from "./VerseTOC";

type ChapterOverviewProps = {
  node: TocNode;
  summary?: string | null;
  verseCount: number;
  firstLeaf?: TocNode | null;
  onBeginReading?: (leaf: TocNode) => void;
};

export default function ChapterOverview({
  node,
  summary,
  verseCount,
  firstLeaf,
  onBeginReading,
}: ChapterOverviewProps) {
  const title =
    node.title_english ||
    node.title_sanskrit ||
    node.title_transliteration ||
    `${node.level_name} ${node.sequence_number ?? ""}`.trim();

  return (
    <article className="flex flex-col gap-6 py-6">
      <header className="flex flex-col gap-1">
        <p
          style={{
            fontFamily: "var(--font-scriptle-sans)",
            fontSize: "11px",
            letterSpacing: "0.12em",
            color: "var(--color-text-muted)",
            textTransform: "uppercase",
          }}
        >
          {node.level_name}
          {node.sequence_number != null ? ` ${node.sequence_number}` : ""}
        </p>
        <h2
          style={{
            fontFamily: "var(--font-scriptle-serif)",
            fontSize: "26px",
            color: "var(--color-text)",
            letterSpacing: "-0.01em",
          }}
        >
          {title}
        </h2>
        {node.title_sanskrit ? (
          <p
            style={{
              fontFamily: "var(--font-scriptle-devanagari)",
              color: "var(--color-sanskrit)",
              fontSize: "18px",
            }}
          >
            {node.title_sanskrit}
          </p>
        ) : null}
      </header>

      {summary ? (
        <p
          style={{
            fontFamily: "var(--font-scriptle-serif)",
            fontSize: "14px",
            lineHeight: 1.8,
            color: "var(--color-text)",
            whiteSpace: "pre-line",
          }}
        >
          {summary}
        </p>
      ) : null}

      {firstLeaf && onBeginReading ? (
        <div
          className="rounded-[10px]"
          style={{
            border: "0.5px solid var(--color-border)",
            background: "var(--color-surface)",
            padding: "16px 18px",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-scriptle-sans)",
              fontSize: "10px",
              letterSpacing: "0.18em",
              color: "var(--color-text-muted)",
              textTransform: "uppercase",
            }}
          >
            Begin reading
          </div>
          <div
            className="mt-2"
            style={{
              fontFamily: "var(--font-scriptle-serif)",
              fontSize: "15px",
              color: "var(--color-text)",
            }}
          >
            {firstLeaf.title_english ||
              firstLeaf.title_sanskrit ||
              `${firstLeaf.level_name} ${firstLeaf.sequence_number ?? ""}`.trim()}
          </div>
          <button
            type="button"
            onClick={() => onBeginReading(firstLeaf)}
            className="mt-4 rounded-md px-3 py-1.5"
            style={{
              background: "var(--color-accent)",
              color: "white",
              fontFamily: "var(--font-scriptle-sans)",
              fontSize: "12px",
            }}
          >
            Open first verse →
          </button>
        </div>
      ) : null}

      <div
        style={{
          fontFamily: "var(--font-scriptle-sans)",
          fontSize: "11px",
          letterSpacing: "0.06em",
          color: "var(--color-text-faint)",
          textTransform: "uppercase",
        }}
      >
        {verseCount} verse{verseCount === 1 ? "" : "s"}
      </div>
    </article>
  );
}
