import type { ReactNode } from "react";
import { EyebrowLabel } from "./typography";

type AuthoredCardProps = {
  authorName: string;
  isAi?: boolean;
  rightLabel?: string;
  children: ReactNode;
};

export default function AuthoredCard({
  authorName,
  isAi,
  rightLabel,
  children,
}: AuthoredCardProps) {
  return (
    <div
      className="overflow-hidden rounded-[8px]"
      style={{
        border: "0.5px solid var(--color-border)",
        background: "white",
      }}
    >
      <div
        className="flex items-center justify-between gap-3 px-3 py-2"
        style={{
          borderBottom: "0.5px solid var(--color-border)",
          background: "var(--color-surface)",
        }}
      >
        <EyebrowLabel size="xs" tracking="wide">
          <span className="inline-flex items-center gap-1.5">
            <span>{authorName}</span>
            {isAi ? (
              <span
                style={{
                  background: "var(--color-accent)",
                  color: "white",
                  padding: "1px 5px",
                  borderRadius: "3px",
                  fontSize: "9px",
                  letterSpacing: "0.08em",
                }}
              >
                AI
              </span>
            ) : null}
          </span>
        </EyebrowLabel>
        {rightLabel ? (
          <EyebrowLabel size="xs" tracking="wide">
            {rightLabel}
          </EyebrowLabel>
        ) : null}
      </div>
      <div className="px-4 py-3.5">{children}</div>
    </div>
  );
}
