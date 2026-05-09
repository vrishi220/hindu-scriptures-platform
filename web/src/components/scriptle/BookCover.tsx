import type { CSSProperties } from "react";
import { Lock } from "lucide-react";
import {
  ALL_LANGUAGE_CODES,
  LANGUAGE_DOT_VAR,
  LANGUAGE_NAMES,
  type ScriptleLanguageCode,
} from "@/lib/scriptle/languages";
import { coverGradientForBook } from "@/lib/scriptle/covers";

type BookCoverProps = {
  bookCode: string | null;
  titleSanskrit?: string | null;
  titleEnglish: string;
  verseCount?: number | null;
  languages?: ScriptleLanguageCode[];
  coverImageUrl?: string | null;
  isAiGenerated?: boolean;
  isPrivate?: boolean;
};

export default function BookCover({
  bookCode,
  titleSanskrit,
  titleEnglish,
  verseCount,
  languages,
  coverImageUrl,
  isAiGenerated,
  isPrivate,
}: BookCoverProps) {
  const visibleLanguages = (languages ?? ["sa", "en"])
    .filter((code): code is ScriptleLanguageCode =>
      ALL_LANGUAGE_CODES.includes(code as ScriptleLanguageCode)
    )
    .slice(0, 5);

  const surfaceStyle: CSSProperties = coverImageUrl
    ? {
        backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.55)), url("${coverImageUrl}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : { backgroundImage: coverGradientForBook(bookCode) };

  return (
    <div
      className="relative h-[136px] w-[96px] overflow-hidden rounded-[6px] text-white transition-transform duration-150 ease-out group-hover:-translate-y-[3px]"
      style={{
        ...surfaceStyle,
        boxShadow: "2px 3px 8px rgba(0,0,0,0.18), -1px 0 0 rgba(0,0,0,0.08)",
      }}
    >
      <div
        aria-hidden
        className="absolute left-0 top-0 h-full w-[5px]"
        style={{ background: "rgba(0,0,0,0.32)" }}
      />

      {titleSanskrit ? (
        <div
          className="absolute left-3 right-2 top-2 line-clamp-2 leading-tight"
          style={{
            fontFamily: "var(--font-scriptle-devanagari)",
            color: "rgba(255,255,255,0.92)",
            fontSize: "11px",
          }}
        >
          {titleSanskrit}
        </div>
      ) : null}

      <div className="absolute bottom-7 left-2.5 right-2">
        <div
          className="line-clamp-2 leading-tight"
          style={{
            fontFamily: "var(--font-scriptle-serif)",
            fontSize: "11px",
            fontWeight: 500,
          }}
        >
          {titleEnglish}
        </div>
        {typeof verseCount === "number" && verseCount > 0 ? (
          <div
            className="mt-0.5"
            style={{
              fontFamily: "var(--font-scriptle-sans)",
              fontSize: "9px",
              color: "rgba(255,255,255,0.65)",
              letterSpacing: "0.04em",
            }}
          >
            {verseCount.toLocaleString()} verses
          </div>
        ) : null}
      </div>

      {visibleLanguages.length > 0 ? (
        <div className="absolute bottom-2 left-2.5 flex items-center gap-[3px]">
          {visibleLanguages.map((code) => (
            <span
              key={code}
              title={LANGUAGE_NAMES[code]}
              aria-label={LANGUAGE_NAMES[code]}
              className="block h-[5px] w-[5px] rounded-full"
              style={{
                background: LANGUAGE_DOT_VAR[code],
                boxShadow: "0 0 0 0.5px rgba(0,0,0,0.25)",
              }}
            />
          ))}
        </div>
      ) : null}

      {isAiGenerated ? (
        <div
          className="absolute right-1.5 top-1.5 rounded-sm px-1 py-[1px]"
          style={{
            fontSize: "8px",
            letterSpacing: "0.1em",
            background: "rgba(255,255,255,0.18)",
            color: "rgba(255,255,255,0.92)",
            backdropFilter: "blur(2px)",
          }}
        >
          AI
        </div>
      ) : null}

      {isPrivate ? (
        <div
          className="absolute bottom-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-sm"
          style={{
            background: "rgba(0,0,0,0.35)",
            color: "rgba(255,255,255,0.95)",
          }}
          title="Private"
          aria-label="Private"
        >
          <Lock size={10} strokeWidth={1.6} />
        </div>
      ) : null}
    </div>
  );
}
