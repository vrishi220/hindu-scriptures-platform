export default function Wordmark() {
  return (
    <div
      className="flex items-baseline justify-center gap-2"
      style={{
        fontFamily: "var(--font-scriptle-sans)",
        color: "var(--color-text-muted)",
      }}
    >
      <span
        aria-hidden
        style={{
          fontFamily: "var(--font-scriptle-devanagari)",
          color: "var(--color-sanskrit)",
          fontSize: "20px",
          lineHeight: 1,
        }}
      >
        ॐ
      </span>
      <span
        style={{
          fontSize: "13px",
          letterSpacing: "0.32em",
          textTransform: "uppercase",
        }}
      >
        Scriptle
      </span>
    </div>
  );
}
