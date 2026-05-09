"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

const PLACEHOLDER_QUERIES = [
  "dharma",
  "Bhagavad Gita 2.47",
  "what is the soul?",
  "अहं ब्रह्मास्मि",
  "how to overcome fear",
  "verses about devotion",
];

const ROTATE_INTERVAL_MS = 3500;

type SearchInputProps = {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
};

export default function SearchInput({
  value,
  onChange,
  onSubmit,
}: SearchInputProps) {
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [focused, setFocused] = useState(false);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (focused || value.length > 0) return;
    const handle = window.setInterval(() => {
      setFading(true);
      window.setTimeout(() => {
        setPlaceholderIdx((i) => (i + 1) % PLACEHOLDER_QUERIES.length);
        setFading(false);
      }, 200);
    }, ROTATE_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [focused, value]);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) onSubmit();
      }}
      className="relative mx-auto w-full max-w-[520px]"
    >
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={focused ? "" : PLACEHOLDER_QUERIES[placeholderIdx]}
        aria-label="Search the scriptures"
        autoComplete="off"
        spellCheck={false}
        className="h-11 w-full rounded-[12px] border bg-white pl-4 pr-11 outline-none transition focus:ring-2"
        style={{
          borderColor: "var(--color-border)",
          color: "var(--color-text)",
          fontFamily: "var(--font-scriptle-serif)",
          fontStyle: "italic",
          fontSize: "15px",
          opacity: fading ? 0.6 : 1,
          transition: "opacity 200ms ease, border-color 150ms ease",
        }}
      />
      {value.trim() ? (
        <button
          type="submit"
          aria-label="Ask the scriptures"
          className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full transition"
          style={{
            background: "var(--color-accent)",
            color: "white",
          }}
        >
          <ArrowRight size={16} strokeWidth={2} />
        </button>
      ) : null}
    </form>
  );
}
