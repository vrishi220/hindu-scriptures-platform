"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type CompilationItem = {
  node_id: number;
  order: number;
};

type Compilation = {
  id: number;
  title: string;
  description?: string | null;
  schema_type?: string | null;
  items: CompilationItem[];
  status: "draft" | "published";
  is_public: boolean;
  created_at: string;
  updated_at: string;
};

type Schema = {
  id: number;
  name: string;
  description?: string | null;
  levels: string[];
};

export default function CompilationsPage() {
  const router = useRouter();
  const [compilations, setCompilations] = useState<Compilation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [schemas, setSchemas] = useState<Schema[]>([]);
  const [publishingId, setPublishingId] = useState<number | null>(null);
  const [selectedSchema, setSelectedSchema] = useState<number | null>(null);
  const [bookName, setBookName] = useState("");
  const [bookCode, setBookCode] = useState("");
  const [languagePrimary, setLanguagePrimary] = useState("sanskrit");
  const [publishMessage, setPublishMessage] = useState<string | null>(null);

  useEffect(() => {
    const loadAuth = async () => {
      try {
        const response = await fetch("/api/me", { credentials: "include" });
        if (!response.ok) {
          setAuthEmail(null);
          return;
        }
        const data = (await response.json()) as { email?: string };
        setAuthEmail(data.email || null);
      } catch {
        setAuthEmail(null);
      }
    };
    loadAuth();
  }, []);

  useEffect(() => {
    if (!authEmail) {
      setLoading(false);
      return;
    }

    const loadCompilations = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch("/api/compilations/my", {
          credentials: "include",
        });

        if (!response.ok) {
          throw new Error("Failed to load compilations");
        }

        const data = (await response.json()) as Compilation[];
        setCompilations(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load compilations");
      } finally {
        setLoading(false);
      }
    };

    loadCompilations();
  }, [authEmail]);

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this compilation?")) return;

    try {
      const response = await fetch(`/api/compilations/${id}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to delete");
      }

      setCompilations((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const loadSchemas = async () => {
    try {
      const response = await fetch(
        process.env.NEXT_PUBLIC_API_URL 
          ? `${process.env.NEXT_PUBLIC_API_URL}/schemas`
          : "/api/schemas",
        { credentials: "include" }
      );
      if (response.ok) {
        const data = (await response.json()) as Schema[];
        setSchemas(data);
      }
    } catch {
      // Ignore errors
    }
  };

  const handlePublishClick = async (compilation: Compilation) => {
    setPublishingId(compilation.id);
    setBookName(compilation.title);
    setBookCode("");
    setLanguagePrimary("sanskrit");
    setSelectedSchema(null);
    setPublishMessage(null);
    await loadSchemas();
  };

  const handlePublishSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publishingId || !selectedSchema) return;

    try {
      setPublishMessage("Publishing...");
      const response = await fetch(`/api/compilations/${publishingId}/publish`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schema_id: selectedSchema,
          book_name: bookName,
          book_code: bookCode || null,
          language_primary: languagePrimary,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to publish");
      }

      const newBook = await response.json();
      setPublishMessage(`✓ Published as book: ${newBook.book_name}`);
      
      // Close modal after 2 seconds
      setTimeout(() => {
        setPublishingId(null);
        setPublishMessage(null);
        router.push(`/scriptures?book=${newBook.id}`);
      }, 2000);
    } catch (err) {
      setPublishMessage(
        `✗ ${err instanceof Error ? err.message : "Failed to publish"}`
      );
    }
  };

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return dateString;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[color:var(--sand)] via-white to-[color:var(--sand)]">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        {/* Header */}
        <div className="mb-8">
          <h1 className="font-[var(--font-display)] text-4xl text-[color:var(--deep)] sm:text-5xl">
            My Compilations
          </h1>
          <p className="mt-2 text-zinc-600">
            View and manage your saved scripture collections
          </p>
        </div>

        {/* Content */}
        {!authEmail ? (
          <div className="rounded-2xl border border-black/10 bg-white/80 p-8 text-center shadow-lg">
            <p className="mb-4 text-zinc-600">Please sign in to view your compilations.</p>
            <button
              onClick={() => router.push("/signin")}
              className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-6 py-3 font-medium text-white transition hover:shadow-lg"
            >
              Sign In
            </button>
          </div>
        ) : loading ? (
          <div className="rounded-2xl border border-black/10 bg-white/80 p-8 text-center shadow-lg">
            <p className="text-zinc-600">Loading compilations...</p>
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center shadow-lg">
            <p className="text-red-700">{error}</p>
          </div>
        ) : compilations.length === 0 ? (
          <div className="rounded-2xl border border-black/10 bg-white/80 p-8 text-center shadow-lg">
            <p className="mb-4 text-zinc-600">
              You haven't saved any compilations yet.
            </p>
            <p className="text-sm text-zinc-500">
              Visit the{" "}
              <a
                href="/scriptures"
                className="font-medium text-[color:var(--accent)] hover:underline"
              >
                Scriptures page
              </a>{" "}
              to add verses to your basket and save them as a compilation.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {compilations.map((compilation) => (
              <div
                key={compilation.id}
                className="rounded-2xl border border-black/10 bg-white/80 shadow-lg transition hover:shadow-xl"
              >
                <div className="p-6">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <h3 className="font-[var(--font-display)] text-xl text-[color:var(--deep)]">
                        {compilation.title}
                      </h3>
                      {compilation.description && (
                        <p className="mt-1 text-sm text-zinc-600">
                          {compilation.description}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                        <span className="rounded-full border border-black/10 bg-white px-2 py-1">
                          {compilation.items.length} item{compilation.items.length !== 1 ? "s" : ""}
                        </span>
                        <span className="rounded-full border border-black/10 bg-white px-2 py-1">
                          {compilation.status}
                        </span>
                        {compilation.is_public && (
                          <span className="rounded-full border border-emerald-500/30 bg-emerald-50 px-2 py-1 text-emerald-700">
                            Public
                          </span>
                        )}
                        <span>•</span>
                        <span>Created {formatDate(compilation.created_at)}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          setExpandedId(expandedId === compilation.id ? null : compilation.id)
                        }
                        className="rounded-lg border border-black/10 bg-white px-3 py-2 text-xs font-medium uppercase tracking-wider text-zinc-700 transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
                      >
                        {expandedId === compilation.id ? "Hide" : "View"} Items
                      </button>
                      <button
                        onClick={() => handlePublishClick(compilation)}
                        className="rounded-lg border border-emerald-500/30 bg-emerald-50 px-3 py-2 text-xs font-medium uppercase tracking-wider text-emerald-700 transition hover:border-emerald-500/60 hover:bg-emerald-100"
                      >
                        Publish as Book
                      </button>
                      <button
                        onClick={() => handleDelete(compilation.id)}
                        className="rounded-lg border border-red-500/30 bg-red-50 px-3 py-2 text-xs font-medium uppercase tracking-wider text-red-700 transition hover:border-red-500/60 hover:bg-red-100"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {/* Expanded Items */}
                  {expandedId === compilation.id && (
                    <div className="mt-4 border-t border-black/10 pt-4">
                      <div className="mb-2 text-sm font-medium uppercase tracking-wider text-zinc-500">
                        Items in this compilation:
                      </div>
                      <div className="flex flex-col gap-2">
                        {compilation.items
                          .sort((a, b) => a.order - b.order)
                          .map((item, idx) => (
                            <div
                              key={idx}
                              className="flex items-center gap-3 rounded-lg border border-black/10 bg-white/80 px-4 py-2 text-sm"
                            >
                              <span className="text-xs text-zinc-500">{item.order}.</span>
                              <span className="text-zinc-700">
                                Node ID: {item.node_id}
                              </span>
                              <a
                                href={`/scriptures?node=${item.node_id}`}
                                className="ml-auto text-xs text-[color:var(--accent)] hover:underline"
                              >
                                View →
                              </a>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
