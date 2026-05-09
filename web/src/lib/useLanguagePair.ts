"use client";

import { useEffect, useState } from "react";
import type { ScriptleLanguageCode } from "./scriptle/languages";

const STORAGE_PREFIX = "scriptle.langPair";

function readStored(
  bookCode: string,
  slot: "src" | "trg"
): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(`${STORAGE_PREFIX}.${bookCode}.${slot}`);
  } catch {
    return null;
  }
}

function persist(
  bookCode: string,
  slot: "src" | "trg",
  value: string
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `${STORAGE_PREFIX}.${bookCode}.${slot}`,
      value
    );
  } catch {
    // ignore
  }
}

const VALID_CODES: ReadonlyArray<ScriptleLanguageCode> = [
  "sa",
  "en",
  "hi",
  "te",
  "ta",
];

function asLanguageCode(value: string | null): ScriptleLanguageCode | null {
  if (!value) return null;
  return VALID_CODES.includes(value as ScriptleLanguageCode)
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
    let cancelled = false;
    void (async () => {
      const storedSrc = asLanguageCode(readStored(bookCode, "src"));
      const storedTrg = asLanguageCode(readStored(bookCode, "trg"));
      if (cancelled) return;
      if (storedSrc) setSrc(storedSrc);
      if (storedTrg) setTrg(storedTrg);
    })();
    return () => {
      cancelled = true;
    };
  }, [bookCode]);

  const setSrcLang = (lang: ScriptleLanguageCode) => {
    setSrc(lang);
    persist(bookCode, "src", lang);
  };
  const setTrgLang = (lang: ScriptleLanguageCode) => {
    setTrg(lang);
    persist(bookCode, "trg", lang);
  };

  return { src, trg, setSrcLang, setTrgLang };
}
