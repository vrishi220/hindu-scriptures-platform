import type { Metadata } from "next";
import { Playfair_Display, Space_Grotesk } from "next/font/google";
import "./globals.css";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import SessionKeepalive from "@/components/SessionKeepalive";

const displayFont = Playfair_Display({
  variable: "--font-display",
  subsets: ["latin"],
});

const sansFont = Space_Grotesk({
  variable: "--font-sans",
  subsets: ["latin"],
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
  return (
    <html lang="en" className="h-full">
      <body className={`${displayFont.variable} ${sansFont.variable} antialiased h-full min-h-screen flex flex-col`}>
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
