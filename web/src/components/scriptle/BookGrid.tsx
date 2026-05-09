import Link from "next/link";
import BookCover from "./BookCover";
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  categoryForBook,
  type ScriptleCategory,
} from "@/lib/scriptle/categories";
import type { ScriptleLanguageCode } from "@/lib/scriptle/languages";

export type LibraryBook = {
  id: number;
  bookCode: string | null;
  titleEnglish: string;
  titleSanskrit: string | null;
  verseCount: number | null;
  languages: ScriptleLanguageCode[];
  coverImageUrl: string | null;
  isAiGenerated: boolean;
  isPrivate: boolean;
};

type BookGridProps = {
  books: LibraryBook[];
  activeCategory: ScriptleCategory | null;
};

export default function BookGrid({ books, activeCategory }: BookGridProps) {
  if (activeCategory) {
    return (
      <Shelf
        label={null}
        books={books.filter(
          (book) => categoryForBook(book.bookCode) === activeCategory
        )}
      />
    );
  }

  const grouped = new Map<ScriptleCategory, LibraryBook[]>();
  for (const category of CATEGORY_ORDER) {
    grouped.set(category, []);
  }
  for (const book of books) {
    const category = categoryForBook(book.bookCode);
    grouped.get(category)!.push(book);
  }

  return (
    <div className="flex flex-col gap-9">
      {CATEGORY_ORDER.map((category) => {
        const list = grouped.get(category) ?? [];
        if (list.length === 0) return null;
        return (
          <Shelf
            key={category}
            label={CATEGORY_LABEL[category]}
            books={list}
          />
        );
      })}
    </div>
  );
}

function Shelf({
  label,
  books,
}: {
  label: string | null;
  books: LibraryBook[];
}) {
  if (books.length === 0) {
    return (
      <div
        className="text-sm"
        style={{
          color: "var(--color-text-muted)",
          fontFamily: "var(--font-scriptle-sans)",
        }}
      >
        No scriptures in this category yet.
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      {label ? (
        <div className="flex items-center gap-3">
          <span
            style={{
              fontFamily: "var(--font-scriptle-sans)",
              fontSize: "11px",
              letterSpacing: "0.18em",
              color: "var(--color-text-muted)",
              textTransform: "uppercase",
            }}
          >
            {label}
          </span>
          <span
            aria-hidden
            className="flex-1"
            style={{ borderTop: "0.5px solid var(--color-border)" }}
          />
          <span
            aria-hidden
            style={{
              fontFamily: "var(--font-scriptle-sans)",
              fontSize: "11px",
              color: "var(--color-text-faint)",
            }}
          >
            →
          </span>
        </div>
      ) : null}

      <div
        className="grid gap-x-4 gap-y-6"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))" }}
      >
        {books.map((book) => (
          <Link
            key={book.id}
            href={
              book.bookCode
                ? `/read/${encodeURIComponent(book.bookCode)}`
                : `/scriptures?book=${book.id}`
            }
            aria-label={book.titleEnglish}
            className="group flex flex-col items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[color:var(--color-accent)]"
          >
            <BookCover
              bookCode={book.bookCode}
              titleSanskrit={book.titleSanskrit}
              titleEnglish={book.titleEnglish}
              verseCount={book.verseCount}
              languages={book.languages}
              coverImageUrl={book.coverImageUrl}
              isAiGenerated={book.isAiGenerated}
              isPrivate={book.isPrivate}
            />
            <span
              className="line-clamp-2 max-w-[100px] text-center"
              style={{
                fontFamily: "var(--font-scriptle-sans)",
                fontSize: "11px",
                color: "var(--color-text-muted)",
                lineHeight: 1.3,
              }}
            >
              {book.titleEnglish}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
