"use client";

import { EyebrowLabel, ProseBody } from "./typography";
import type { TocNode } from "./VerseTOC";

type ChapterOverviewProps = {
  node: TocNode;
  summary?: string | null;
  verseCount: number;
  firstLeaf?: TocNode | null;
  onBeginReading?: (leaf: TocNode) => void;
};

const labelOf = (node: TocNode): string =>
  node.title_english ||
  node.title_sanskrit ||
  node.title_transliteration ||
  `${node.level_name} ${node.sequence_number ?? ""}`.trim();

export default function ChapterOverview({
  node,
  summary,
  verseCount,
  firstLeaf,
  onBeginReading,
}: ChapterOverviewProps) {
  return (
    <article className="flex flex-col gap-6 py-6">
      <header className="flex flex-col gap-1">
        <EyebrowLabel tracking="wide">
          {node.level_name}
          {node.sequence_number != null ? ` ${node.sequence_number}` : ""}
        </EyebrowLabel>
        <h2
          style={{
            fontFamily: "var(--font-scriptle-serif)",
            fontSize: "26px",
            color: "var(--color-text)",
            letterSpacing: "-0.01em",
          }}
        >
          {labelOf(node)}
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

      {summary ? <ProseBody>{summary}</ProseBody> : null}

      {firstLeaf && onBeginReading ? (
        <div
          className="rounded-[10px]"
          style={{
            border: "0.5px solid var(--color-border)",
            background: "var(--color-surface)",
            padding: "16px 18px",
          }}
        >
          <EyebrowLabel size="xs" tracking="widest">
            Begin reading
          </EyebrowLabel>
          <div
            className="mt-2"
            style={{
              fontFamily: "var(--font-scriptle-serif)",
              fontSize: "15px",
              color: "var(--color-text)",
            }}
          >
            {labelOf(firstLeaf)}
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

      <EyebrowLabel tone="faint" tracking="tight">
        {verseCount} verse{verseCount === 1 ? "" : "s"}
      </EyebrowLabel>
    </article>
  );
}
