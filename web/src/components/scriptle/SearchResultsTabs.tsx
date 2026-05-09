"use client";

import type { ReactNode } from "react";

export type TabKey = "keyword" | "semantic" | "ask";

const TAB_UNDERLINE: Record<TabKey, string> = {
  keyword: "var(--color-text-muted)",
  semantic: "#3B6D11",
  ask: "var(--color-accent)",
};

const TAB_LABEL: Record<TabKey, string> = {
  keyword: "Keyword",
  semantic: "Semantic",
  ask: "Ask",
};

type Tab = {
  key: TabKey;
  count?: number | null;
  loading?: boolean;
};

type SearchResultsTabsProps = {
  tabs: Tab[];
  active: TabKey;
  onChange: (next: TabKey) => void;
  children: ReactNode;
};

export default function SearchResultsTabs({
  tabs,
  active,
  onChange,
  children,
}: SearchResultsTabsProps) {
  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        className="flex items-center gap-6 border-b"
        style={{ borderColor: "var(--color-border-soft)" }}
      >
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              role="tab"
              type="button"
              aria-selected={isActive}
              onClick={() => onChange(tab.key)}
              className="flex items-center gap-1.5 pb-2 transition"
              style={{
                fontFamily: "var(--font-scriptle-sans)",
                fontSize: "13px",
                fontWeight: isActive ? 600 : 500,
                color: isActive ? "var(--color-text)" : "var(--color-text-muted)",
                borderBottom: `2px solid ${
                  isActive ? TAB_UNDERLINE[tab.key] : "transparent"
                }`,
                marginBottom: "-1px",
              }}
            >
              <span>{TAB_LABEL[tab.key]}</span>
              {tab.loading ? (
                <span
                  aria-hidden
                  className="block h-1.5 w-1.5 rounded-full animate-pulse"
                  style={{ background: TAB_UNDERLINE[tab.key] }}
                />
              ) : typeof tab.count === "number" ? (
                <span
                  style={{
                    fontSize: "11px",
                    color: "var(--color-text-faint)",
                    fontWeight: 400,
                  }}
                >
                  {tab.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div>{children}</div>
    </div>
  );
}
