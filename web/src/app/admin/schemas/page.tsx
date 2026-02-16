"use client";

import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { contentPath } from "../../../lib/apiPaths";

type Schema = {
  id: number;
  name: string;
  description?: string | null;
  levels: string[];
};

type BookOption = {
  id: number;
  book_name: string;
  schema_id?: number | null;
};

type Toast = {
  type: "success" | "error";
  message: string;
};

const parsePayload = (raw: string) => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

const getErrorMessage = (raw: string, fallback: string) => {
  const parsed = parsePayload(raw) as { detail?: string } | null;
  if (parsed?.detail) return parsed.detail;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : fallback;
};

export default function SchemaBuilderPage() {
  const [schemas, setSchemas] = useState<Schema[]>([]);
  const [books, setBooks] = useState<BookOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [canAdmin, setCanAdmin] = useState(false);
  const [authEmail, setAuthEmail] = useState<string | null>(null);

  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createLevels, setCreateLevels] = useState<string[]>(["", ""]);
  const [activePanel, setActivePanel] = useState<"create" | "edit">("edit");

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editLevels, setEditLevels] = useState<string[]>([]);

  const usageCounts = useMemo(() => {
    const counts = new Map<number, number>();
    books.forEach((book) => {
      if (!book.schema_id) return;
      counts.set(book.schema_id, (counts.get(book.schema_id) || 0) + 1);
    });
    return counts;
  }, [books]);

  const loadAuth = async () => {
    try {
      const response = await fetch("/api/me", { credentials: "include" });
      const raw = await response.text();
      if (!response.ok) {
        setCanEdit(false);
        setCanAdmin(false);
        setAccessDenied(true);
        return;
      }
      const data = (parsePayload(raw) as {
        email?: string;
        role?: string;
        permissions?: { can_edit?: boolean; can_admin?: boolean } | null;
      }) || {};
      setAuthEmail(data.email || null);
      const allowEdit = Boolean(
        data.permissions?.can_edit || data.role === "editor" || data.role === "admin"
      );
      const allowAdmin = Boolean(
        data.permissions?.can_admin || data.role === "admin"
      );
      setCanEdit(allowEdit);
      setCanAdmin(allowAdmin);
      setAccessDenied(!allowEdit && !allowAdmin);
    } catch {
      setAccessDenied(true);
    }
  };

  const loadSchemas = async () => {
    setLoading(true);
    setToast(null);
    try {
      const response = await fetch(contentPath("/schemas"), {
        credentials: "include",
      });
      const raw = await response.text();
      const payload = parsePayload(raw) as Schema[] | { detail?: string } | null;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          setSchemas([]);
          return;
        }
        throw new Error(
          `(${response.status}) ${getErrorMessage(raw, "Schemas load failed")}`
        );
      }
      setSchemas((payload as Schema[]) || []);
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Schemas load failed",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadBooks = async () => {
    try {
      const response = await fetch("/api/books", { credentials: "include" });
      const raw = await response.text();
      if (!response.ok) {
        return;
      }
      const payload = parsePayload(raw) as BookOption[] | null;
      setBooks(payload || []);
    } catch {
      setBooks([]);
    }
  };

  useEffect(() => {
    loadAuth();
    loadSchemas();
    loadBooks();
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const handleSelectSchema = (schema: Schema) => {
    setSelectedId(schema.id);
    setEditName(schema.name || "");
    setEditDescription(schema.description || "");
    setEditLevels(schema.levels?.length ? schema.levels : [""]);
    setActivePanel("edit");
  };

  const handleStartCreate = () => {
    setSelectedId(null);
    setActivePanel("create");
  };

  const updateLevels = (levels: string[], setter: Dispatch<SetStateAction<string[]>>) => {
    setter(levels);
  };

  const moveLevel = (
    index: number,
    direction: -1 | 1,
    levels: string[],
    setter: Dispatch<SetStateAction<string[]>>
  ) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= levels.length) return;
    const next = [...levels];
    const temp = next[index];
    next[index] = next[nextIndex];
    next[nextIndex] = temp;
    setter(next);
  };

  const removeLevel = (
    index: number,
    levels: string[],
    setter: Dispatch<SetStateAction<string[]>>
  ) => {
    const next = levels.filter((_, idx) => idx !== index);
    setter(next.length ? next : [""]);
  };

  const addLevel = (levels: string[], setter: Dispatch<SetStateAction<string[]>>) => {
    setter([...levels, ""]);
  };

  const handleCreateSchema = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setToast(null);
    setSaving(true);
    try {
      const payload = {
        name: createName.trim(),
        description: createDescription.trim() || null,
        levels: createLevels.map((level) => level.trim()).filter(Boolean),
      };
      const response = await fetch(contentPath("/schemas"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      const raw = await response.text();
      const data = parsePayload(raw) as Schema | { detail?: string } | null;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          return;
        }
        throw new Error(
          `(${response.status}) ${getErrorMessage(raw, "Schema create failed")}`
        );
      }
      setCreateName("");
      setCreateDescription("");
      setCreateLevels(["", ""]);
      setToast({ type: "success", message: "Schema created." });
      await loadSchemas();
      if (data && (data as Schema).id) {
        handleSelectSchema(data as Schema);
        setActivePanel("edit");
      }
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Schema create failed",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateSchema = async () => {
    if (!selectedId) return;
    setToast(null);
    setSaving(true);
    try {
      const payload = {
        name: editName.trim(),
        description: editDescription.trim() || null,
        levels: editLevels.map((level) => level.trim()).filter(Boolean),
      };
      const response = await fetch(contentPath(`/schemas/${selectedId}`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          credentials: "include",
        }
      );
      const raw = await response.text();
      const data = parsePayload(raw) as Schema | { detail?: string } | null;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          return;
        }
        throw new Error(
          `(${response.status}) ${getErrorMessage(raw, "Schema update failed")}`
        );
      }
      setToast({ type: "success", message: "Schema updated." });
      await loadSchemas();
      if (data && (data as Schema).id) {
        handleSelectSchema(data as Schema);
      }
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Schema update failed",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSchema = async () => {
    if (!selectedId) return;
    
    const booksUsing = usageCounts.get(selectedId) || 0;
    if (booksUsing > 0) {
      setToast({
        type: "error",
        message: `Cannot delete: ${booksUsing} book${booksUsing === 1 ? "" : "s"} use this schema.`,
      });
      return;
    }
    
    if (!confirm("Delete this schema? This cannot be undone.")) return;
    setToast(null);
    setSaving(true);
    try {
      const response = await fetch(contentPath(`/schemas/${selectedId}`), {
        method: "DELETE",
        credentials: "include",
      });
      const raw = await response.text();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          return;
        }
        throw new Error(
          `(${response.status}) ${getErrorMessage(raw, "Schema delete failed")}`
        );
      }
      setSelectedId(null);
      setEditName("");
      setEditDescription("");
      setEditLevels([]);
      setToast({ type: "success", message: "Schema deleted." });
      await loadSchemas();
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Schema delete failed",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteBook = async (bookId: number, bookName: string) => {
    if (!confirm(`Delete "${bookName}"? This will delete ALL content in this book.`)) return;
    setToast(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/books/${bookId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const raw = await response.text();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          return;
        }
        throw new Error(
          `(${response.status}) ${getErrorMessage(raw, "Book delete failed")}`
        );
      }
      setToast({ type: "success", message: "Book deleted." });
      await loadBooks();
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Book delete failed",
      });
    } finally {
      setSaving(false);
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

  const renderLevelEditor = (levels: string[], setter: Dispatch<SetStateAction<string[]>>) => (
    <div className="flex flex-col gap-2">
      {levels.map((level, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <input
            value={level}
            onChange={(event) => {
              const next = [...levels];
              next[idx] = event.target.value;
              updateLevels(next, setter);
            }}
            placeholder={`Level ${idx + 1}`}
            className="flex-1 rounded-2xl border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
          />
          <button
            type="button"
            onClick={() => moveLevel(idx, -1, levels, setter)}
            className="rounded-xl border border-black/10 bg-white/80 px-2 py-2 text-xs text-zinc-600 transition hover:border-black/30"
            aria-label="Move level up"
            disabled={idx === 0}
          >
            Up
          </button>
          <button
            type="button"
            onClick={() => moveLevel(idx, 1, levels, setter)}
            className="rounded-xl border border-black/10 bg-white/80 px-2 py-2 text-xs text-zinc-600 transition hover:border-black/30"
            aria-label="Move level down"
            disabled={idx === levels.length - 1}
          >
            Down
          </button>
          <button
            type="button"
            onClick={() => removeLevel(idx, levels, setter)}
            className="rounded-xl border border-rose-200 bg-rose-50 px-2 py-2 text-xs text-rose-700 transition hover:border-rose-300"
            aria-label="Remove level"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => addLevel(levels, setter)}
        className="w-fit rounded-full border border-black/10 bg-white/80 px-4 py-1 text-xs uppercase tracking-[0.18em] text-zinc-700 transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
      >
        + Add level
      </button>
    </div>
  );

  const renderPreview = (levels: string[]) => (
    <div className="rounded-2xl border border-black/10 bg-white/90 p-4">
      <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">
        Preview
      </div>
      <div className="mt-3 flex flex-col gap-2 text-sm text-zinc-700">
        {levels.length === 0 && <span>No levels defined.</span>}
        {levels.map((level, idx) => (
          <div key={`${level}-${idx}`} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[color:var(--accent)]" />
            <span className="font-medium">{level || `Level ${idx + 1}`}</span>
            {idx < levels.length - 1 && (
              <span className="text-xs text-zinc-400">-&gt;</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="grainy-bg min-h-screen">
      <nav className="border-b border-black/10 bg-white/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <a href="/" className="flex items-center gap-2">
              <img
                src="/logo-mark.svg"
                alt="Hindu Scriptures"
                className="h-8 w-8"
              />
              <span className="text-sm font-semibold text-[color:var(--deep)]">
                Hindu Scriptures
              </span>
            </a>
            <div className="hidden items-center gap-4 text-sm text-zinc-600 sm:flex">
              <a href="/" className="hover:text-[color:var(--accent)]">
                Home
              </a>
              <a href="/scriptures" className="hover:text-[color:var(--accent)]">
                Scriptures
              </a>
              <a href="/explorer" className="hover:text-[color:var(--accent)]">
                Explorer
              </a>
              <a href="/admin" className="hover:text-[color:var(--accent)]">
                Users
              </a>
              <a href="/admin/schemas" className="font-semibold text-[color:var(--deep)]">
                Schemas
              </a>
            </div>
          </div>
          <div className="relative flex flex-col items-end gap-2">
            <button
              onClick={handleSignOut}
              className="rounded-full border border-black/10 bg-white/80 px-4 py-2 text-sm text-zinc-800 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              title={authEmail || ""}
            >
              Sign out
            </button>
          </div>
        </div>
      </nav>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 pb-20 pt-12">
        <header className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Admin</p>
          <h1 className="font-[var(--font-display)] text-4xl text-[color:var(--deep)]">
            Schema builder
          </h1>
          <p className="max-w-2xl text-sm text-zinc-600">
            Design hierarchical scripture schemas and keep structure consistent across books.
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

        {accessDenied && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 shadow-sm">
            Admin or editor access required. Sign in with an elevated account.
            <a className="ml-2 font-semibold text-amber-800 underline" href="/#">
              Go to sign in
            </a>
          </div>
        )}

        <section
          className={`grid gap-6 lg:grid-cols-[1.1fr_1.4fr] ${
            accessDenied ? "pointer-events-none opacity-60" : ""
          }`}
        >
          <div className="rounded-[32px] border border-black/10 bg-white/80 p-6 shadow-lg">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Schemas
              </h2>
              <div className="flex items-center gap-3">
                <span className="text-xs text-zinc-500">
                  {loading ? "Loading..." : `${schemas.length} total`}
                </span>
                <button
                  type="button"
                  onClick={handleStartCreate}
                  className="rounded-full border border-emerald-500/30 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 transition hover:border-emerald-500/60"
                >
                  + Create
                </button>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-3">
              {schemas.map((schema) => (
                <button
                  key={schema.id}
                  type="button"
                  onClick={() => handleSelectSchema(schema)}
                  className={`rounded-2xl border px-4 py-3 text-left transition ${
                    selectedId === schema.id
                      ? "border-[color:var(--accent)] bg-[color:var(--sand)]"
                      : "border-black/10 bg-white/90 hover:border-[color:var(--accent)]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-base font-semibold text-[color:var(--deep)]">
                      {schema.name}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {usageCounts.get(schema.id) || 0} books
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {schema.levels?.join(" -> ") || "No levels"}
                  </div>
                </button>
              ))}
              {schemas.length === 0 && !loading && (
                <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 px-4 py-6 text-sm text-zinc-500">
                  No schemas yet. Create one to get started.
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-6">
            {activePanel === "create" ? (
              <div className="rounded-[32px] border border-black/10 bg-white/80 p-6 shadow-lg">
                <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Create schema
                </h2>
                <form className="mt-4 flex flex-col gap-4" onSubmit={handleCreateSchema}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      value={createName}
                      onChange={(event) => setCreateName(event.target.value)}
                      placeholder="Schema name"
                      className="rounded-2xl border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                      required
                    />
                    <input
                      value={createDescription}
                      onChange={(event) => setCreateDescription(event.target.value)}
                      placeholder="Short description"
                      className="rounded-2xl border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                    />
                  </div>
                  <div>
                    <div className="mb-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Levels
                    </div>
                    {renderLevelEditor(createLevels, setCreateLevels)}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
                    {renderPreview(createLevels.filter((level) => level.trim()))}
                    <button
                      type="submit"
                      disabled={saving}
                      className="rounded-2xl border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-50"
                    >
                      {saving ? "Saving..." : "Create schema"}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="rounded-[32px] border border-black/10 bg-white/80 p-6 shadow-lg">
                <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Edit schema
                </h2>
                {selectedId ? (
                  <div className="mt-4 flex flex-col gap-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                        placeholder="Schema name"
                        className="rounded-2xl border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                        required
                      />
                      <input
                        value={editDescription}
                        onChange={(event) => setEditDescription(event.target.value)}
                        placeholder="Short description"
                        className="rounded-2xl border border-black/10 bg-white/90 px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
                      />
                    </div>
                    <div>
                      <div className="mb-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
                        Levels
                      </div>
                      {renderLevelEditor(editLevels, setEditLevels)}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
                      {renderPreview(editLevels.filter((level) => level.trim()))}
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={handleUpdateSchema}
                          disabled={saving}
                          className="rounded-2xl border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-50"
                        >
                          {saving ? "Saving..." : "Save changes"}
                        </button>
                        {canAdmin && (
                          <button
                            type="button"
                            onClick={handleDeleteSchema}
                            disabled={saving}
                            className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition disabled:opacity-50"
                          >
                            Delete schema
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-dashed border-black/10 bg-white/60 px-4 py-6 text-sm text-zinc-500">
                    Select a schema to edit.
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Books Management Section */}
        {selectedId && (
          <section
            className={`rounded-[32px] border border-black/10 bg-white/80 p-6 shadow-lg ${
              accessDenied ? "pointer-events-none opacity-60" : ""
            }`}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Books using this schema
              </h2>
              <span className="text-xs text-zinc-500">
                {loading ? "Loading..." : `${usageCounts.get(selectedId) || 0} books`}
              </span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {books
                .filter((book) => book.schema_id === selectedId)
                .map((book) => {
                  const schema = schemas.find((s) => s.id === book.schema_id);
                  return (
                    <div
                      key={book.id}
                      className="rounded-2xl border border-black/10 bg-white/90 p-4"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="text-base font-semibold text-[color:var(--deep)]">
                            {book.book_name}
                          </div>
                          <div className="mt-1 text-xs text-zinc-500">
                            {schema ? schema.name : "No schema"}
                          </div>
                        </div>
                        {canAdmin && (
                          <button
                            type="button"
                            onClick={() => handleDeleteBook(book.id, book.book_name)}
                            disabled={saving}
                            className="ml-2 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                            title="Delete book"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              {books.filter((book) => book.schema_id === selectedId).length === 0 && !loading && (
                <div className="col-span-full rounded-2xl border border-dashed border-black/10 bg-white/60 px-4 py-6 text-sm text-zinc-500">
                  No books using this schema yet. Create one from the Scriptures page.
                </div>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
