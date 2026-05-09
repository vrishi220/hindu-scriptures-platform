"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { EyebrowLabel, MutedNote } from "./typography";
import {
  LANGUAGE_NAMES,
  type ScriptleLanguageCode,
} from "@/lib/scriptle/languages";

type ChapterScope = {
  nodeId: number;
  label: string;
};

type PdfExportModalProps = {
  open: boolean;
  bookId: number;
  bookName: string;
  chapterScope?: ChapterScope | null;
  availableTranslationLanguages: ScriptleLanguageCode[];
  defaultTranslation: ScriptleLanguageCode;
  onClose: () => void;
};

type PageSize = "A4" | "Letter";
type Orientation = "portrait" | "landscape";
type Scope = "book" | "chapter";

const TRG_LANG_LABEL: Record<ScriptleLanguageCode, string> = LANGUAGE_NAMES;

const PAGE_SIZES: PageSize[] = ["A4", "Letter"];
const ORIENTATIONS: Orientation[] = ["portrait", "landscape"];

function safeFilename(name: string, fallback: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

export default function PdfExportModal({
  open,
  bookId,
  bookName,
  chapterScope,
  availableTranslationLanguages,
  defaultTranslation,
  onClose,
}: PdfExportModalProps) {
  const [scope, setScope] = useState<Scope>(chapterScope ? "chapter" : "book");
  const [pageSize, setPageSize] = useState<PageSize>("A4");
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [includeCover, setIncludeCover] = useState(true);
  const [translation, setTranslation] = useState<ScriptleLanguageCode>(
    defaultTranslation
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setScope(chapterScope ? "chapter" : "book");
    setError(null);
    setSubmitting(false);
  }, [open, chapterScope]);

  if (!open) return null;

  const onSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const nodeId =
        scope === "chapter" && chapterScope ? chapterScope.nodeId : null;
      const response = await fetch(`/api/books/${bookId}/export/pdf`, {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/pdf",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          node_id: nodeId,
          selected_translation_languages: [TRG_LANG_LABEL[translation].toLowerCase()],
          pdf_settings: {
            page_size: pageSize,
            orientation,
            margin_mm: 16,
            include_cover_page: includeCover,
            page_break_mode: "none",
          },
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { detail?: string }
          | null;
        setError(payload?.detail ?? "PDF export failed.");
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const filename = `${safeFilename(bookName, `book-${bookId}`)}${
        scope === "chapter" && chapterScope ? "-chapter" : ""
      }.pdf`;

      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);

      onClose();
    } catch {
      setError("PDF export failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Export PDF"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <div
        data-scriptle="true"
        className="w-full max-w-[420px] overflow-hidden rounded-[12px] bg-white shadow-2xl"
        style={{ border: "0.5px solid var(--color-border)" }}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "0.5px solid var(--color-border-soft)" }}
        >
          <EyebrowLabel tracking="wide">Export PDF</EyebrowLabel>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            style={{ color: "var(--color-text-muted)" }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-5 px-5 py-5">
          {chapterScope ? (
            <RadioGroup
              label="Scope"
              value={scope}
              options={[
                { value: "book", label: `Entire book — ${bookName}` },
                { value: "chapter", label: `This chapter — ${chapterScope.label}` },
              ]}
              onChange={(v) => setScope(v as Scope)}
            />
          ) : (
            <div>
              <EyebrowLabel size="xs" tracking="wider">
                Scope
              </EyebrowLabel>
              <p
                className="mt-1.5"
                style={{
                  fontFamily: "var(--font-scriptle-serif)",
                  fontSize: "14px",
                  color: "var(--color-text)",
                }}
              >
                Entire book — {bookName}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <SegmentedControl
              label="Page size"
              value={pageSize}
              options={PAGE_SIZES}
              onChange={(v) => setPageSize(v)}
            />
            <SegmentedControl
              label="Orientation"
              value={orientation}
              options={ORIENTATIONS}
              onChange={(v) => setOrientation(v)}
            />
          </div>

          <SelectField
            label="Translation"
            value={translation}
            options={availableTranslationLanguages.filter((c) => c !== "sa")}
            onChange={(v) => setTranslation(v)}
          />

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeCover}
              onChange={(event) => setIncludeCover(event.target.checked)}
              className="h-4 w-4"
            />
            <span
              style={{
                fontFamily: "var(--font-scriptle-sans)",
                fontSize: "13px",
                color: "var(--color-text)",
              }}
            >
              Include cover page
            </span>
          </label>

          {error ? <MutedNote>{error}</MutedNote> : null}
        </div>

        <div
          className="flex items-center justify-end gap-2 px-5 py-3"
          style={{ borderTop: "0.5px solid var(--color-border-soft)" }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border px-3 py-1.5 transition disabled:opacity-50"
            style={{
              background: "white",
              borderColor: "var(--color-border)",
              color: "var(--color-text-muted)",
              fontFamily: "var(--font-scriptle-sans)",
              fontSize: "12px",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting}
            className="rounded-md px-3 py-1.5 transition disabled:opacity-50"
            style={{
              background: "var(--color-accent)",
              color: "white",
              fontFamily: "var(--font-scriptle-sans)",
              fontSize: "12px",
            }}
          >
            {submitting ? "Generating…" : "Download PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RadioGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <EyebrowLabel size="xs" tracking="wider">
        {label}
      </EyebrowLabel>
      <div className="flex flex-col gap-1.5">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className="flex items-center gap-2 cursor-pointer"
            >
              <input
                type="radio"
                checked={selected}
                onChange={() => onChange(option.value)}
                className="h-4 w-4"
              />
              <span
                style={{
                  fontFamily: "var(--font-scriptle-sans)",
                  fontSize: "13px",
                  color: "var(--color-text)",
                }}
              >
                {option.label}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <EyebrowLabel size="xs" tracking="wider">
        {label}
      </EyebrowLabel>
      <div
        className="flex rounded-md p-0.5"
        style={{
          background: "var(--color-surface)",
          border: "0.5px solid var(--color-border)",
        }}
      >
        {options.map((option) => {
          const active = option === value;
          return (
            <button
              key={option}
              type="button"
              onClick={() => onChange(option)}
              className="flex-1 rounded px-2 py-1 transition"
              style={{
                background: active ? "white" : "transparent",
                color: active ? "var(--color-text)" : "var(--color-text-muted)",
                fontFamily: "var(--font-scriptle-sans)",
                fontSize: "12px",
                fontWeight: active ? 600 : 500,
                textTransform: "capitalize",
                boxShadow: active ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
              }}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <EyebrowLabel size="xs" tracking="wider">
        {label}
      </EyebrowLabel>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="rounded-md border bg-white px-3 py-1.5 outline-none transition"
        style={{
          borderColor: "var(--color-border)",
          color: "var(--color-text)",
          fontFamily: "var(--font-scriptle-sans)",
          fontSize: "13px",
        }}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {LANGUAGE_NAMES[option as ScriptleLanguageCode] ?? option}
          </option>
        ))}
      </select>
    </div>
  );
}
