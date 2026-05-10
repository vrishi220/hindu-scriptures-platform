"use client";

import { useEffect, useState } from "react";
import {
  ALL_LANGUAGE_CODES,
  type ScriptleLanguageCode,
} from "./scriptle/languages";
import { readString, writeString } from "./safeLocalStorage";

const STORAGE_PREFIX = "scriptle.langPair";

const keyFor = (bookCode: string, slot: "src" | "trg") =>
  `${STORAGE_PREFIX}.${bookCode}.${slot}`;

function parseStored(value: string | null): ScriptleLanguageCode | null {
  if (!value) return null;
  return ALL_LANGUAGE_CODES.includes(value as ScriptleLanguageCode)
    ? (value as ScriptleLanguageCode)
    : null;
}

export function useLanguagePair(
  bookCode: string,
  primaryLanguage: ScriptleLanguageCode = "sa",
  defaultTranslation: ScriptleLanguageCode = "en"
) {
  const [src, setSrc] = useState<ScriptleLanguageCode>(primaryLanguage);
  const [trg, setTrg] = useState<ScriptleLanguageCode>(defaultTranslation);

  useEffect(() => {
    // Defer the localStorage read into a microtask so setState happens after
    // the effect body returns — required by react-hooks/set-state-in-effect.
    queueMicrotask(() => {
      const storedSrc = parseStored(readString(keyFor(bookCode, "src")));
      const storedTrg = parseStored(readString(keyFor(bookCode, "trg")));
      if (storedSrc) setSrc(storedSrc);
      if (storedTrg) setTrg(storedTrg);
    });
  }, [bookCode]);

  const setSrcLang = (lang: ScriptleLanguageCode) => {
    setSrc(lang);
    writeString(keyFor(bookCode, "src"), lang);
  };

  const setTrgLang = (lang: ScriptleLanguageCode) => {
    setTrg(lang);
    writeString(keyFor(bookCode, "trg"), lang);
  };

  return { src, trg, setSrcLang, setTrgLang };
}

export type LanguagePairState = ReturnType<typeof useLanguagePair>;
