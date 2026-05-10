"use client";

/**
 * Hero wordmark — large script-cycling "Scriptle" mark above the search input.
 *
 * Pure CSS animation: each <span> sits in the same inline-grid cell, all share
 * one `sr-hero-cycle` keyframe, and per-language `animation-delay` staggers
 * which one is visible. Container sizes to the longest variant. The .name
 * spans are aria-hidden; the parent's aria-label="Scriptle" is what screen
 * readers announce.
 *
 * Reduced-motion fallback (defined in globals.css) shows the English form
 * statically.
 */
export default function HeroWordmark() {
  return (
    <div className="sr-hero-mark" role="img" aria-label="Scriptle">
      <span className="s-en" lang="en" aria-hidden="true">
        Scriptle
      </span>
      <span className="s-hi" lang="hi" aria-hidden="true">
        स्क्रिप्टल
      </span>
      <span className="s-bn" lang="bn" aria-hidden="true">
        স্ক্রিপ্টল
      </span>
      <span className="s-gu" lang="gu" aria-hidden="true">
        સ્ક્રિપ્ટલ
      </span>
      <span className="s-ta" lang="ta" aria-hidden="true">
        ஸ்கிரிப்டில்
      </span>
      <span className="s-te" lang="te" aria-hidden="true">
        స్క్రిప్టిల్
      </span>
      <span className="s-ml" lang="ml" aria-hidden="true">
        സ്ക്രിപ്റ്റിൽ
      </span>
      <span className="s-kn" lang="kn" aria-hidden="true">
        ಸ್ಕ್ರಿಪ್ಟಿಲ್
      </span>
    </div>
  );
}
