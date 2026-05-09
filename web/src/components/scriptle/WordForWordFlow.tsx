type WordMeaning = {
  word: string;
  meaning: string;
};

type WordForWordFlowProps = {
  pairs: WordMeaning[];
};

export default function WordForWordFlow({ pairs }: WordForWordFlowProps) {
  if (pairs.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-2 leading-relaxed">
      {pairs.map((pair, idx) => (
        <span
          key={`${pair.word}-${idx}`}
          className="inline-flex items-baseline gap-1.5"
        >
          <span
            style={{
              fontFamily: "var(--font-scriptle-devanagari)",
              color: "var(--color-sanskrit)",
              fontSize: "15px",
            }}
          >
            {pair.word}
          </span>
          <span
            aria-hidden
            style={{
              color: "var(--color-text-faint)",
              fontSize: "12px",
            }}
          >
            ·
          </span>
          <span
            style={{
              fontFamily: "var(--font-scriptle-serif)",
              fontStyle: "italic",
              color: "var(--color-text-muted)",
              fontSize: "13px",
            }}
          >
            {pair.meaning}
          </span>
        </span>
      ))}
    </div>
  );
}
