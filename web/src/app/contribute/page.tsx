"use client";

import { useEffect, useState } from "react";
import { contentPath } from "../../lib/apiPaths";

type BookOption = {
  id: number;
  book_name: string;
};

type TreeNode = {
  id: number;
  level_name: string;
  sequence_number?: number | null;
  title_english?: string | null;
  title_sanskrit?: string | null;
  title_transliteration?: string | null;
  children?: TreeNode[];
};

export default function ContributePage() {
  const [canContribute, setCanContribute] = useState(false);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [canAdmin, setCanAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [books, setBooks] = useState<BookOption[]>([]);
  const [bookId, setBookId] = useState("");
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [parentNodeId, setParentNodeId] = useState<number | null>(null);
  const [levelName, setLevelName] = useState("");
  const [sequenceNumber, setSequenceNumber] = useState("");
  const [titleSanskrit, setTitleSanskrit] = useState("");
  const [titleTransliteration, setTitleTransliteration] = useState("");
  const [titleEnglish, setTitleEnglish] = useState("");
  const [hasContent, setHasContent] = useState(true);
  const [contentSanskrit, setContentSanskrit] = useState("");
  const [contentTransliteration, setContentTransliteration] = useState("");
  const [contentEnglish, setContentEnglish] = useState("");
  const [tags, setTags] = useState("");
  const [toast, setToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const loadAuth = async () => {
      try {
        const response = await fetch("/api/me", { credentials: "include" });

        if (response.ok) {
          const data = (await response.json()) as {
            email?: string;
            role?: string;
            permissions?: {
              can_contribute?: boolean;
              can_edit?: boolean;
              can_admin?: boolean;
            } | null;
          };
          setAuthEmail(data.email || null);
          setCanContribute(
            Boolean(
              data.permissions?.can_contribute ||
                data.permissions?.can_edit ||
                data.role === "contributor" ||
                data.role === "editor" ||
                data.role === "admin"
            )
          );
          setCanAdmin(Boolean(data.permissions?.can_admin || data.role === "admin"));
        } else {
        }
      } catch (err) {
        console.error("Auth check error:", err);
      } finally {
        setLoading(false);
      }
    };
    loadAuth();
  }, []);

  useEffect(() => {
    const loadBooks = async () => {
      try {
        const response = await fetch("/api/books", { credentials: "include" });
        if (response.ok) {
          const data = (await response.json()) as BookOption[];
          setBooks(data);
        }
      } catch {
        // Ignore
      }
    };
    loadBooks();
  }, []);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setToast(null);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const loadTree = async (selectedId: string) => {
    if (!selectedId) {
      setTreeData([]);
      setParentNodeId(null);
      return;
    }
    try {
      const response = await fetch(`/api/books/${selectedId}/tree`, {
        credentials: "include",
      });
      if (response.ok) {
        const data = (await response.json()) as TreeNode[];
        setTreeData(data);
      }
    } catch {
      // Ignore
    }
  };

  const flattenTree = (nodes: TreeNode[]): TreeNode[] => {
    const result: TreeNode[] = [];
    const traverse = (node: TreeNode, depth = 0) => {
      result.push({ ...node, level_order: depth } as TreeNode & { level_order: number });
      if (node.children) {
        node.children.forEach((child) => traverse(child, depth + 1));
      }
    };
    nodes.forEach((n) => traverse(n));
    return result;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!bookId) {
      setToast({ type: "error", message: "Please select a book" });
      return;
    }
    setSubmitting(true);
    setToast(null);

    const contentData: Record<string, unknown> = {};
    if (hasContent) {
      contentData.basic = {
        sanskrit: contentSanskrit || undefined,
        transliteration: contentTransliteration || undefined,
      };
      contentData.translations = {
        english: contentEnglish || undefined,
      };
    }

    const payload = {
      book_id: parseInt(bookId, 10),
      parent_node_id: parentNodeId,
      level_name: levelName,
      level_order: 0, // Will be adjusted by backend if needed
      sequence_number: sequenceNumber ? sequenceNumber.trim() : null,
      title_sanskrit: titleSanskrit || null,
      title_transliteration: titleTransliteration || null,
      title_english: titleEnglish || null,
      has_content: hasContent,
      content_data: Object.keys(contentData).length > 0 ? contentData : null,
      tags: tags ? tags.split(",").map((t) => t.trim()) : [],
    };

    try {
      const response = await fetch(contentPath("/nodes"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });

      if (!response.ok) {
        const error = (await response.json().catch(() => null)) as {
          detail?: string;
        } | null;
        throw new Error(error?.detail || "Failed to create content");
      }

      setToast({ type: "success", message: "Content created successfully!" });
      // Reset form
      setLevelName("");
      setSequenceNumber("");
      setTitleSanskrit("");
      setTitleTransliteration("");
      setTitleEnglish("");
      setHasContent(false);
      setContentSanskrit("");
      setContentTransliteration("");
      setContentEnglish("");
      setTags("");
      setParentNodeId(null);
      // Reload tree
      loadTree(bookId);
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to create content",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      window.location.href = "/";
    } catch {
      window.location.href = "/";
    }
  };

  if (loading) {
    return (
      <div className="grainy-bg flex min-h-screen items-center justify-center">
        <p className="text-sm text-zinc-500">Loading...</p>
      </div>
    );
  }

  if (!canContribute) {
    return (
      <div className="grainy-bg min-h-screen">
        <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 pb-20 pt-12">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 shadow-sm">
            Contributor access required. Please sign in with a contributor, editor, or admin
            account.
            <a className="ml-2 font-semibold text-amber-800 underline" href="/">
              Go to sign in
            </a>
          </div>
        </main>
      </div>
    );
  }

  const flatNodes = flattenTree(treeData);

  return (
    <div className="grainy-bg min-h-screen">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 pb-20 pt-12">
        <header className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Contribute</p>
          <h1 className="font-[var(--font-display)] text-4xl text-[color:var(--deep)]">
            Add content
          </h1>
          <p className="max-w-2xl text-sm text-zinc-600">
            Create new content nodes for scriptures. Select a book and optionally a parent node,
            then fill in the details.
          </p>
        </header>

        {toast && (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm shadow-sm ${
              toast.type === "error"
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
          >
            {toast.message}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="rounded-[32px] border border-black/10 bg-white/80 p-6 shadow-lg"
        >
          <div className="grid gap-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Book *
                </span>
                <select
                  value={bookId}
                  onChange={(event) => {
                    const value = event.target.value;
                    setBookId(value);
                    loadTree(value);
                  }}
                  className="rounded-2xl border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                  required
                >
                  <option value="">Select a book</option>
                  {books.map((book) => (
                    <option key={book.id} value={book.id.toString()}>
                      {book.book_name}
                    </option>
                  ))}
                </select>
              </label>

              {flatNodes.length > 0 && (
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                    Parent node
                  </span>
                  <select
                    value={parentNodeId || ""}
                    onChange={(event) =>
                      setParentNodeId(event.target.value ? parseInt(event.target.value, 10) : null)
                    }
                    className="rounded-2xl border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                  >
                    <option value="">None (top level)</option>
                    {flatNodes.map((node) => (
                      <option key={node.id} value={node.id.toString()}>
                        {node.title_english || node.title_sanskrit || `Node ${node.id}`}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Level name *
                </span>
                <input
                  value={levelName}
                  onChange={(event) => setLevelName(event.target.value)}
                  placeholder="e.g., Chapter, Shloka, Verse"
                  className="rounded-2xl border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                  required
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Sequence number
                </span>
                <input
                  type="number"
                  value={sequenceNumber}
                  onChange={(event) => setSequenceNumber(event.target.value)}
                  placeholder="Auto-calculated if empty"
                  className="rounded-2xl border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                />
              </label>
            </div>

            <div className="grid gap-4">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Title (Sanskrit)
                </span>
                <input
                  value={titleSanskrit}
                  onChange={(event) => setTitleSanskrit(event.target.value)}
                  placeholder="देवनागरी"
                  className="rounded-2xl border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Title (Transliteration)
                </span>
                <input
                  value={titleTransliteration}
                  onChange={(event) => setTitleTransliteration(event.target.value)}
                  placeholder="IAST or simplified"
                  className="rounded-2xl border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Title (English)
                </span>
                <input
                  value={titleEnglish}
                  onChange={(event) => setTitleEnglish(event.target.value)}
                  placeholder="English title or translation"
                  className="rounded-2xl border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                />
              </label>
            </div>

            <label className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white/90 px-4 py-3">
              <input
                type="checkbox"
                checked={hasContent}
                onChange={(event) => setHasContent(event.target.checked)}
                className="h-4 w-4 rounded border-black/20 text-[color:var(--accent)]"
              />
              <span className="text-sm text-zinc-700">This node has text content</span>
            </label>

            {hasContent && (
              <div className="grid gap-4 rounded-2xl border border-black/10 bg-zinc-50/50 p-4">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                    Content (Sanskrit)
                  </span>
                  <textarea
                    value={contentSanskrit}
                    onChange={(event) => setContentSanskrit(event.target.value)}
                    placeholder="देवनागरी text"
                    rows={3}
                    className="rounded-2xl border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                    Content (Transliteration)
                  </span>
                  <textarea
                    value={contentTransliteration}
                    onChange={(event) => setContentTransliteration(event.target.value)}
                    placeholder="IAST or simplified transliteration"
                    rows={3}
                    className="rounded-2xl border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                    Translation (English)
                  </span>
                  <textarea
                    value={contentEnglish}
                    onChange={(event) => setContentEnglish(event.target.value)}
                    placeholder="English translation"
                    rows={3}
                    className="rounded-2xl border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                  />
                </label>
              </div>
            )}

            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Tags (comma-separated)
              </span>
              <input
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="e.g., philosophy, devotion, yoga"
                className="rounded-2xl border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
              />
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="rounded-2xl bg-[color:var(--deep)] px-6 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:opacity-50"
            >
              {submitting ? "Creating..." : "Create content"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
