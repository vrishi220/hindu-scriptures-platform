"use client";

import { useMemo, type ReactNode } from "react";
import {
  hasDevanagariLetters,
  normalizeTransliterationScript,
  transliterateFromDevanagari,
  transliterateFromIast,
  type TransliterationScriptOption,
} from "@/lib/indicScript";
import AuthoredCard from "./AuthoredCard";
import WordForWordFlow from "./WordForWordFlow";
import { EyebrowLabel, ProseBody, SectionHeading } from "./typography";
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
    basic?: { sanskrit?: string; transliteration?: string; text?: string };
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
  footer?: ReactNode;
};

const TRG_KEY: Record<ScriptleLanguageCode, string> = {
  sa: "sanskrit",
  en: "english",
  hi: "hindi",
  te: "telugu",
  ta: "tamil",
};

const SRC_TO_SCRIPT: Record<
  ScriptleLanguageCode,
  TransliterationScriptOption | null
> = {
  sa: null,
  en: null,
  hi: "devanagari",
  te: "telugu",
  ta: "tamil",
};

const SCRIPT_FONT_VAR: Record<ScriptleLanguageCode, string> = {
  sa: "var(--font-scriptle-devanagari)",
  en: "var(--font-scriptle-serif)",
  hi: "var(--font-scriptle-devanagari)",
  te: "var(--font-scriptle-telugu)",
  ta: "var(--font-scriptle-tamil)",
};

export default function VersePane({
  node,
  fields,
  src,
  trg,
  onResetFields,
  footer,
}: VersePaneProps) {
  const allHidden = Object.values(fields).every((v) => !v);

  const sanskrit = node.content_data?.basic?.sanskrit ?? "";
  const transliteration = node.content_data?.basic?.transliteration ?? "";
  const wordMeanings = node.content_data?.word_meanings ?? [];
  const translationVariants = node.content_data?.translation_variants ?? [];
  const commentaryVariants = node.content_data?.commentary_variants ?? [];
  const directTranslation =
    node.content_data?.translations?.[TRG_KEY[trg]]?.trim() || null;

  const targetScript = SRC_TO_SCRIPT[src];
  const showSourceScript =
    fields.srcScript && targetScript !== null && targetScript !== "devanagari";

  const sourceScriptText = useMemo(() => {
    if (!showSourceScript || !sanskrit || !targetScript) return "";
    const normalized = normalizeTransliterationScript(targetScript);
    return hasDevanagariLetters(sanskrit)
      ? transliterateFromDevanagari(sanskrit, normalized)
      : transliterateFromIast(sanskrit, normalized);
  }, [showSourceScript, sanskrit, targetScript]);

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

  const verseLabel = `${node.level_name}${
    node.sequence_number != null ? ` ${node.sequence_number}` : ""
  }`;

  return (
    <article className="flex flex-col gap-6 py-6">
      <EyebrowLabel tracking="wide">{verseLabel}</EyebrowLabel>

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
        <Section heading={`Source script · ${LANGUAGE_NAMES[src]}`}>
          <p
            style={{
              fontFamily: SCRIPT_FONT_VAR[src],
              color: "var(--color-sanskrit)",
              fontSize: "19px",
              lineHeight: 1.85,
              whiteSpace: "pre-line",
            }}
          >
            {sourceScriptText}
          </p>
        </Section>
      ) : null}

      {fields.w2w && wordMeanings.length > 0 ? (
        <Section heading="Word for word">
          <AuthoredCard
            authorName="HSP AI"
            isAi
            rightLabel={`${wordMeanings.length} words`}
          >
            <WordForWordFlow pairs={wordMeanings} />
          </AuthoredCard>
        </Section>
      ) : null}

      {fields.translation ? (
        <Section heading="Translation">
          {translationVariants.length > 0 ? (
            translationVariants.map((variant, idx) => (
              <AuthoredCard
                key={`${variant.slug ?? "v"}-${idx}`}
                authorName={variant.author_name || "Unknown"}
                rightLabel={
                  variant.language
                    ? (LANGUAGE_NAMES[variant.language as ScriptleLanguageCode] ??
                      variant.language)
                    : LANGUAGE_NAMES[trg]
                }
              >
                <ProseBody>{variant.text ?? ""}</ProseBody>
              </AuthoredCard>
            ))
          ) : directTranslation ? (
            <AuthoredCard
              authorName="HSP AI"
              isAi
              rightLabel={LANGUAGE_NAMES[trg]}
            >
              <ProseBody>{directTranslation}</ProseBody>
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
        </Section>
      ) : null}

      {fields.commentary && commentaryVariants.length > 0 ? (
        <Section heading="Commentary">
          {commentaryVariants.map((variant, idx) => (
            <AuthoredCard
              key={`${variant.slug ?? "c"}-${idx}`}
              authorName={variant.author_name || "Unknown"}
              rightLabel={
                variant.language
                  ? (LANGUAGE_NAMES[variant.language as ScriptleLanguageCode] ??
                    variant.language)
                  : undefined
              }
            >
              <ProseBody>{variant.text ?? ""}</ProseBody>
            </AuthoredCard>
          ))}
        </Section>
      ) : null}

      {footer}
    </article>
  );
}

function Section({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <SectionHeading>{heading}</SectionHeading>
      {children}
    </section>
  );
}
