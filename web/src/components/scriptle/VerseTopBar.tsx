"use client";

import LanguagePair from "./LanguagePair";
import FieldVisibilityPopover from "./FieldVisibilityPopover";
import type { ScriptleLanguageCode } from "@/lib/scriptle/languages";
import type { FieldKey } from "@/lib/useFieldVisibility";

export type VerseViewMode = "verse" | "scroll";

type Crumb = {
  label: string;
  onClick?: () => void;
};

type VerseTopBarProps = {
  crumbs: Crumb[];
  mode: VerseViewMode;
  onModeChange: (mode: VerseViewMode) => void;
  src: ScriptleLanguageCode;
  trg: ScriptleLanguageCode;
  onSrcChange: (next: ScriptleLanguageCode) => void;
  onTrgChange: (next: ScriptleLanguageCode) => void;
  availableTrgLanguages: ScriptleLanguageCode[];
  fields: Record<FieldKey, boolean>;
  hiddenCount: number;
  toggleField: (field: FieldKey) => void;
  resetFields: () => void;
};

export default function VerseTopBar({
  crumbs,
  mode,
  onModeChange,
  src,
  trg,
  onSrcChange,
  onTrgChange,
  availableTrgLanguages,
  fields,
  hiddenCount,
  toggleField,
  resetFields,
}: VerseTopBarProps) {
  return (
    <div
      className="flex flex-col gap-3 border-b py-3"
      style={{ borderColor: "var(--color-border-soft)" }}
    >
      <nav
        aria-label="Breadcrumb"
        className="flex flex-wrap items-center gap-1.5"
        style={{
          fontFamily: "var(--font-scriptle-sans)",
          fontSize: "11px",
          letterSpacing: "0.06em",
          color: "var(--color-text-muted)",
          textTransform: "uppercase",
        }}
      >
        {crumbs.map((crumb, idx) => {
          const isLast = idx === crumbs.length - 1;
          return (
            <span
              key={`${crumb.label}-${idx}`}
              className="flex items-center gap-1.5"
            >
              {idx > 0 ? (
                <span aria-hidden style={{ color: "var(--color-text-faint)" }}>
                  ›
                </span>
              ) : null}
              {crumb.onClick && !isLast ? (
                <button
                  type="button"
                  onClick={crumb.onClick}
                  className="hover:underline"
                >
                  {crumb.label}
                </button>
              ) : (
                <span style={isLast ? { color: "var(--color-text)" } : undefined}>
                  {crumb.label}
                </span>
              )}
            </span>
          );
        })}
      </nav>

      <div className="flex flex-wrap items-center gap-2">
        <ModeTab
          label="Verse"
          active={mode === "verse"}
          onClick={() => onModeChange("verse")}
        />
        <ModeTab
          label="Scroll"
          active={mode === "scroll"}
          onClick={() => onModeChange("scroll")}
        />
        <span aria-hidden className="flex-1" />
        <LanguagePair
          src={src}
          trg={trg}
          onSrcChange={onSrcChange}
          onTrgChange={onTrgChange}
          availableTrgLanguages={availableTrgLanguages}
        />
        <FieldVisibilityPopover
          fields={fields}
          hiddenCount={hiddenCount}
          toggle={toggleField}
          reset={resetFields}
        />
      </div>
    </div>
  );
}

function ModeTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="rounded-md border px-2.5 py-1 transition"
      style={{
        background: active ? "var(--color-surface)" : "white",
        borderColor: active ? "var(--color-accent)" : "var(--color-border)",
        color: active ? "var(--color-accent)" : "var(--color-text-muted)",
        fontFamily: "var(--font-scriptle-sans)",
        fontSize: "12px",
        fontWeight: active ? 600 : 500,
      }}
    >
      {label}
    </button>
  );
}
