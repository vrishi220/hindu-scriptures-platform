import type { Metadata } from "next";
import { Playfair_Display, Space_Grotesk, Noto_Serif, Noto_Serif_Devanagari } from "next/font/google";
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
      <body className={`${displayFont.variable} ${sansFont.variable} ${devanagariFont.variable} ${scriptureLatinFont.variable} antialiased min-h-screen flex flex-col`}>
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
