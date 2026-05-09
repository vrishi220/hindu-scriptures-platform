"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import BookCover from "./BookCover";
import VerseTOC, { type TocNode } from "./VerseTOC";
import type { ScriptleLanguageCode } from "@/lib/scriptle/languages";

type VerseViewerLayoutProps = {
  bookCode: string | null;
  bookTitleEnglish: string;
  bookTitleSanskrit?: string | null;
  totalVerseCount?: number | null;
  languages?: ScriptleLanguageCode[];
  coverImageUrl?: string | null;
  toc: TocNode[];
  selectedNodeId: number | null;
  onSelectNode: (node: TocNode) => void;
  children: ReactNode;
};

export default function VerseViewerLayout({
  bookCode,
  bookTitleEnglish,
  bookTitleSanskrit,
  totalVerseCount,
  languages,
  coverImageUrl,
  toc,
  selectedNodeId,
  onSelectNode,
  children,
}: VerseViewerLayoutProps) {
  return (
    <div className="grid w-full gap-6 md:grid-cols-[212px_minmax(0,1fr)] md:items-start">
      <aside className="flex flex-col gap-4 md:sticky md:top-2 md:max-h-[calc(100vh-4rem)] md:overflow-y-auto md:pr-2">
        <Link
          href="/library"
          className="inline-flex items-center gap-1.5 self-start"
          style={{
            fontFamily: "var(--font-scriptle-sans)",
            fontSize: "11px",
            letterSpacing: "0.1em",
            color: "var(--color-text-muted)",
            textTransform: "uppercase",
          }}
        >
          <span aria-hidden>←</span>
          <span>Library</span>
        </Link>

        <div className="flex items-start gap-3">
          <div className="shrink-0 scale-[0.85] origin-top-left">
            <BookCover
              bookCode={bookCode}
              titleEnglish={bookTitleEnglish}
              titleSanskrit={bookTitleSanskrit}
              languages={languages}
              coverImageUrl={coverImageUrl}
            />
          </div>
          <div className="flex flex-col gap-1 pt-1">
            <p
              style={{
                fontFamily: "var(--font-scriptle-serif)",
                fontSize: "15px",
                color: "var(--color-text)",
                lineHeight: 1.25,
              }}
            >
              {bookTitleEnglish}
            </p>
            {typeof totalVerseCount === "number" && totalVerseCount > 0 ? (
              <p
                style={{
                  fontFamily: "var(--font-scriptle-sans)",
                  fontSize: "10px",
                  letterSpacing: "0.08em",
                  color: "var(--color-text-faint)",
                  textTransform: "uppercase",
                }}
              >
                {totalVerseCount.toLocaleString()} verses
              </p>
            ) : null}
          </div>
        </div>

        <nav
          aria-label="Contents"
          className="border-t pt-3"
          style={{ borderColor: "var(--color-border-soft)" }}
        >
          <VerseTOC
            nodes={toc}
            selectedNodeId={selectedNodeId}
            onSelect={onSelectNode}
          />
        </nav>
      </aside>

      <main className="min-w-0">{children}</main>
    </div>
  );
}
