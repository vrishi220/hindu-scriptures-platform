"use client";

import {
  hasDevanagariLetters,
  normalizeTransliterationScript,
  transliterateFromDevanagari,
  transliterateFromIast,
  type TransliterationScriptOption,
} from "@/lib/indicScript";
import AuthoredCard from "./AuthoredCard";
import WordForWordFlow from "./WordForWordFlow";
import {
  LANGUAGE_NAMES,
  type ScriptleLanguageCode,
} from "@/lib/scriptle/languages";
import type { FieldKey } from "@/lib/useFieldVisibility";

export type VerseNode = {
  id: number;
  level_name: string;
  sequence_number?: number | string | null;
  title_english?: string | null;
  title_sanskrit?: string | null;
  content_data?: {
    basic?: {
      sanskrit?: string;
      transliteration?: string;
      text?: string;
    };
    translations?: Record<string, string>;
    translation_variants?: Array<{
      slug?: string;
      author_name?: string;
      text?: string;
      language?: string;
    }>;
    commentary_variants?: Array<{
      slug?: string;
      author_name?: string;
      text?: string;
      language?: string;
    }>;
    word_meanings?: Array<{ word: string; meaning: string }>;
  } | null;
};

type VersePaneProps = {
  node: VerseNode;
  fields: Record<FieldKey, boolean>;
  src: ScriptleLanguageCode;
  trg: ScriptleLanguageCode;
  onResetFields: () => void;
  footer?: React.ReactNode;
};

const TRG_KEY: Record<ScriptleLanguageCode, string> = {
  sa: "sanskrit",
  en: "english",
  hi: "hindi",
  te: "telugu",
  ta: "tamil",
};

const SRC_TO_TARGET_SCRIPT: Record<
  ScriptleLanguageCode,
  TransliterationScriptOption | null
> = {
  sa: null,
  en: null,
  hi: "devanagari",
  te: "telugu",
  ta: "tamil",
};

function pickTranslation(
  node: VerseNode,
  trg: ScriptleLanguageCode
): string | null {
  const key = TRG_KEY[trg];
  const direct = node.content_data?.translations?.[key];
  return direct?.trim() ? direct : null;
}

function scriptFontVar(code: ScriptleLanguageCode): string {
  switch (code) {
    case "te":
      return "var(--font-scriptle-telugu)";
    case "ta":
      return "var(--font-scriptle-tamil)";
    default:
      return "var(--font-scriptle-devanagari)";
  }
}

export default function VersePane({
  node,
  fields,
  src,
  trg,
  onResetFields,
  footer,
}: VersePaneProps) {
  const allHidden = Object.values(fields).every((v) => !v);

  if (allHidden) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <p
          style={{
            fontFamily: "var(--font-scriptle-sans)",
            color: "var(--color-text-muted)",
            fontSize: "13px",
          }}
        >
          All fields are hidden.
        </p>
        <button
          type="button"
          onClick={onResetFields}
          className="rounded-md px-3 py-1.5"
          style={{
            background: "var(--color-accent)",
            color: "white",
            fontFamily: "var(--font-scriptle-sans)",
            fontSize: "12px",
          }}
        >
          Show all fields
        </button>
      </div>
    );
  }

  const sanskrit = node.content_data?.basic?.sanskrit ?? "";
  const transliteration = node.content_data?.basic?.transliteration ?? "";
  const wordMeanings = node.content_data?.word_meanings ?? [];
  const translationVariants =
    node.content_data?.translation_variants ?? [];
  const commentaryVariants =
    node.content_data?.commentary_variants ?? [];
  const directTranslation = pickTranslation(node, trg);

  const targetScript = SRC_TO_TARGET_SCRIPT[src];
  const showSourceScript =
    fields.srcScript && targetScript !== null && targetScript !== "devanagari";
  const sourceScriptText = (() => {
    if (!showSourceScript || !sanskrit || !targetScript) return "";
    const normalized = normalizeTransliterationScript(targetScript);
    return hasDevanagariLetters(sanskrit)
      ? transliterateFromDevanagari(sanskrit, normalized)
      : transliterateFromIast(sanskrit, normalized);
  })();

  const verseLabel = `${node.level_name}${
    node.sequence_number != null ? ` ${node.sequence_number}` : ""
  }`;

  return (
    <article className="flex flex-col gap-6 py-6">
      <header
        style={{
          fontFamily: "var(--font-scriptle-sans)",
          fontSize: "11px",
          letterSpacing: "0.12em",
          color: "var(--color-text-muted)",
          textTransform: "uppercase",
        }}
      >
        {verseLabel}
      </header>

      {fields.original && sanskrit ? (
        <p
          style={{
            fontFamily: "var(--font-scriptle-devanagari)",
            color: "var(--color-sanskrit)",
            fontSize: "21px",
            lineHeight: 1.9,
            whiteSpace: "pre-line",
          }}
        >
          {sanskrit}
        </p>
      ) : null}

      {fields.iast && transliteration ? (
        <p
          style={{
            fontFamily: "var(--font-scriptle-serif)",
            fontStyle: "italic",
            color: "var(--color-text-muted)",
            fontSize: "13px",
            lineHeight: 1.7,
            whiteSpace: "pre-line",
          }}
        >
          {transliteration}
        </p>
      ) : null}

      {showSourceScript && sourceScriptText ? (
        <section className="flex flex-col gap-2">
          <h3
            style={{
              fontFamily: "var(--font-scriptle-sans)",
              fontSize: "10px",
              letterSpacing: "0.16em",
              color: "var(--color-text-muted)",
              textTransform: "uppercase",
            }}
          >
            Source script · {LANGUAGE_NAMES[src]}
          </h3>
          <p
            style={{
              fontFamily: scriptFontVar(src),
              color: "var(--color-sanskrit)",
              fontSize: "19px",
              lineHeight: 1.85,
              whiteSpace: "pre-line",
            }}
          >
            {sourceScriptText}
          </p>
        </section>
      ) : null}

      {fields.w2w && wordMeanings.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3
            style={{
              fontFamily: "var(--font-scriptle-sans)",
              fontSize: "10px",
              letterSpacing: "0.16em",
              color: "var(--color-text-muted)",
              textTransform: "uppercase",
            }}
          >
            Word for word
          </h3>
          <AuthoredCard
            authorName="HSP AI"
            isAi
            rightLabel={`${wordMeanings.length} words`}
          >
            <WordForWordFlow pairs={wordMeanings} />
          </AuthoredCard>
        </section>
      ) : null}

      {fields.translation ? (
        <section className="flex flex-col gap-2">
          <h3
            style={{
              fontFamily: "var(--font-scriptle-sans)",
              fontSize: "10px",
              letterSpacing: "0.16em",
              color: "var(--color-text-muted)",
              textTransform: "uppercase",
            }}
          >
            Translation
          </h3>
          {translationVariants.length > 0 ? (
            translationVariants.map((variant, idx) => (
              <AuthoredCard
                key={`${variant.slug ?? "v"}-${idx}`}
                authorName={variant.author_name || "Unknown"}
                rightLabel={
                  variant.language
                    ? LANGUAGE_NAMES[
                        variant.language as ScriptleLanguageCode
                      ] ?? variant.language
                    : LANGUAGE_NAMES[trg]
                }
              >
                <ProsePara text={variant.text ?? ""} />
              </AuthoredCard>
            ))
          ) : directTranslation ? (
            <AuthoredCard
              authorName="HSP AI"
              isAi
              rightLabel={LANGUAGE_NAMES[trg]}
            >
              <ProsePara text={directTranslation} />
            </AuthoredCard>
          ) : (
            <p
              style={{
                fontFamily: "var(--font-scriptle-sans)",
                fontSize: "13px",
                color: "var(--color-text-faint)",
              }}
            >
              No translation available in {LANGUAGE_NAMES[trg]}.
            </p>
          )}
        </section>
      ) : null}

      {fields.commentary && commentaryVariants.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3
            style={{
              fontFamily: "var(--font-scriptle-sans)",
              fontSize: "10px",
              letterSpacing: "0.16em",
              color: "var(--color-text-muted)",
              textTransform: "uppercase",
            }}
          >
            Commentary
          </h3>
          {commentaryVariants.map((variant, idx) => (
            <AuthoredCard
              key={`${variant.slug ?? "c"}-${idx}`}
              authorName={variant.author_name || "Unknown"}
              rightLabel={
                variant.language
                  ? LANGUAGE_NAMES[
                      variant.language as ScriptleLanguageCode
                    ] ?? variant.language
                  : undefined
              }
            >
              <ProsePara text={variant.text ?? ""} />
            </AuthoredCard>
          ))}
        </section>
      ) : null}

      {footer}
    </article>
  );
}

function ProsePara({ text }: { text: string }) {
  return (
    <p
      style={{
        fontFamily: "var(--font-scriptle-serif)",
        fontSize: "14px",
        lineHeight: 1.85,
        color: "var(--color-text)",
        whiteSpace: "pre-line",
      }}
    >
      {text}
    </p>
  );
}
