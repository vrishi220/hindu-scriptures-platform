"use client";

import { useEffect, useMemo, useState } from "react";
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
    default_override: string | null;
    is_required_override: boolean | null;
  }>;
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

export default function MetadataCategoriesAdminPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [properties, setProperties] = useState<PropertyDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createScopes, setCreateScopes] = useState<string[]>(["book"]);
  const [createParentIds, setCreateParentIds] = useState<number[]>([]);
  const [createPropertyIds, setCreatePropertyIds] = useState<number[]>([]);

  const [selected, setSelected] = useState<Category | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editScopes, setEditScopes] = useState<string[]>(["book"]);
  const [editParentIds, setEditParentIds] = useState<number[]>([]);

  const scopeOptions = useMemo(() => {
    const baseScopes = ["all", "book", "level", "node", "global"];
    const combined = new Set<string>([...baseScopes, ...createScopes, ...editScopes]);
    categories.forEach((category) => {
      (category.applicable_scopes || []).forEach((scope) => {
        if (scope) combined.add(scope);
      });
    });
    return Array.from(combined).sort((left, right) => left.localeCompare(right));
  }, [categories, createScopes, editScopes]);

  const categoryNameById = useMemo(() => {
    const map = new Map<number, string>();
    categories.forEach((category) => map.set(category.id, category.name));
    return map;
  }, [categories]);

  const activeProperties = useMemo(
    () => properties.filter((property) => !property.is_deprecated),
    [properties]
  );

  const ensureAdmin = async () => {
    try {
      const me = await getMe();
      const canAdmin = Boolean(me?.permissions?.can_admin || me?.role === "admin");
      setAccessDenied(!canAdmin);
      return canAdmin;
    } catch {
      setAccessDenied(true);
      return false;
    }
  };

  const loadAll = async () => {
    setLoading(true);
    setToast(null);
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

      if (selected) {
        const refreshed = categoriesPayload.find((item) => item.id === selected.id) || null;
        setSelected(refreshed);
        if (refreshed) {
          setEditName(refreshed.name || "");
          setEditDescription(refreshed.description || "");
          setEditScopes(refreshed.applicable_scopes || ["book"]);
          setEditParentIds(refreshed.parent_category_ids || []);
        }
      }
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
      const canProceed = await ensureAdmin();
      if (canProceed) {
        await loadAll();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const getSelectedValues = (event: React.ChangeEvent<HTMLSelectElement>) =>
    Array.from(event.target.selectedOptions).map((option) => option.value);

  const toggleFromList = (
    id: number,
    values: number[],
    setter: (next: number[]) => void
  ) => {
    if (values.includes(id)) {
      setter(values.filter((value) => value !== id));
      return;
    }
    setter([...values, id]);
  };

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setToast(null);
    try {
      const propertiesPayload = createPropertyIds.map((propertyId, index) => ({
        property_definition_id: propertyId,
        order: index,
        description_override: null,
        default_override: null,
        is_required_override: null,
      }));

      const payload: CategoryCreatePayload = {
        name: createName.trim(),
        description: createDescription.trim() || null,
        parent_category_ids: createParentIds,
        applicable_scopes: createScopes,
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

      setCreateName("");
      setCreateDescription("");
      setCreateScopes(["book"]);
      setCreateParentIds([]);
      setCreatePropertyIds([]);
      setToast({ type: "success", message: "Category created." });
      await loadAll();
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to create category",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSelectCategory = (item: Category) => {
    setSelected(item);
    setEditName(item.name || "");
    setEditDescription(item.description || "");
    setEditScopes(item.applicable_scopes || ["book"]);
    setEditParentIds(item.parent_category_ids || []);
  };

  const handleUpdateSelected = async () => {
    if (!selected) return;
    setSaving(true);
    setToast(null);

    try {
      const response = await fetch(`/api/metadata/categories/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim() || null,
          parent_category_ids: editParentIds,
          applicable_scopes: editScopes,
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
      await loadAll();
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to update category",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (!selected) return;
    if (!window.confirm("Delete this category? This cannot be undone.")) return;

    setSaving(true);
    setToast(null);
    try {
      const response = await fetch(`/api/metadata/categories/${selected.id}`, {
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

      setSelected(null);
      setEditName("");
      setEditDescription("");
      setEditScopes(["book"]);
      setEditParentIds([]);
      setToast({ type: "success", message: "Category deleted." });
      await loadAll();
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to delete category",
      });
    } finally {
      setSaving(false);
    }
  };

  const handlePublishSelected = async () => {
    if (!selected) return;
    setSaving(true);
    setToast(null);

    try {
      const response = await fetch(`/api/metadata/categories/${selected.id}/publish`, {
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
    } finally {
      setSaving(false);
    }
  };

  const handleDeprecateSelected = async () => {
    if (!selected) return;
    setSaving(true);
    setToast(null);

    try {
      const response = await fetch(`/api/metadata/categories/${selected.id}/deprecate`, {
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
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grainy-bg min-h-screen">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 pb-20 pt-12">
        <header className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Metadata</p>
          <h1 className="font-[var(--font-display)] text-4xl text-[color:var(--deep)]">
            Categories
          </h1>
          <p className="max-w-2xl text-sm text-zinc-600">
            Define metadata categories, parent inheritance, and category property sets.
          </p>
          <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
            <a href="/admin" className="rounded-full border border-black/10 bg-white/80 px-3 py-1">Users</a>
            <a href="/admin/schemas" className="rounded-full border border-black/10 bg-white/80 px-3 py-1">Schemas</a>
            <a href="/admin/metadata/properties" className="rounded-full border border-black/10 bg-white/80 px-3 py-1">Properties</a>
            <a href="/admin/metadata/categories" className="rounded-full border border-[color:var(--accent)] bg-[color:var(--accent)]/10 px-3 py-1 text-[color:var(--accent)]">Categories</a>
          </div>
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
            Admin access required.
          </div>
        )}

        <section className="grid gap-6 lg:grid-cols-2">
          <div className={`rounded-[32px] border border-black/10 bg-white/80 p-6 shadow-lg ${accessDenied ? "pointer-events-none opacity-60" : ""}`}>
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">Create category</h2>
            <form className="mt-4 grid gap-4" onSubmit={handleCreate}>
              <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                Name
                <input
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                  className="rounded-xl border border-black/10 bg-white/90 px-3 py-2 text-sm text-zinc-700 outline-none focus:border-[color:var(--accent)]"
                  required
                />
              </label>
              <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                Description
                <textarea
                  value={createDescription}
                  onChange={(event) => setCreateDescription(event.target.value)}
                  className="min-h-[84px] rounded-xl border border-black/10 bg-white/90 px-3 py-2 text-sm text-zinc-700 outline-none focus:border-[color:var(--accent)]"
                />
              </label>
              <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                Applicable Scopes
                <select
                  multiple
                  value={createScopes}
                  onChange={(event) => setCreateScopes(getSelectedValues(event))}
                  className="min-h-[112px] rounded-xl border border-black/10 bg-white/90 px-3 py-2 text-sm text-zinc-700 outline-none focus:border-[color:var(--accent)]"
                  required
                >
                  {scopeOptions.map((scope) => (
                    <option key={scope} value={scope}>
                      {scope}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] normal-case tracking-normal text-zinc-500">Hold Command/Ctrl to select multiple scopes.</p>
              </label>

              <div className="grid gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Parent categories</p>
                <div className="max-h-32 overflow-auto rounded-xl border border-black/10 bg-white/80 p-3">
                  <div className="grid gap-2">
                    {categories.map((item) => (
                      <label key={item.id} className="inline-flex items-center gap-2 text-sm text-zinc-700">
                        <input
                          type="checkbox"
                          checked={createParentIds.includes(item.id)}
                          onChange={() => toggleFromList(item.id, createParentIds, setCreateParentIds)}
                          className="h-4 w-4 rounded border-black/20 text-[color:var(--accent)]"
                        />
                        {item.name}
                      </label>
                    ))}
                    {!categories.length && <p className="text-xs text-zinc-500">No categories yet.</p>}
                  </div>
                </div>
              </div>

              <div className="grid gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Assign properties</p>
                <div className="max-h-40 overflow-auto rounded-xl border border-black/10 bg-white/80 p-3">
                  <div className="grid gap-2">
                    {activeProperties.map((property) => (
                      <label key={property.id} className="inline-flex items-center gap-2 text-sm text-zinc-700">
                        <input
                          type="checkbox"
                          checked={createPropertyIds.includes(property.id)}
                          onChange={() => toggleFromList(property.id, createPropertyIds, setCreatePropertyIds)}
                          className="h-4 w-4 rounded border-black/20 text-[color:var(--accent)]"
                        />
                        {property.display_name}
                        <span className="text-xs text-zinc-500">({property.internal_name})</span>
                      </label>
                    ))}
                    {!activeProperties.length && <p className="text-xs text-zinc-500">No active properties available.</p>}
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="rounded-xl border border-emerald-600 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Saving..." : "Create Category"}
              </button>
            </form>
          </div>

          <div className={`rounded-[32px] border border-black/10 bg-white/80 p-6 shadow-lg ${accessDenied ? "pointer-events-none opacity-60" : ""}`}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">Categories</h2>
              <button
                onClick={() => loadAll()}
                className="rounded-full border border-black/10 bg-white/80 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-zinc-600"
              >
                {loading ? "Loading..." : "Refresh"}
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              {categories.map((category) => (
                <button
                  type="button"
                  key={category.id}
                  onClick={() => handleSelectCategory(category)}
                  className={`rounded-2xl border px-4 py-3 text-left transition ${
                    selected?.id === category.id
                      ? "border-[color:var(--accent)] bg-[color:var(--accent)]/5"
                      : "border-black/10 bg-white/90"
                  }`}
                >
                  <p className="text-sm font-semibold text-[color:var(--deep)]">{category.name}</p>
                  <p className="text-xs text-zinc-500">v{category.version} · scopes: {(category.applicable_scopes || []).join(", ") || "none"}</p>
                  {category.parent_category_ids?.length > 0 && (
                    <p className="mt-1 text-xs text-zinc-500">
                      parents: {category.parent_category_ids.map((id) => categoryNameById.get(id) || `#${id}`).join(", ")}
                    </p>
                  )}
                  <div className="mt-2 flex gap-2">
                    {category.is_system && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-zinc-600">System</span>}
                    {category.is_published && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-emerald-700">Published</span>}
                    {category.is_deprecated && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-amber-700">Deprecated</span>}
                  </div>
                </button>
              ))}
              {!categories.length && <p className="text-sm text-zinc-500">No categories yet.</p>}
            </div>

            {selected && (
              <div className="mt-6 rounded-2xl border border-black/10 bg-zinc-50/70 p-4">
                <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Edit selected</h3>
                <div className="mt-3 grid gap-3">
                  <label className="grid gap-1 text-xs uppercase tracking-[0.14em] text-zinc-500">
                    Name
                    <input
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      disabled={selected.is_published}
                      className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-zinc-700 outline-none focus:border-[color:var(--accent)] disabled:bg-zinc-100 disabled:text-zinc-500"
                    />
                  </label>
                  <label className="grid gap-1 text-xs uppercase tracking-[0.14em] text-zinc-500">
                    Description
                    <textarea
                      value={editDescription}
                      onChange={(event) => setEditDescription(event.target.value)}
                      disabled={selected.is_published}
                      className="min-h-[72px] rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-zinc-700 outline-none focus:border-[color:var(--accent)] disabled:bg-zinc-100 disabled:text-zinc-500"
                    />
                  </label>
                  <label className="grid gap-1 text-xs uppercase tracking-[0.14em] text-zinc-500">
                    Applicable Scopes
                    <select
                      multiple
                      value={editScopes}
                      onChange={(event) => setEditScopes(getSelectedValues(event))}
                      disabled={selected.is_published}
                      className="min-h-[112px] rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-zinc-700 outline-none focus:border-[color:var(--accent)] disabled:bg-zinc-100 disabled:text-zinc-500"
                    >
                      {scopeOptions.map((scope) => (
                        <option key={scope} value={scope}>
                          {scope}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] normal-case tracking-normal text-zinc-500">Hold Command/Ctrl to select multiple scopes.</p>
                  </label>

                  <div className="grid gap-1">
                    <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Parent categories</p>
                    <div className="max-h-28 overflow-auto rounded-xl border border-black/10 bg-white/90 p-3">
                      <div className="grid gap-2">
                        {categories
                          .filter((item) => item.id !== selected.id)
                          .map((item) => (
                            <label key={item.id} className="inline-flex items-center gap-2 text-sm text-zinc-700">
                              <input
                                type="checkbox"
                                checked={editParentIds.includes(item.id)}
                                onChange={() => toggleFromList(item.id, editParentIds, setEditParentIds)}
                                disabled={selected.is_published}
                                className="h-4 w-4 rounded border-black/20 text-[color:var(--accent)]"
                              />
                              {item.name}
                            </label>
                          ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleUpdateSelected}
                      disabled={saving || selected.is_published}
                      className="rounded-xl border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={handlePublishSelected}
                      disabled={saving || selected.is_published}
                      className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Publish
                    </button>
                    <button
                      type="button"
                      onClick={handleDeprecateSelected}
                      disabled={saving || selected.is_deprecated}
                      className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Deprecate
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteSelected}
                      disabled={saving || selected.is_system || selected.is_published}
                      className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
