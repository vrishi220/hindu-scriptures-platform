import Link from "next/link";
import BookCover from "./BookCover";
import { EyebrowLabel } from "./typography";
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  categoryForBook,
  type ScriptleCategory,
} from "@/lib/scriptle/categories";
import type { LibraryBookView } from "@/lib/scriptle/bookAdapter";

export type LibraryBook = LibraryBookView;

type BookGridProps = {
  books: LibraryBookView[];
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

  const grouped = new Map<ScriptleCategory, LibraryBookView[]>();
  for (const category of CATEGORY_ORDER) grouped.set(category, []);
  for (const book of books) {
    grouped.get(categoryForBook(book.bookCode))!.push(book);
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
  books: LibraryBookView[];
}) {
  if (books.length === 0) {
    return (
      <p
        className="text-sm"
        style={{
          color: "var(--color-text-muted)",
          fontFamily: "var(--font-scriptle-sans)",
        }}
      >
        No scriptures in this category yet.
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      {label ? (
        <div className="flex items-center gap-3">
          <EyebrowLabel tracking="widest">{label}</EyebrowLabel>
          <span
            aria-hidden
            className="flex-1"
            style={{ borderTop: "0.5px solid var(--color-border)" }}
          />
          <EyebrowLabel tone="faint">→</EyebrowLabel>
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
