"use client";

import { Download } from "lucide-react";
import LanguagePair from "./LanguagePair";
import FieldVisibilityPopover from "./FieldVisibilityPopover";
import { EyebrowLabel } from "./typography";
import type { ScriptleLanguageCode } from "@/lib/scriptle/languages";
import type { LanguagePairState } from "@/lib/useLanguagePair";
import type { FieldVisibility } from "@/lib/useFieldVisibility";

export type VerseViewMode = "verse" | "scroll";

type Crumb = {
  label: string;
  onClick?: () => void;
};

type VerseTopBarProps = {
  crumbs: Crumb[];
  mode: VerseViewMode;
  onModeChange: (mode: VerseViewMode) => void;
  langPair: LanguagePairState;
  fieldVis: FieldVisibility;
  availableTrgLanguages: ScriptleLanguageCode[];
  onExportPdf?: () => void;
};

export default function VerseTopBar({
  crumbs,
  mode,
  onModeChange,
  langPair,
  fieldVis,
  availableTrgLanguages,
  onExportPdf,
}: VerseTopBarProps) {
  return (
    <div
      className="flex flex-col gap-3 border-b py-3"
      style={{ borderColor: "var(--color-border-soft)" }}
    >
      <Breadcrumb crumbs={crumbs} />

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
          src={langPair.src}
          trg={langPair.trg}
          onSrcChange={langPair.setSrcLang}
          onTrgChange={langPair.setTrgLang}
          availableTrgLanguages={availableTrgLanguages}
        />
        <FieldVisibilityPopover
          fields={fieldVis.fields}
          hiddenCount={fieldVis.hiddenCount}
          toggle={fieldVis.toggle}
          reset={fieldVis.reset}
        />
        {onExportPdf ? (
          <button
            type="button"
            onClick={onExportPdf}
            aria-label="Export PDF"
            title="Export PDF"
            className="flex items-center gap-1.5 rounded-md border px-2 py-1 transition"
            style={{
              background: "white",
              borderColor: "var(--color-border)",
              color: "var(--color-text)",
              fontFamily: "var(--font-scriptle-sans)",
              fontSize: "12px",
            }}
          >
            <Download size={14} aria-hidden />
            <span className="hidden sm:inline">PDF</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex flex-wrap items-center gap-1.5"
    >
      {crumbs.map((crumb, idx) => {
        const isLast = idx === crumbs.length - 1;
        return (
          <span
            key={`${crumb.label}-${idx}`}
            className="flex items-center gap-1.5"
          >
            {idx > 0 ? (
              <EyebrowLabel tone="faint" tracking="tight">
                ›
              </EyebrowLabel>
            ) : null}
            {crumb.onClick && !isLast ? (
              <button type="button" onClick={crumb.onClick}>
                <EyebrowLabel tracking="tight" className="hover:underline">
                  {crumb.label}
                </EyebrowLabel>
              </button>
            ) : (
              <EyebrowLabel
                tone={isLast ? "muted" : "muted"}
                tracking="tight"
                className={isLast ? "" : ""}
              >
                {crumb.label}
              </EyebrowLabel>
            )}
          </span>
        );
      })}
    </nav>
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
