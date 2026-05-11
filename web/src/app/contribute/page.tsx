"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppBanner from "@/components/scriptle/AppBanner";
import { contentPath } from "@/lib/apiPaths";
import { getMe } from "@/lib/authClient";
import { getBooks } from "@/lib/booksClient";

type BookOption = { id: number; book_name: string };

type TreeNode = {
  id: number;
  level_name: string;
  sequence_number?: number | null;
  title_english?: string | null;
  title_sanskrit?: string | null;
  title_transliteration?: string | null;
  children?: TreeNode[];
};

type FlatNode = TreeNode & { depth: number };

function flattenTree(nodes: TreeNode[]): FlatNode[] {
  const out: FlatNode[] = [];
  const visit = (n: TreeNode, depth: number) => {
    out.push({ ...n, depth });
    n.children?.forEach((c) => visit(c, depth + 1));
  };
  nodes.forEach((n) => visit(n, 0));
  return out;
}

export default function ContributePage() {
  const [canContribute, setCanContribute] = useState(false);
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
    let cancelled = false;
    Promise.all([getMe().catch(() => null), getBooks().catch(() => [])])
      .then(([me, list]) => {
        if (cancelled) return;
        setCanContribute(
          Boolean(
            me &&
              (me.permissions?.can_contribute ||
                me.permissions?.can_edit ||
                me.role === "contributor" ||
                me.role === "editor" ||
                me.role === "admin")
          )
        );
        setBooks(list as BookOption[]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
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
      // ignore
    }
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
      contentData.translations = { english: contentEnglish || undefined };
    }

    const payload = {
      book_id: parseInt(bookId, 10),
      parent_node_id: parentNodeId,
      level_name: levelName,
      level_order: 0,
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
      setToast({ type: "success", message: "Verse created." });
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
      loadTree(bookId);
    } catch (err) {
      setToast({
        type: "error",
        message:
          err instanceof Error ? err.message : "Failed to create content",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div data-scriptle="true">
        <AppBanner active="search" />
        <main className="page-shell">
          <p className="page-lede">Loading…</p>
        </main>
      </div>
    );
  }

  if (!canContribute) {
    return (
      <div data-scriptle="true">
        <AppBanner active="search" />
        <main className="page-shell">
          <header>
            <p className="page-eyebrow">Contribute</p>
            <h1 className="page-h1">Contributor access required</h1>
            <p className="page-lede">
              Sign in with a contributor, editor, or admin account to add
              content.
            </p>
          </header>
          <Link href="/signin" className="page-cta" style={{ alignSelf: "flex-start" }}>
            Sign in →
          </Link>
        </main>
      </div>
    );
  }

  const flatNodes = flattenTree(treeData);

  return (
    <div data-scriptle="true">
      <AppBanner active="search" />
      <main className="page-shell">
        <header>
          <p className="page-eyebrow">Contribute</p>
          <h1 className="page-h1">Add a verse</h1>
          <p className="page-lede">
            Pick a book and (optionally) a parent node, then describe the new
            content node you&apos;d like to add.
          </p>
        </header>

        {toast ? (
          <div className={`form-toast ${toast.type}`}>{toast.message}</div>
        ) : null}

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: 20 }}
        >
          <div className="form-row cols-2">
            <div className="auth-field">
              <label className="auth-label" htmlFor="book">
                Book *
              </label>
              <select
                id="book"
                className="form-select"
                value={bookId}
                onChange={(event) => {
                  const value = event.target.value;
                  setBookId(value);
                  loadTree(value);
                }}
                required
              >
                <option value="">Select a book</option>
                {books.map((book) => (
                  <option key={book.id} value={book.id.toString()}>
                    {book.book_name}
                  </option>
                ))}
              </select>
            </div>

            {flatNodes.length > 0 ? (
              <div className="auth-field">
                <label className="auth-label" htmlFor="parent">
                  Parent node
                </label>
                <select
                  id="parent"
                  className="form-select"
                  value={parentNodeId ?? ""}
                  onChange={(event) =>
                    setParentNodeId(
                      event.target.value
                        ? parseInt(event.target.value, 10)
                        : null
                    )
                  }
                >
                  <option value="">None (top level)</option>
                  {flatNodes.map((node) => {
                    const indent = "  ".repeat(node.depth);
                    const label =
                      node.title_english ||
                      node.title_sanskrit ||
                      `Node ${node.id}`;
                    return (
                      <option key={node.id} value={node.id.toString()}>
                        {indent}
                        {label}
                      </option>
                    );
                  })}
                </select>
              </div>
            ) : null}
          </div>

          <div className="form-row cols-2">
            <div className="auth-field">
              <label className="auth-label" htmlFor="level">
                Level name *
              </label>
              <input
                id="level"
                className="auth-input"
                value={levelName}
                onChange={(event) => setLevelName(event.target.value)}
                placeholder="e.g. Chapter, Shloka, Verse"
                required
              />
            </div>
            <div className="auth-field">
              <label className="auth-label" htmlFor="seq">
                Sequence number
              </label>
              <input
                id="seq"
                className="auth-input"
                type="number"
                value={sequenceNumber}
                onChange={(event) => setSequenceNumber(event.target.value)}
                placeholder="Auto-calculated if empty"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="auth-field">
              <label className="auth-label" htmlFor="title-sa">
                Title (Sanskrit)
              </label>
              <input
                id="title-sa"
                className="auth-input"
                value={titleSanskrit}
                onChange={(event) => setTitleSanskrit(event.target.value)}
                placeholder="देवनागरी"
              />
            </div>
            <div className="auth-field">
              <label className="auth-label" htmlFor="title-tr">
                Title (Transliteration)
              </label>
              <input
                id="title-tr"
                className="auth-input"
                value={titleTransliteration}
                onChange={(event) =>
                  setTitleTransliteration(event.target.value)
                }
                placeholder="IAST or simplified"
              />
            </div>
            <div className="auth-field">
              <label className="auth-label" htmlFor="title-en">
                Title (English)
              </label>
              <input
                id="title-en"
                className="auth-input"
                value={titleEnglish}
                onChange={(event) => setTitleEnglish(event.target.value)}
                placeholder="English title or translation"
              />
            </div>
          </div>

          <label className="form-check">
            <input
              type="checkbox"
              checked={hasContent}
              onChange={(event) => setHasContent(event.target.checked)}
            />
            <span>This node has text content</span>
          </label>

          {hasContent ? (
            <div className="form-group">
              <div className="auth-field">
                <label className="auth-label" htmlFor="content-sa">
                  Content (Sanskrit)
                </label>
                <textarea
                  id="content-sa"
                  className="form-textarea"
                  value={contentSanskrit}
                  onChange={(event) => setContentSanskrit(event.target.value)}
                  placeholder="देवनागरी text"
                  rows={3}
                />
              </div>
              <div className="auth-field">
                <label className="auth-label" htmlFor="content-tr">
                  Content (Transliteration)
                </label>
                <textarea
                  id="content-tr"
                  className="form-textarea"
                  value={contentTransliteration}
                  onChange={(event) =>
                    setContentTransliteration(event.target.value)
                  }
                  placeholder="IAST or simplified transliteration"
                  rows={3}
                />
              </div>
              <div className="auth-field">
                <label className="auth-label" htmlFor="content-en">
                  Translation (English)
                </label>
                <textarea
                  id="content-en"
                  className="form-textarea"
                  value={contentEnglish}
                  onChange={(event) => setContentEnglish(event.target.value)}
                  placeholder="English translation"
                  rows={3}
                />
              </div>
            </div>
          ) : null}

          <div className="auth-field">
            <label className="auth-label" htmlFor="tags">
              Tags
            </label>
            <input
              id="tags"
              className="auth-input"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="comma-separated: philosophy, devotion, yoga"
            />
          </div>

          <button
            type="submit"
            className="page-cta"
            disabled={submitting}
            style={{ alignSelf: "flex-start" }}
          >
            {submitting ? "Creating…" : "Create verse"}
          </button>
        </form>
      </main>
    </div>
  );
}
