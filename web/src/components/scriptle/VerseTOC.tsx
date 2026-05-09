"use client";

import { useState } from "react";

export type TocNode = {
  id: number;
  level_name: string;
  sequence_number?: number | string | null;
  title_english?: string | null;
  title_sanskrit?: string | null;
  title_transliteration?: string | null;
  children?: TocNode[];
};

type VerseTOCProps = {
  nodes: TocNode[];
  selectedNodeId: number | null;
  ancestorSet: Set<number>;
  onSelect: (node: TocNode) => void;
};

export default function VerseTOC({
  nodes,
  selectedNodeId,
  ancestorSet,
  onSelect,
}: VerseTOCProps) {
  return (
    <ul className="flex flex-col gap-0.5">
      {nodes.map((node) => (
        <TocItem
          key={node.id}
          node={node}
          depth={0}
          selectedNodeId={selectedNodeId}
          ancestorSet={ancestorSet}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

const labelOf = (node: TocNode): string =>
  node.title_english ||
  node.title_sanskrit ||
  node.title_transliteration ||
  `${node.level_name} ${node.sequence_number ?? ""}`.trim();

function TocItem({
  node,
  depth,
  selectedNodeId,
  ancestorSet,
  onSelect,
}: {
  node: TocNode;
  depth: number;
  selectedNodeId: number | null;
  ancestorSet: Set<number>;
  onSelect: (node: TocNode) => void;
}) {
  const hasChildren = (node.children?.length ?? 0) > 0;
  const onPath = ancestorSet.has(node.id);
  const [expanded, setExpanded] = useState(onPath || depth === 0);

  const isSelected = selectedNodeId === node.id;

  return (
    <li className="flex flex-col gap-0.5">
      <div
        className="flex items-center gap-1"
        style={{ paddingLeft: `${depth * 10}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse" : "Expand"}
            className="flex h-5 w-5 items-center justify-center rounded transition"
            style={{ color: "var(--color-text-faint)" }}
          >
            <span
              aria-hidden
              style={{
                fontSize: "10px",
                display: "inline-block",
                transform: expanded ? "rotate(90deg)" : "none",
                transition: "transform 100ms ease",
              }}
            >
              ▸
            </span>
          </button>
        ) : (
          <span aria-hidden className="h-5 w-5" />
        )}
        <button
          type="button"
          onClick={() => onSelect(node)}
          className="flex-1 truncate rounded px-1.5 py-1 text-left transition"
          style={{
            background: isSelected ? "var(--color-surface)" : "transparent",
            color: isSelected
              ? "var(--color-accent)"
              : "var(--color-text-muted)",
            fontFamily: "var(--font-scriptle-sans)",
            fontSize: "12px",
            fontWeight: isSelected ? 600 : 400,
          }}
        >
          {labelOf(node)}
        </button>
      </div>
      {hasChildren && expanded ? (
        <ul className="flex flex-col gap-0.5">
          {node.children!.map((child) => (
            <TocItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedNodeId={selectedNodeId}
              ancestorSet={ancestorSet}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
