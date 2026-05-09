"use client";

import { useEffect, useRef, useState } from "react";
import {
  ALL_LANGUAGE_CODES,
  LANGUAGE_DOT_VAR,
  LANGUAGE_NAMES,
  type ScriptleLanguageCode,
} from "@/lib/scriptle/languages";
import { EyebrowLabel } from "./typography";

type LanguagePairProps = {
  src: ScriptleLanguageCode;
  trg: ScriptleLanguageCode;
  onSrcChange: (next: ScriptleLanguageCode) => void;
  onTrgChange: (next: ScriptleLanguageCode) => void;
  availableTrgLanguages: ScriptleLanguageCode[];
};

const SOURCE_OPTIONS: ScriptleLanguageCode[] = ["sa", "te", "hi", "ta"];

export default function LanguagePair({
  src,
  trg,
  onSrcChange,
  onTrgChange,
  availableTrgLanguages,
}: LanguagePairProps) {
  const [openSlot, setOpenSlot] = useState<"src" | "trg" | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target as Node)) {
        setOpenSlot(null);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={wrapperRef} className="flex items-center gap-1.5">
      <Slot
        label="Source"
        value={src}
        open={openSlot === "src"}
        onToggle={() => setOpenSlot(openSlot === "src" ? null : "src")}
        onSelect={(next) => {
          onSrcChange(next);
          setOpenSlot(null);
        }}
        options={SOURCE_OPTIONS.map((code) => ({ code, available: true }))}
      />
      <span
        aria-hidden
        style={{
          color: "var(--color-text-faint)",
          fontSize: "13px",
          fontFamily: "var(--font-scriptle-sans)",
        }}
      >
        →
      </span>
      <Slot
        label="Translation"
        value={trg}
        open={openSlot === "trg"}
        onToggle={() => setOpenSlot(openSlot === "trg" ? null : "trg")}
        onSelect={(next) => {
          onTrgChange(next);
          setOpenSlot(null);
        }}
        options={ALL_LANGUAGE_CODES.filter((c) => c !== "sa").map((code) => ({
          code,
          available: availableTrgLanguages.includes(code),
        }))}
      />
    </div>
  );
}

function Slot({
  label,
  value,
  open,
  onToggle,
  onSelect,
  options,
}: {
  label: string;
  value: ScriptleLanguageCode;
  open: boolean;
  onToggle: () => void;
  onSelect: (code: ScriptleLanguageCode) => void;
  options: { code: ScriptleLanguageCode; available: boolean }[];
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md border px-2 py-1 transition"
        style={{
          background: "white",
          borderColor: "var(--color-border)",
          fontFamily: "var(--font-scriptle-sans)",
          fontSize: "12px",
          color: "var(--color-text)",
        }}
      >
        <span
          aria-hidden
          className="block h-[6px] w-[6px] rounded-full"
          style={{ background: LANGUAGE_DOT_VAR[value] }}
        />
        <EyebrowLabel size="xs" tracking="tight">
          {label}:
        </EyebrowLabel>
        <span>{LANGUAGE_NAMES[value]}</span>
        <span
          aria-hidden
          style={{ color: "var(--color-text-faint)", fontSize: "9px" }}
        >
          ▾
        </span>
      </button>
      {open ? (
        <div
          role="listbox"
          className="absolute left-0 top-full z-30 mt-1 min-w-[180px] overflow-hidden rounded-md"
          style={{
            border: "0.5px solid var(--color-border)",
            background: "white",
            boxShadow: "0 6px 18px rgba(0,0,0,0.08)",
          }}
        >
          {options.map(({ code, available }) => {
            const active = code === value;
            return (
              <button
                key={code}
                type="button"
                onClick={() => available && onSelect(code)}
                role="option"
                aria-selected={active}
                disabled={!available}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition"
                style={{
                  background: active ? "var(--color-surface)" : "white",
                  color: available
                    ? "var(--color-text)"
                    : "var(--color-text-faint)",
                  fontFamily: "var(--font-scriptle-sans)",
                  fontSize: "12px",
                  cursor: available ? "pointer" : "not-allowed",
                }}
              >
                <span
                  aria-hidden
                  className="block h-[6px] w-[6px] rounded-full"
                  style={{ background: LANGUAGE_DOT_VAR[code] }}
                />
                <span className="flex-1">{LANGUAGE_NAMES[code]}</span>
                {!available ? (
                  <EyebrowLabel size="xs" tone="faint" tracking="tight">
                    not generated
                  </EyebrowLabel>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
