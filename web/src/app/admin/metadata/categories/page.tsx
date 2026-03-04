"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MoreVertical } from "lucide-react";
import { getMe } from "@/lib/authClient";

type Toast = {
  type: "success" | "error";
  message: string;
};

type PropertyDefinition = {
  id: number;
  display_name: string;
  internal_name: string;
  is_deprecated: boolean;
};

type Category = {
  id: number;
  name: string;
  description?: string | null;
  parent_category_ids: number[];
  applicable_scopes: string[];
  version: number;
  is_system: boolean;
  is_published: boolean;
  is_deprecated: boolean;
};

type CategoryCreatePayload = {
  name: string;
  description: string | null;
  parent_category_ids: number[];
  applicable_scopes: string[];
  properties: Array<{
    property_definition_id: number;
    order: number;
    description_override: string | null;
    default_override: string | number | boolean | Record<string, unknown> | null;
    is_required_override: boolean | null;
  }>;
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

export default function MetadataCategoriesAdminPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [canAdmin, setCanAdmin] = useState(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [properties, setProperties] = useState<PropertyDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [openActionsId, setOpenActionsId] = useState<number | null>(null);
  const actionMenuRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "published" | "deprecated">("all");

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>("create");
  const [editingId, setEditingId] = useState<number | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scopes, setScopes] = useState<string[]>(["book"]);
  const [parentIds, setParentIds] = useState<number[]>([]);
  const [propertyIds, setPropertyIds] = useState<number[]>([]);

  const scopeLabelMap: Record<string, string> = {
    all: "All",
    book: "Book",
    level: "Level",
    node: "Node",
    global: "Global",
  };

  const scopeOptions = useMemo(() => {
    const preferredOrder = ["all", "book", "level", "node", "global"];
    const combined = new Set<string>(preferredOrder);
    categories.forEach((category) => {
      (category.applicable_scopes || []).forEach((scope) => {
        if (scope) combined.add(scope);
      });
    });
    return Array.from(combined);
  }, [categories]);

  const activeProperties = useMemo(
    () => properties.filter((property) => !property.is_deprecated),
    [properties]
  );

  const categoryNameById = useMemo(() => {
    const map = new Map<number, string>();
    categories.forEach((category) => map.set(category.id, category.name));
    return map;
  }, [categories]);

  const ensureAdmin = async () => {
    try {
      const me = await getMe();
      const admin = Boolean(me?.permissions?.can_admin || me?.role === "admin");
      setCanAdmin(admin);
      setAccessDenied(!admin);
      return admin;
    } catch {
      setAccessDenied(true);
      setCanAdmin(false);
      return false;
    }
  };

  const loadAll = async () => {
    setLoading(true);
    try {
      const [categoriesResponse, propertiesResponse] = await Promise.all([
        fetch("/api/metadata/categories", { credentials: "include" }),
        fetch("/api/metadata/property-definitions", { credentials: "include" }),
      ]);

      const categoriesRaw = await categoriesResponse.text();
      const propertiesRaw = await propertiesResponse.text();

      if (!categoriesResponse.ok) {
        if (categoriesResponse.status === 401 || categoriesResponse.status === 403) {
          setAccessDenied(true);
          setCategories([]);
          return;
        }
        throw new Error(`(${categoriesResponse.status}) ${getErrorMessage(categoriesRaw, "Failed to load categories")}`);
      }

      if (!propertiesResponse.ok) {
        throw new Error(`(${propertiesResponse.status}) ${getErrorMessage(propertiesRaw, "Failed to load properties")}`);
      }

      const categoriesPayload = (parsePayload(categoriesRaw) as Category[] | null) || [];
      const propertiesPayload = (parsePayload(propertiesRaw) as PropertyDefinition[] | null) || [];

      setCategories(categoriesPayload);
      setProperties(propertiesPayload);
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to load metadata",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void (async () => {
      await ensureAdmin();
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
    const onPointerDown = (event: MouseEvent) => {
      if (openActionsId === null) return;
      const menu = actionMenuRefs.current[openActionsId];
      const target = event.target as Node;
      if (menu && !menu.contains(target)) {
        setOpenActionsId(null);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [openActionsId]);

  const filteredCategories = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return categories.filter((category) => {
      if (statusFilter === "active" && category.is_deprecated) return false;
      if (statusFilter === "published" && !category.is_published) return false;
      if (statusFilter === "deprecated" && !category.is_deprecated) return false;

      if (!normalizedQuery) return true;
      const haystack = [
        category.name,
        category.description || "",
        (category.applicable_scopes || []).join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [categories, query, statusFilter]);

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setDescription("");
    setScopes(["book"]);
    setParentIds([]);
    setPropertyIds([]);
  };

  const scopeLabel = (scope: string) => scopeLabelMap[scope] || scope;

  const toggleFromList = (id: number, values: number[], setter: (next: number[]) => void) => {
    if (values.includes(id)) {
      setter(values.filter((value) => value !== id));
      return;
    }
    setter([...values, id]);
  };

  const openCreate = () => {
    setModalMode("create");
    resetForm();
    setModalOpen(true);
  };

  const openCategory = (item: Category) => {
    setModalMode(canAdmin ? "edit" : "view");
    setEditingId(item.id);
    setName(item.name || "");
    setDescription(item.description || "");
    setScopes(item.applicable_scopes || ["book"]);
    setParentIds(item.parent_category_ids || []);
    setPropertyIds([]);
    setModalOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setToast(null);
    try {
      const isEdit = editingId !== null;

      if (isEdit) {
        const response = await fetch(`/api/metadata/categories/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim() || null,
            parent_category_ids: parentIds,
            applicable_scopes: scopes,
          }),
          credentials: "include",
        });

        const raw = await response.text();
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            setAccessDenied(true);
            return;
          }
          throw new Error(`(${response.status}) ${getErrorMessage(raw, "Failed to update category")}`);
        }

        setToast({ type: "success", message: "Category updated." });
      } else {
        const propertiesPayload = propertyIds.map((propertyId, index) => ({
          property_definition_id: propertyId,
          order: index,
          description_override: null,
          default_override: null,
          is_required_override: null,
        }));

        const payload: CategoryCreatePayload = {
          name: name.trim(),
          description: description.trim() || null,
          parent_category_ids: parentIds,
          applicable_scopes: scopes,
          properties: propertiesPayload,
        };

        const response = await fetch("/api/metadata/categories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          credentials: "include",
        });

        const raw = await response.text();
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            setAccessDenied(true);
            return;
          }
          throw new Error(`(${response.status}) ${getErrorMessage(raw, "Failed to create category")}`);
        }

        setToast({ type: "success", message: "Category created." });
      }

      setModalOpen(false);
      resetForm();
      await loadAll();
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to save category",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item: Category) => {
    if (!window.confirm(`Delete category "${item.name}"? This cannot be undone.`)) return;

    setDeletingId(item.id);
    setToast(null);
    try {
      const response = await fetch(`/api/metadata/categories/${item.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const raw = await response.text();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          return;
        }
        throw new Error(`(${response.status}) ${getErrorMessage(raw, "Failed to delete category")}`);
      }

      if (editingId === item.id) {
        setModalOpen(false);
        resetForm();
      }

      setToast({ type: "success", message: "Category deleted." });
      await loadAll();
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to delete category",
      });
    } finally {
      setDeletingId(null);
    }
  };

  const handlePublish = async (item: Category) => {
    setToast(null);
    try {
      const response = await fetch(`/api/metadata/categories/${item.id}/publish`, {
        method: "POST",
        credentials: "include",
      });
      const raw = await response.text();
      if (!response.ok) {
        throw new Error(`(${response.status}) ${getErrorMessage(raw, "Failed to publish category")}`);
      }
      setToast({ type: "success", message: "Category published." });
      await loadAll();
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to publish category",
      });
    }
  };

  const handleDeprecate = async (item: Category) => {
    setToast(null);
    try {
      const response = await fetch(`/api/metadata/categories/${item.id}/deprecate`, {
        method: "POST",
        credentials: "include",
      });
      const raw = await response.text();
      if (!response.ok) {
        throw new Error(`(${response.status}) ${getErrorMessage(raw, "Failed to deprecate category")}`);
      }
      setToast({ type: "success", message: "Category deprecated." });
      await loadAll();
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to deprecate category",
      });
    }
  };

  if (!authChecked) {
    return <main className="mx-auto w-full max-w-6xl px-4 py-6">Loading…</main>;
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-zinc-900">Categories</h1>
        <p className="text-sm text-zinc-600">Manage metadata categories in a searchable table view.</p>
      </header>

      <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
        <a href="/admin" className="rounded-full border border-black/10 bg-white px-3 py-1">Users</a>
        <a href="/admin/schemas" className="rounded-full border border-black/10 bg-white px-3 py-1">Schemas</a>
        <a href="/admin/metadata/properties" className="rounded-full border border-black/10 bg-white px-3 py-1">Properties</a>
        <a href="/admin/metadata/categories" className="rounded-full border border-[color:var(--accent)] bg-[color:var(--accent)]/10 px-3 py-1 text-[color:var(--accent)]">Categories</a>
      </div>

      {toast && (
        <div className={`rounded-lg border px-3 py-2 text-sm ${toast.type === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
          {toast.message}
        </div>
      )}

      {accessDenied && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          Admin access required.
          <Link className="ml-2 font-semibold underline" href="/signin">
            Sign in
          </Link>
        </div>
      )}

      <section className={`rounded-xl border border-black/10 bg-white p-4 space-y-3 ${accessDenied ? "pointer-events-none opacity-60" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-zinc-900">Categories</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search categories"
              className="rounded-lg border border-black/10 px-3 py-1.5 text-sm"
            />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "all" | "active" | "published" | "deprecated")}
              className="rounded-lg border border-black/10 px-2 py-1.5 text-sm"
            >
              <option value="all">All status</option>
              <option value="active">Active</option>
              <option value="published">Published</option>
              <option value="deprecated">Deprecated</option>
            </select>
            <button
              type="button"
              onClick={() => void loadAll()}
              className="rounded-lg border border-black/10 px-3 py-1.5 text-sm"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
            {canAdmin && (
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
        ) : filteredCategories.length === 0 ? (
          <p className="text-sm text-zinc-600">No categories found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left text-zinc-600">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Scopes</th>
                  <th className="px-3 py-2 font-medium">Version</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredCategories.map((item) => {
                  const canDelete = (!item.is_system && !item.is_published) || deletingId === item.id;
                  const actions = [
                    !item.is_published
                      ? {
                          key: "publish",
                          label: "Publish",
                          onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
                            event.stopPropagation();
                            setOpenActionsId(null);
                            void handlePublish(item);
                          },
                          className: "text-emerald-800 hover:bg-emerald-50",
                          disabled: false,
                        }
                      : null,
                    !item.is_deprecated
                      ? {
                          key: "deprecate",
                          label: "Deprecate",
                          onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
                            event.stopPropagation();
                            setOpenActionsId(null);
                            void handleDeprecate(item);
                          },
                          className: "text-amber-800 hover:bg-amber-50",
                          disabled: false,
                        }
                      : null,
                    canDelete
                      ? {
                          key: "delete",
                          label: deletingId === item.id ? "Deleting…" : "Delete",
                          onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
                            event.stopPropagation();
                            setOpenActionsId(null);
                            void handleDelete(item);
                          },
                          className: "text-red-700 hover:bg-red-50",
                          disabled: deletingId === item.id,
                        }
                      : null,
                  ].filter(Boolean) as Array<{
                    key: string;
                    label: string;
                    onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
                    className: string;
                    disabled: boolean;
                  }>;

                  return (
                  <tr key={item.id} onClick={() => openCategory(item)} className="cursor-pointer border-b border-black/5 hover:bg-zinc-50">
                    <td className="px-3 py-2 font-medium text-zinc-900">{item.name}</td>
                    <td className="px-3 py-2 text-zinc-700">{(item.applicable_scopes || []).join(", ") || "—"}</td>
                    <td className="px-3 py-2 text-zinc-700">v{item.version}</td>
                    <td className="px-3 py-2 text-zinc-700">
                      {item.is_deprecated ? "Deprecated" : item.is_published ? "Published" : "Draft"}
                    </td>
                    <td className="px-3 py-2">
                      {canAdmin ? actions.length > 1 ? (
                        <div
                          ref={(element) => {
                            actionMenuRefs.current[item.id] = element;
                          }}
                          className="relative"
                        >
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setOpenActionsId((prev) => (prev === item.id ? null : item.id));
                            }}
                            aria-label="Category actions"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-black/10 bg-white/80 text-zinc-700 transition hover:border-black/20 hover:bg-zinc-50"
                          >
                            <MoreVertical size={16} />
                          </button>
                          {openActionsId === item.id && (
                            <div className="absolute right-0 z-40 mt-2 w-44 rounded-xl border border-black/10 bg-white p-1 shadow-xl">
                              {actions.map((action) => (
                                <button
                                  key={action.key}
                                  type="button"
                                  onClick={action.onClick}
                                  disabled={action.disabled}
                                  className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition ${action.className} disabled:cursor-not-allowed disabled:opacity-50`}
                                >
                                  {action.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : actions.length === 1 ? (
                        <button
                          type="button"
                          onClick={actions[0].onClick}
                          disabled={actions[0].disabled}
                          className={`rounded-md border px-2.5 py-1 text-xs disabled:opacity-50 ${
                            actions[0].key === "delete"
                              ? "border-red-200 text-red-700"
                              : actions[0].key === "deprecate"
                              ? "border-amber-200 text-amber-800"
                              : "border-emerald-200 text-emerald-800"
                          }`}
                        >
                          {actions[0].label}
                        </button>
                      ) : null : null}
                    </td>
                  </tr>
                );})}
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
                {modalMode === "create" ? "Create category" : modalMode === "edit" ? "Edit category" : "View category"}
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
              Applicable scopes
              <select
                multiple
                value={scopes}
                onChange={(event) =>
                  setScopes(Array.from(event.target.selectedOptions).map((option) => option.value))
                }
                disabled={modalMode === "view"}
                className="mt-1 min-h-[100px] w-full rounded-lg border border-black/10 px-3 py-2 text-sm disabled:bg-zinc-100"
              >
                {scopeOptions.map((scope) => (
                  <option key={scope} value={scope}>
                    {scopeLabel(scope)}
                  </option>
                ))}
              </select>
            </label>

            <div className="mt-3 rounded-lg border border-black/10 p-3">
              <p className="text-sm font-medium text-zinc-900">Parent categories</p>
              <div className="mt-2 max-h-32 overflow-auto space-y-2">
                {categories
                  .filter((item) => item.id !== editingId)
                  .map((item) => (
                    <label key={item.id} className="inline-flex w-full items-center gap-2 text-sm text-zinc-700">
                      <input
                        type="checkbox"
                        checked={parentIds.includes(item.id)}
                        onChange={() => toggleFromList(item.id, parentIds, setParentIds)}
                        disabled={modalMode === "view"}
                      />
                      {item.name}
                    </label>
                  ))}
              </div>
            </div>

            {modalMode === "create" && (
              <div className="mt-3 rounded-lg border border-black/10 p-3">
                <p className="text-sm font-medium text-zinc-900">Assign properties</p>
                <div className="mt-2 max-h-40 overflow-auto space-y-2">
                  {activeProperties.map((property) => (
                    <label key={property.id} className="inline-flex w-full items-center gap-2 text-sm text-zinc-700">
                      <input
                        type="checkbox"
                        checked={propertyIds.includes(property.id)}
                        onChange={() => toggleFromList(property.id, propertyIds, setPropertyIds)}
                      />
                      {property.display_name}
                      <span className="text-xs text-zinc-500">({property.internal_name})</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {modalMode !== "create" && (
              <div className="mt-3 rounded-lg border border-black/10 bg-zinc-50 p-3 text-xs text-zinc-600">
                Property assignments are set at category creation time in this manager.
              </div>
            )}

            {editingId && (
              <div className="mt-3 rounded-lg border border-black/10 p-3 text-sm text-zinc-600">
                Parent labels: {parentIds.map((id) => categoryNameById.get(id) || `#${id}`).join(", ") || "None"}
              </div>
            )}

            {modalMode !== "view" ? (
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || !name.trim() || scopes.length === 0}
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
