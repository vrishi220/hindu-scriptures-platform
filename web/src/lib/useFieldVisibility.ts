"use client";

import { useEffect, useMemo, useState } from "react";
import { getMe } from "./authClient";
import { readJson, writeJson } from "./safeLocalStorage";

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

const keyFor = (userId: string | null) =>
  `scriptle.fields.${userId ?? "guest"}`;

export function useFieldVisibility() {
  const [userId, setUserId] = useState<string | null>(null);
  const [fields, setFields] =
    useState<Record<FieldKey, boolean>>(DEFAULT_FIELDS);

  useEffect(() => {
    let cancelled = false;
    getMe()
      .catch(() => null)
      .then((me) => {
        if (cancelled) return;
        const id = me?.id != null ? String(me.id) : null;
        setUserId(id);
        const stored = readJson<Partial<Record<FieldKey, boolean>>>(keyFor(id));
        if (stored) setFields({ ...DEFAULT_FIELDS, ...stored });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const storageKey = useMemo(() => keyFor(userId), [userId]);

  const toggle = (field: FieldKey) => {
    setFields((prev) => {
      const next = { ...prev, [field]: !prev[field] };
      writeJson(storageKey, next);
      return next;
    });
  };

  const reset = () => {
    setFields(DEFAULT_FIELDS);
    writeJson(storageKey, DEFAULT_FIELDS);
  };

  const hiddenCount = useMemo(
    () => Object.values(fields).filter((v) => !v).length,
    [fields]
  );
  const allHidden = hiddenCount === FIELD_ORDER.length;

  return { fields, toggle, reset, hiddenCount, allHidden };
}

export type FieldVisibility = ReturnType<typeof useFieldVisibility>;
