import Link from "next/link";

export default function Footer() {
  return (
    <footer className="flex flex-col items-center justify-between gap-2 border-t border-black/10 py-3 text-xs text-zinc-500 sm:flex-row px-6 mt-0 bg-white">
      <p>Hindu Scriptures Platform · Open knowledge, shared carefully.</p>
      <div className="flex gap-4">
        <Link href="/about" className="hover:text-[color:var(--accent)]">
          About
        </Link>
        <Link href="/about" className="hover:text-[color:var(--accent)]">
          Docs
        </Link>
        <Link href="/about" className="hover:text-[color:var(--accent)]">
          Community
        </Link>
        <Link href="/about" className="hover:text-[color:var(--accent)]">
          Licensing
        </Link>
      </div>
    </footer>
  );
}
