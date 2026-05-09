"use client";

import { useEffect, useRef, useState } from "react";
import { Eye } from "lucide-react";
import {
  FIELD_LABELS,
  FIELD_ORDER,
  type FieldKey,
} from "@/lib/useFieldVisibility";
import { EyebrowLabel } from "./typography";

type FieldVisibilityPopoverProps = {
  fields: Record<FieldKey, boolean>;
  hiddenCount: number;
  toggle: (field: FieldKey) => void;
  reset: () => void;
};

export default function FieldVisibilityPopover({
  fields,
  hiddenCount,
  toggle,
  reset,
}: FieldVisibilityPopoverProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
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
        <Eye size={14} aria-hidden />
        <span>Fields</span>
        {hiddenCount > 0 ? (
          <span
            className="rounded-full px-1.5"
            style={{
              background: "var(--color-accent)",
              color: "white",
              fontSize: "10px",
              fontWeight: 500,
            }}
          >
            {hiddenCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          className="absolute right-0 top-full z-30 mt-1 w-[230px] overflow-hidden rounded-md"
          style={{
            border: "0.5px solid var(--color-border)",
            background: "white",
            boxShadow: "0 6px 18px rgba(0,0,0,0.08)",
          }}
        >
          <div
            className="flex items-center justify-between px-3 py-2"
            style={{ borderBottom: "0.5px solid var(--color-border)" }}
          >
            <EyebrowLabel tracking="normal">Show / hide</EyebrowLabel>
            <button type="button" onClick={reset}>
              <EyebrowLabel tone="accent" tracking="normal">
                Show all
              </EyebrowLabel>
            </button>
          </div>
          <div className="flex flex-col">
            {FIELD_ORDER.map((field) => (
              <label
                key={field}
                className="flex items-center justify-between gap-3 px-3 py-2 transition hover:bg-[color:var(--color-surface)]"
                style={{
                  fontFamily: "var(--font-scriptle-sans)",
                  fontSize: "13px",
                  color: "var(--color-text)",
                  cursor: "pointer",
                }}
              >
                <span>{FIELD_LABELS[field]}</span>
                <input
                  type="checkbox"
                  checked={fields[field]}
                  onChange={() => toggle(field)}
                  className="h-3.5 w-3.5"
                />
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
