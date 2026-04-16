"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { contentPath } from "../../../lib/apiPaths";
import { getMe } from "../../../lib/authClient";
import InlineClearButton from "../../../components/InlineClearButton";

type Schema = {
  id: number;
  name: string;
  description?: string | null;
  levels: string[];
  level_template_defaults?: Record<string, number>;
};

type TemplateOption = {
  id: number;
  name: string;
  target_schema_id?: number | null;
  target_level?: string | null;
  visibility: "private" | "published";
  is_system?: boolean;
  current_version: number;
  is_active: boolean;
};

type BookOption = {
  id: number;
  book_name: string;
  schema_id?: number | null;
};

type MePayload = {
  role?: string | null;
  permissions?: {
    can_admin?: boolean;
    can_edit?: boolean;
  } | null;
};

type Toast = {
  type: "success" | "error";
  message: string;
};

type ModalMode = "create" | "edit" | "view";

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

const normalizeLevel = (value: string) => value.trim().toLowerCase();

const parseLevelsInput = (value: string): string[] =>
  value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);

export default function SchemaBuilderPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [canAdmin, setCanAdmin] = useState(false);

  const [schemas, setSchemas] = useState<Schema[]>([]);
  const [books, setBooks] = useState<BookOption[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [usageFilter, setUsageFilter] = useState<"all" | "used" | "unused">("all");

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>("create");
  const [editingSchemaId, setEditingSchemaId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [levelsInput, setLevelsInput] = useState("chapter\nverse");
  const [levelTemplateDefaults, setLevelTemplateDefaults] = useState<Record<string, string>>({});

  const usageCounts = useMemo(() => {
    const counts = new Map<number, number>();
    books.forEach((book) => {
      if (!book.schema_id) return;
      counts.set(book.schema_id, (counts.get(book.schema_id) || 0) + 1);
    });
    return counts;
  }, [books]);

  const parsedLevels = useMemo(() => parseLevelsInput(levelsInput), [levelsInput]);

  const filteredSchemas = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return schemas.filter((schema) => {
      const usage = usageCounts.get(schema.id) || 0;
      if (usageFilter === "used" && usage === 0) return false;
      if (usageFilter === "unused" && usage > 0) return false;

      if (!normalizedQuery) return true;
      const haystack = [schema.name, schema.description || "", schema.levels.join(" ")]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [schemas, searchQuery, usageFilter, usageCounts]);

  const loadAuth = async () => {
    try {
      const data = (await getMe()) as MePayload | null;
      if (!data) {
        setAccessDenied(true);
        setCanEdit(false);
        setCanAdmin(false);
        return;
      }
      const allowEdit = Boolean(data.permissions?.can_edit || data.role === "editor" || data.role === "admin");
      const allowAdmin = Boolean(data.permissions?.can_admin || data.role === "admin");
      setCanEdit(allowEdit || allowAdmin);
      setCanAdmin(allowAdmin);
      setAccessDenied(!allowEdit && !allowAdmin);
    } catch {
      setAccessDenied(true);
      setCanEdit(false);
      setCanAdmin(false);
    }
  };

  const loadSchemas = async () => {
    setLoading(true);
    try {
      const response = await fetch(contentPath("/schemas"), { credentials: "include" });
      const raw = await response.text();
      const payload = parsePayload(raw) as Schema[] | null;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          setSchemas([]);
          return;
        }
        throw new Error(`(${response.status}) ${getErrorMessage(raw, "Schemas load failed")}`);
      }
      setSchemas(payload || []);
    } catch (err) {
      setToast({ type: "error", message: err instanceof Error ? err.message : "Schemas load failed" });
    } finally {
      setLoading(false);
    }
  };

  const loadBooks = async () => {
    try {
      const response = await fetch("/api/books", { credentials: "include" });
      const raw = await response.text();
      if (!response.ok) {
        setBooks([]);
        return;
      }
      const payload = parsePayload(raw) as BookOption[] | null;
      setBooks(payload || []);
    } catch {
      setBooks([]);
    }
  };

  const loadTemplates = async () => {
    try {
      const response = await fetch("/api/templates?include_published=true&include_inactive=false", {
        credentials: "include",
      });
      const raw = await response.text();
      if (!response.ok) {
        setTemplates([]);
        return;
      }
      const payload = parsePayload(raw) as TemplateOption[] | null;
      setTemplates(payload || []);
    } catch {
      setTemplates([]);
    }
  };

  const loadAll = async () => {
    await Promise.all([loadSchemas(), loadBooks(), loadTemplates()]);
  };

  useEffect(() => {
    void (async () => {
      await loadAuth();
      await loadAll();
      setAuthChecked(true);
    })();
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    setLevelTemplateDefaults((prev) => {
      const allowed = new Set(parsedLevels);
      const next: Record<string, string> = {};
      Object.entries(prev).forEach(([level, templateId]) => {
        if (allowed.has(level) && templateId) {
          next[level] = templateId;
        }
      });
      return next;
    });
  }, [parsedLevels]);

  const resetForm = () => {
    setEditingSchemaId(null);
    setName("");
    setDescription("");
    setLevelsInput("chapter\nverse");
    setLevelTemplateDefaults({});
  };

  const openCreate = () => {
    setModalMode("create");
    resetForm();
    setModalOpen(true);
  };

  const openSchema = (schema: Schema) => {
    const editable = canEdit;
    setModalMode(editable ? "edit" : "view");
    setEditingSchemaId(schema.id);
    setName(schema.name || "");
    setDescription(schema.description || "");
    setLevelsInput((schema.levels || []).join("\n"));

    const defaults: Record<string, string> = {};
    Object.entries(schema.level_template_defaults || {}).forEach(([level, templateId]) => {
      defaults[level] = String(templateId);
    });
    setLevelTemplateDefaults(defaults);
    setModalOpen(true);
  };

  const handleSave = async () => {
    const levels = parseLevelsInput(levelsInput);
    if (!name.trim() || levels.length === 0) {
      setToast({ type: "error", message: "Name and at least one level are required." });
      return;
    }

    setSaving(true);
    setToast(null);
    try {
      const isEdit = editingSchemaId !== null;
      const payload: {
        name: string;
        description: string | null;
        levels: string[];
        level_template_defaults?: Record<string, number>;
      } = {
        name: name.trim(),
        description: description.trim() || null,
        levels,
      };

      if (isEdit) {
        payload.level_template_defaults = Object.fromEntries(
          Object.entries(levelTemplateDefaults)
            .filter(([level, templateId]) => Boolean(level.trim() && templateId))
            .map(([level, templateId]) => [level, Number(templateId)])
        );
      }

      const response = await fetch(
        isEdit ? contentPath(`/schemas/${editingSchemaId}`) : contentPath("/schemas"),
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          credentials: "include",
        }
      );

      const raw = await response.text();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          return;
        }
        throw new Error(
          `(${response.status}) ${getErrorMessage(raw, isEdit ? "Schema update failed" : "Schema create failed")}`
        );
      }

      setToast({ type: "success", message: isEdit ? "Schema updated." : "Schema created." });
      setModalOpen(false);
      resetForm();
      await loadAll();
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to save schema",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (schema: Schema) => {
    const usage = usageCounts.get(schema.id) || 0;
    if (usage > 0) {
      setToast({
        type: "error",
        message: `Cannot delete: ${usage} book${usage === 1 ? "" : "s"} use this schema.`,
      });
      return;
    }

    if (!window.confirm(`Delete schema "${schema.name}"? This cannot be undone.`)) return;

    setDeletingId(schema.id);
    setToast(null);
    try {
      const response = await fetch(contentPath(`/schemas/${schema.id}`), {
        method: "DELETE",
        credentials: "include",
      });
      const raw = await response.text();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          return;
        }
        throw new Error(`(${response.status}) ${getErrorMessage(raw, "Schema delete failed")}`);
      }

      if (editingSchemaId === schema.id) {
        setModalOpen(false);
        resetForm();
      }

      setToast({ type: "success", message: "Schema deleted." });
      await loadAll();
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Schema delete failed",
      });
    } finally {
      setDeletingId(null);
    }
  };

  const templateOptionsForLevel = (level: string) => {
    const normalized = normalizeLevel(level);
    if (!editingSchemaId) return [];

    return templates.filter((template) => {
      if (!template.is_active) return false;
      const templateLevel = normalizeLevel(template.target_level || "");
      if (templateLevel !== normalized) return false;
      const schemaMatch = template.target_schema_id === editingSchemaId;
      const globalSystemMatch = Boolean(template.is_system) && !template.target_schema_id;
      return schemaMatch || globalSystemMatch;
    });
  };

  if (!authChecked) {
    return <main className="mx-auto w-full max-w-6xl px-4 py-6">Loading…</main>;
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-zinc-900">Schemas</h1>
        <p className="text-sm text-zinc-600">Manage scripture schemas in a searchable list view.</p>
      </header>

      <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
        <a href="/admin" className="rounded-full border border-black/10 bg-white px-3 py-1">Users</a>
        <a href="/admin/schemas" className="rounded-full border border-[color:var(--accent)] bg-[color:var(--accent)]/10 px-3 py-1 text-[color:var(--accent)]">Schemas</a>
        <a href="/admin/metadata/properties" className="rounded-full border border-black/10 bg-white px-3 py-1">Properties</a>
        <a href="/admin/metadata/categories" className="rounded-full border border-black/10 bg-white px-3 py-1">Categories</a>
        <a href="/admin/media-bank" className="rounded-full border border-black/10 bg-white px-3 py-1">Multimedia repo</a>
      </div>

      {toast && (
        <div className={`rounded-lg border px-3 py-2 text-sm ${toast.type === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
          {toast.message}
        </div>
      )}

      {accessDenied && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          Admin or editor access required.
          <Link className="ml-2 font-semibold underline" href="/signin">
            Sign in
          </Link>
        </div>
      )}

      <section className={`rounded-xl border border-black/10 bg-white p-4 space-y-3 ${accessDenied ? "pointer-events-none opacity-60" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-zinc-900">Schemas</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="group relative">
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search schemas"
                className="rounded-lg border border-black/10 px-3 py-1.5 pr-10 text-sm"
              />
              <InlineClearButton
                visible={Boolean(searchQuery)}
                onClear={() => setSearchQuery("")}
                ariaLabel="Clear schema search"
              />
            </div>
            <select
              value={usageFilter}
              onChange={(event) => setUsageFilter(event.target.value as "all" | "used" | "unused")}
              className="rounded-lg border border-black/10 px-2 py-1.5 text-sm"
            >
              <option value="all">All usage</option>
              <option value="used">Used by books</option>
              <option value="unused">Unused</option>
            </select>
            <button
              type="button"
              onClick={() => void loadAll()}
              className="rounded-lg border border-black/10 px-3 py-1.5 text-sm"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={openCreate}
                className="rounded-lg border border-black/10 bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white"
              >
                Create
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-zinc-600">Loading...</p>
        ) : filteredSchemas.length === 0 ? (
          <p className="text-sm text-zinc-600">No schemas found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left text-zinc-600">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Levels</th>
                  <th className="px-3 py-2 font-medium">Books</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSchemas.map((schema) => (
                  <tr key={schema.id} onClick={() => openSchema(schema)} className="cursor-pointer border-b border-black/5 hover:bg-zinc-50">
                    <td className="px-3 py-2 font-medium text-zinc-900">{schema.name}</td>
                    <td className="px-3 py-2 text-zinc-700">{schema.levels.join(" → ") || "—"}</td>
                    <td className="px-3 py-2 text-zinc-700">{usageCounts.get(schema.id) || 0}</td>
                    <td className="px-3 py-2">
                      {canAdmin ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDelete(schema);
                          }}
                          disabled={deletingId === schema.id}
                          className="rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-700 disabled:opacity-50"
                        >
                          {deletingId === schema.id ? "Deleting…" : "Delete"}
                        </button>
                      ) : (
                        <span className="text-xs text-zinc-500">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-3xl rounded-xl border border-black/10 bg-white p-4 shadow-xl max-h-[90dvh] overflow-y-auto">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-zinc-900">
                {modalMode === "create" ? "Create schema" : modalMode === "edit" ? "Edit schema" : "View schema"}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  resetForm();
                }}
                className="rounded-md border border-black/10 px-2.5 py-1 text-sm text-zinc-700"
              >
                X
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-zinc-700">
                Name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={modalMode === "view"}
                  className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm disabled:bg-zinc-100"
                />
              </label>
              <label className="text-sm text-zinc-700">
                Description
                <input
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  disabled={modalMode === "view"}
                  className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm disabled:bg-zinc-100"
                />
              </label>
            </div>

            <label className="mt-3 block text-sm text-zinc-700">
              Levels (one per line)
              <textarea
                value={levelsInput}
                onChange={(event) => setLevelsInput(event.target.value)}
                disabled={modalMode === "view"}
                className="mt-1 min-h-[120px] w-full rounded-lg border border-black/10 px-3 py-2 text-sm disabled:bg-zinc-100"
              />
            </label>

            {modalMode !== "create" && (
              <div className="mt-3 rounded-lg border border-black/10 p-3">
                <h4 className="text-sm font-medium text-zinc-900">Level default templates</h4>
                <p className="mt-1 text-xs text-zinc-600">Set defaults by level. Node-level properties can still override these.</p>
                <div className="mt-3 space-y-2">
                  {parsedLevels.length === 0 ? (
                    <p className="text-sm text-zinc-600">Add levels to configure defaults.</p>
                  ) : (
                    parsedLevels.map((level) => {
                      const options = templateOptionsForLevel(level);
                      return (
                        <label key={level} className="block text-sm text-zinc-700">
                          {level}
                          <select
                            value={levelTemplateDefaults[level] || ""}
                            onChange={(event) =>
                              setLevelTemplateDefaults((prev) => ({
                                ...prev,
                                [level]: event.target.value,
                              }))
                            }
                            disabled={modalMode === "view"}
                            className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm disabled:bg-zinc-100"
                          >
                            <option value="">No default (built-in fallback)</option>
                            {options.map((template) => (
                              <option key={template.id} value={String(template.id)}>
                                {template.name} (v{template.current_version}, {template.visibility})
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    })
                  )}
                </div>
                <div className="mt-2">
                  <a href="/templates" className="text-xs text-[color:var(--accent)] underline decoration-transparent underline-offset-2 hover:decoration-current">
                    Manage templates
                  </a>
                </div>
              </div>
            )}

            {modalMode !== "view" ? (
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || !name.trim() || parseLevelsInput(levelsInput).length === 0}
                  className="rounded-lg border border-black/10 bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {saving ? "Saving…" : modalMode === "create" ? "Create" : "Save"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </main>
  );
}
