"use client";

import { useEffect, useMemo, useState } from "react";
import { getMe } from "./authClient";

export type FieldKey =
  | "original"
  | "iast"
  | "srcScript"
  | "w2w"
  | "translation"
  | "commentary";

const DEFAULT_FIELDS: Record<FieldKey, boolean> = {
  original: true,
  iast: true,
  srcScript: true,
  w2w: true,
  translation: true,
  commentary: true,
};

export const FIELD_LABELS: Record<FieldKey, string> = {
  original: "Original text",
  iast: "IAST",
  srcScript: "Source script",
  w2w: "Word for word",
  translation: "Translation",
  commentary: "Commentary",
};

export const FIELD_ORDER: FieldKey[] = [
  "original",
  "iast",
  "srcScript",
  "w2w",
  "translation",
  "commentary",
];

function readStored(
  key: string
): Partial<Record<FieldKey, boolean>> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<Record<FieldKey, boolean>>) : null;
  } catch {
    return null;
  }
}

function persist(key: string, value: Record<FieldKey, boolean>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage failures (private mode, quota, etc.)
  }
}

export function useFieldVisibility() {
  const [userId, setUserId] = useState<string | null>(null);
  const [fields, setFields] =
    useState<Record<FieldKey, boolean>>(DEFAULT_FIELDS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const me = await getMe().catch(() => null);
      if (cancelled) return;
      const id = me?.id != null ? String(me.id) : null;
      setUserId(id);
      const stored = readStored(`scriptle.fields.${id ?? "guest"}`);
      if (stored) {
        setFields({ ...DEFAULT_FIELDS, ...stored });
      }
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const storageKey = useMemo(
    () => `scriptle.fields.${userId ?? "guest"}`,
    [userId]
  );

  const toggle = (field: FieldKey) => {
    setFields((prev) => {
      const next = { ...prev, [field]: !prev[field] };
      persist(storageKey, next);
      return next;
    });
  };

  const reset = () => {
    setFields(DEFAULT_FIELDS);
    persist(storageKey, DEFAULT_FIELDS);
  };

  const hiddenCount = Object.values(fields).filter((v) => !v).length;

  return { fields, toggle, reset, hiddenCount, hydrated };
}
