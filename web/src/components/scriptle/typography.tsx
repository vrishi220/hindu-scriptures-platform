// Shared typography primitives for the Scriptle redesign. Each replaces a
// recurring inline-style recipe (small uppercase muted label, section
// heading, muted note paragraph, prose body) so the visual system has one
// canonical definition per slot.

import type { ElementType, ReactNode } from "react";

type Tracking = "tight" | "normal" | "wide" | "wider" | "widest";

const TRACKING: Record<Tracking, string> = {
  tight: "0.06em",
  normal: "0.08em",
  wide: "0.12em",
  wider: "0.16em",
  widest: "0.18em",
};

type EyebrowLabelProps = {
  as?: ElementType;
  size?: "xs" | "sm";
  tone?: "muted" | "faint" | "accent";
  tracking?: Tracking;
  className?: string;
  children: ReactNode;
};

export function EyebrowLabel({
  as: Component = "span",
  size = "sm",
  tone = "muted",
  tracking = "wide",
  className,
  children,
}: EyebrowLabelProps) {
  const colorVar =
    tone === "faint"
      ? "var(--color-text-faint)"
      : tone === "accent"
        ? "var(--color-accent)"
        : "var(--color-text-muted)";
  return (
    <Component
      className={className}
      style={{
        fontFamily: "var(--font-scriptle-sans)",
        fontSize: size === "xs" ? "10px" : "11px",
        letterSpacing: TRACKING[tracking],
        textTransform: "uppercase",
        color: colorVar,
      }}
    >
      {children}
    </Component>
  );
}

export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <EyebrowLabel as="h3" size="xs" tracking="wider">
      {children}
    </EyebrowLabel>
  );
}

export function MutedNote({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={className}
      style={{
        fontFamily: "var(--font-scriptle-sans)",
        fontSize: "13px",
        color: "var(--color-text-muted)",
      }}
    >
      {children}
    </p>
  );
}

export function ProseBody({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        fontFamily: "var(--font-scriptle-serif)",
        fontSize: "14px",
        lineHeight: 1.85,
        color: "var(--color-text)",
        whiteSpace: "pre-line",
      }}
    >
      {children}
    </p>
  );
}
