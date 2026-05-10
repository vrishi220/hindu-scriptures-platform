import type { Metadata } from "next";
import {
  Inter,
  Lora,
  Noto_Sans_Bengali,
  Noto_Sans_Devanagari,
  Noto_Sans_Gujarati,
  Noto_Sans_Kannada,
  Noto_Sans_Malayalam,
  Noto_Sans_Tamil,
  Noto_Sans_Telugu,
  Noto_Serif,
  Noto_Serif_Bengali,
  Noto_Serif_Devanagari,
  Noto_Serif_Gujarati,
  Noto_Serif_Kannada,
  Noto_Serif_Malayalam,
  Noto_Serif_Tamil,
  Noto_Serif_Telugu,
  Playfair_Display,
  Space_Grotesk,
} from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import SessionKeepalive from "@/components/SessionKeepalive";
import GoogleAnalytics from "@/components/GoogleAnalytics";

const displayFont = Playfair_Display({
  variable: "--font-display",
  subsets: ["latin", "latin-ext"],
});

const sansFont = Space_Grotesk({
  variable: "--font-sans",
  subsets: ["latin", "latin-ext"],
});

const devanagariFont = Noto_Serif_Devanagari({
  variable: "--font-devanagari",
  subsets: ["devanagari"],
  weight: ["400", "600"],
});

const scriptureLatinFont = Noto_Serif({
  variable: "--font-scripture-latin",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "600"],
});

// Scriptle redesign fonts — loaded for use by /library and /read/* routes.
// Existing pages continue to use Space_Grotesk / Playfair_Display above.
const interFont = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext"],
});

const loraFont = Lora({
  variable: "--font-lora",
  subsets: ["latin", "latin-ext"],
});

const teluguFont = Noto_Serif_Telugu({
  variable: "--font-telugu",
  subsets: ["telugu"],
  weight: ["400", "600"],
});

const tamilFont = Noto_Serif_Tamil({
  variable: "--font-tamil",
  subsets: ["tamil"],
  weight: ["400", "600"],
});

// Additional Indic serifs for verse rendering when those scripts are imported.
const bengaliFont = Noto_Serif_Bengali({
  variable: "--font-bengali",
  subsets: ["bengali"],
  weight: ["400", "500"],
});
const gujaratiFont = Noto_Serif_Gujarati({
  variable: "--font-gujarati",
  subsets: ["gujarati"],
  weight: ["400", "500"],
});
const malayalamFont = Noto_Serif_Malayalam({
  variable: "--font-malayalam",
  subsets: ["malayalam"],
  weight: ["400", "500"],
});
const kannadaFont = Noto_Serif_Kannada({
  variable: "--font-kannada",
  subsets: ["kannada"],
  weight: ["400", "500"],
});

// Sans-serif Indic variants — used by the hero wordmark's 8-script cycle and
// the language-pair dropdowns. Weight 500 only (the only weight we render).
const devanagariSansFont = Noto_Sans_Devanagari({
  variable: "--font-devanagari-sans-loaded",
  subsets: ["devanagari"],
  weight: ["500"],
});
const teluguSansFont = Noto_Sans_Telugu({
  variable: "--font-telugu-sans-loaded",
  subsets: ["telugu"],
  weight: ["500"],
});
const tamilSansFont = Noto_Sans_Tamil({
  variable: "--font-tamil-sans-loaded",
  subsets: ["tamil"],
  weight: ["500"],
});
const bengaliSansFont = Noto_Sans_Bengali({
  variable: "--font-bengali-sans-loaded",
  subsets: ["bengali"],
  weight: ["500"],
});
const gujaratiSansFont = Noto_Sans_Gujarati({
  variable: "--font-gujarati-sans-loaded",
  subsets: ["gujarati"],
  weight: ["500"],
});
const malayalamSansFont = Noto_Sans_Malayalam({
  variable: "--font-malayalam-sans-loaded",
  subsets: ["malayalam"],
  weight: ["500"],
});
const kannadaSansFont = Noto_Sans_Kannada({
  variable: "--font-kannada-sans-loaded",
  subsets: ["kannada"],
  weight: ["500"],
});

export const metadata: Metadata = {
  title: "Hindu Scriptures Platform",
  description:
    "A living library of Hindu scriptures with deep search, translations, and community contributions.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const gaMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  return (
    <html lang="en">
      <body className={`${displayFont.variable} ${sansFont.variable} ${devanagariFont.variable} ${scriptureLatinFont.variable} ${interFont.variable} ${loraFont.variable} ${teluguFont.variable} ${tamilFont.variable} ${bengaliFont.variable} ${gujaratiFont.variable} ${malayalamFont.variable} ${kannadaFont.variable} ${devanagariSansFont.variable} ${teluguSansFont.variable} ${tamilSansFont.variable} ${bengaliSansFont.variable} ${gujaratiSansFont.variable} ${malayalamSansFont.variable} ${kannadaSansFont.variable} antialiased min-h-screen flex flex-col`}>
        {gaMeasurementId ? (
          <Suspense fallback={null}>
            <GoogleAnalytics measurementId={gaMeasurementId} />
          </Suspense>
        ) : null}
        <SessionKeepalive />
        <NavBar />
        <div className="flex-1 min-h-0">
          {children}
        </div>
        <Footer />
      </body>
    </html>
  );
}
