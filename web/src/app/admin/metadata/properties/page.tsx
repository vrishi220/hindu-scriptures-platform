"use client";

import { useEffect, useState } from "react";
import { getMe } from "@/lib/authClient";

type Toast = {
  type: "success" | "error";
  message: string;
};

type PropertyDataType = "text" | "boolean" | "number" | "dropdown" | "date" | "datetime";

type PropertyDefinition = {
  id: number;
  internal_name: string;
  display_name: string;
  data_type: PropertyDataType;
  description?: string | null;
  default_value?: string | boolean | number | Record<string, unknown> | null;
  is_required: boolean;
  dropdown_options?: string[] | null;
  is_system: boolean;
  is_deprecated: boolean;
  deprecated_at?: string | null;
};

type PropertyCreatePayload = {
  internal_name: string;
  display_name: string;
  data_type: PropertyDataType;
  description: string | null;
  default_value: string | boolean | number | null;
  is_required: boolean;
  dropdown_options: string[] | null;
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

const defaultPayload: PropertyCreatePayload = {
  internal_name: "",
  display_name: "",
  data_type: "text",
  description: null,
  default_value: null,
  is_required: false,
  dropdown_options: null,
};

export default function MetadataPropertiesAdminPage() {
  const [items, setItems] = useState<PropertyDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const [createForm, setCreateForm] = useState<PropertyCreatePayload>(defaultPayload);
  const [createDropdownInput, setCreateDropdownInput] = useState("");

  const [selected, setSelected] = useState<PropertyDefinition | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editDescription, setEditDescription] = useState("");

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

  const loadProperties = async () => {
    setLoading(true);
    setToast(null);
    try {
      const response = await fetch("/api/metadata/property-definitions", {
        credentials: "include",
      });
      const raw = await response.text();
      const payload = parsePayload(raw) as PropertyDefinition[] | null;

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          setItems([]);
          return;
        }
        throw new Error(`(${response.status}) ${getErrorMessage(raw, "Failed to load properties")}`);
      }

      setItems(payload || []);
      if (selected) {
        const refreshed = (payload || []).find((item) => item.id === selected.id) || null;
        setSelected(refreshed);
        if (refreshed) {
          setEditDisplayName(refreshed.display_name || "");
          setEditDescription(refreshed.description || "");
        }
      }
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to load properties",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void (async () => {
      const canProceed = await ensureAdmin();
      if (canProceed) {
        await loadProperties();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const parseDefaultValue = (value: string, dataType: PropertyDataType) => {
    if (value.trim() === "") return null;
    if (dataType === "number") {
      const numeric = Number(value);
      if (Number.isNaN(numeric)) throw new Error("Default value must be numeric");
      return numeric;
    }
    if (dataType === "boolean") {
      if (value.toLowerCase() === "true") return true;
      if (value.toLowerCase() === "false") return false;
      throw new Error("Boolean default must be true or false");
    }
    return value;
  };

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setToast(null);

    try {
      const dropdownOptions =
        createForm.data_type === "dropdown"
          ? createDropdownInput
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean)
          : null;

      const payload: PropertyCreatePayload = {
        ...createForm,
        internal_name: createForm.internal_name.trim(),
        display_name: createForm.display_name.trim(),
        description: createForm.description?.trim() || null,
        default_value: parseDefaultValue(String(createForm.default_value ?? ""), createForm.data_type),
        dropdown_options: dropdownOptions,
      };

      const response = await fetch("/api/metadata/property-definitions", {
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
        throw new Error(`(${response.status}) ${getErrorMessage(raw, "Failed to create property")}`);
      }

      setCreateForm(defaultPayload);
      setCreateDropdownInput("");
      setToast({ type: "success", message: "Property created." });
      await loadProperties();
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to create property",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSelected = async () => {
    if (!selected) return;
    setSaving(true);
    setToast(null);

    try {
      const response = await fetch(`/api/metadata/property-definitions/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: editDisplayName.trim(),
          description: editDescription.trim() || null,
        }),
        credentials: "include",
      });
      const raw = await response.text();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          return;
        }
        throw new Error(`(${response.status}) ${getErrorMessage(raw, "Failed to update property")}`);
      }

      setToast({ type: "success", message: "Property updated." });
      await loadProperties();
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to update property",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (!selected) return;
    if (!window.confirm("Delete this property definition? This cannot be undone.")) return;

    setSaving(true);
    setToast(null);
    try {
      const response = await fetch(`/api/metadata/property-definitions/${selected.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const raw = await response.text();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          return;
        }
        throw new Error(`(${response.status}) ${getErrorMessage(raw, "Failed to delete property")}`);
      }

      setToast({ type: "success", message: "Property deleted." });
      setSelected(null);
      setEditDisplayName("");
      setEditDescription("");
      await loadProperties();
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to delete property",
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
      const response = await fetch(`/api/metadata/property-definitions/${selected.id}/deprecate`, {
        method: "POST",
        credentials: "include",
      });
      const raw = await response.text();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          return;
        }
        throw new Error(`(${response.status}) ${getErrorMessage(raw, "Failed to deprecate property")}`);
      }

      setToast({ type: "success", message: "Property deprecated." });
      await loadProperties();
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to deprecate property",
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
            Property definitions
          </h1>
          <p className="max-w-2xl text-sm text-zinc-600">
            Define reusable metadata properties for category assignment.
          </p>
          <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
            <a href="/admin" className="rounded-full border border-black/10 bg-white/80 px-3 py-1">Users</a>
            <a href="/admin/schemas" className="rounded-full border border-black/10 bg-white/80 px-3 py-1">Schemas</a>
            <a href="/admin/metadata/properties" className="rounded-full border border-[color:var(--accent)] bg-[color:var(--accent)]/10 px-3 py-1 text-[color:var(--accent)]">Properties</a>
            <a href="/admin/metadata/categories" className="rounded-full border border-black/10 bg-white/80 px-3 py-1">Categories</a>
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
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">Create property</h2>
            <form className="mt-4 grid gap-4" onSubmit={handleCreate}>
              <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                Internal Name
                <input
                  value={createForm.internal_name}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, internal_name: event.target.value }))}
                  className="rounded-xl border border-black/10 bg-white/90 px-3 py-2 text-sm text-zinc-700 outline-none focus:border-[color:var(--accent)]"
                  placeholder="chapter_label"
                  required
                />
              </label>
              <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                Display Name
                <input
                  value={createForm.display_name}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, display_name: event.target.value }))}
                  className="rounded-xl border border-black/10 bg-white/90 px-3 py-2 text-sm text-zinc-700 outline-none focus:border-[color:var(--accent)]"
                  placeholder="Chapter Label"
                  required
                />
              </label>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                  Data Type
                  <select
                    value={createForm.data_type}
                    onChange={(event) => setCreateForm((prev) => ({ ...prev, data_type: event.target.value as PropertyDataType }))}
                    className="rounded-xl border border-black/10 bg-white/90 px-3 py-2 text-sm text-zinc-700 outline-none focus:border-[color:var(--accent)]"
                  >
                    <option value="text">Text</option>
                    <option value="boolean">Boolean</option>
                    <option value="number">Number</option>
                    <option value="dropdown">Dropdown</option>
                    <option value="date">Date</option>
                    <option value="datetime">Datetime</option>
                  </select>
                </label>
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                  Default Value
                  <input
                    value={createForm.default_value == null ? "" : String(createForm.default_value)}
                    onChange={(event) => setCreateForm((prev) => ({ ...prev, default_value: event.target.value }))}
                    className="rounded-xl border border-black/10 bg-white/90 px-3 py-2 text-sm text-zinc-700 outline-none focus:border-[color:var(--accent)]"
                    placeholder={createForm.data_type === "boolean" ? "true | false" : "Optional"}
                  />
                </label>
              </div>
              {createForm.data_type === "dropdown" && (
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                  Dropdown Options (comma separated)
                  <input
                    value={createDropdownInput}
                    onChange={(event) => setCreateDropdownInput(event.target.value)}
                    className="rounded-xl border border-black/10 bg-white/90 px-3 py-2 text-sm text-zinc-700 outline-none focus:border-[color:var(--accent)]"
                    placeholder="small, medium, large"
                    required
                  />
                </label>
              )}
              <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                Description
                <textarea
                  value={createForm.description || ""}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, description: event.target.value }))}
                  className="min-h-[88px] rounded-xl border border-black/10 bg-white/90 px-3 py-2 text-sm text-zinc-700 outline-none focus:border-[color:var(--accent)]"
                />
              </label>
              <label className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                <input
                  type="checkbox"
                  checked={createForm.is_required}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, is_required: event.target.checked }))}
                  className="h-4 w-4 rounded border-black/20 text-[color:var(--accent)]"
                />
                Required
              </label>
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl border border-emerald-600 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Saving..." : "Create Property"}
              </button>
            </form>
          </div>

          <div className={`rounded-[32px] border border-black/10 bg-white/80 p-6 shadow-lg ${accessDenied ? "pointer-events-none opacity-60" : ""}`}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">Properties</h2>
              <button
                onClick={() => loadProperties()}
                className="rounded-full border border-black/10 bg-white/80 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-zinc-600"
              >
                Refresh
              </button>
            </div>
            {loading ? (
              <p className="mt-4 text-sm text-zinc-500">Loading...</p>
            ) : (
              <div className="mt-4 grid gap-3">
                {items.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => {
                      setSelected(item);
                      setEditDisplayName(item.display_name || "");
                      setEditDescription(item.description || "");
                    }}
                    className={`rounded-2xl border px-4 py-3 text-left transition ${
                      selected?.id === item.id
                        ? "border-[color:var(--accent)] bg-[color:var(--accent)]/5"
                        : "border-black/10 bg-white/90"
                    }`}
                  >
                    <p className="text-sm font-semibold text-[color:var(--deep)]">{item.display_name}</p>
                    <p className="text-xs text-zinc-500">{item.internal_name} · {item.data_type}</p>
                    <div className="mt-2 flex gap-2">
                      {item.is_system && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-zinc-600">System</span>}
                      {item.is_deprecated && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-amber-700">Deprecated</span>}
                      {item.is_required && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-emerald-700">Required</span>}
                    </div>
                  </button>
                ))}
                {!items.length && <p className="text-sm text-zinc-500">No properties yet.</p>}
              </div>
            )}

            {selected && (
              <div className="mt-6 rounded-2xl border border-black/10 bg-zinc-50/70 p-4">
                <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Edit selected</h3>
                <div className="mt-3 grid gap-3">
                  <label className="grid gap-1 text-xs uppercase tracking-[0.14em] text-zinc-500">
                    Internal Name
                    <input
                      value={selected.internal_name}
                      disabled
                      className="rounded-xl border border-black/10 bg-zinc-100 px-3 py-2 text-sm text-zinc-500"
                    />
                  </label>
                  <label className="grid gap-1 text-xs uppercase tracking-[0.14em] text-zinc-500">
                    Display Name
                    <input
                      value={editDisplayName}
                      onChange={(event) => setEditDisplayName(event.target.value)}
                      className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-zinc-700 outline-none focus:border-[color:var(--accent)]"
                    />
                  </label>
                  <label className="grid gap-1 text-xs uppercase tracking-[0.14em] text-zinc-500">
                    Description
                    <textarea
                      value={editDescription}
                      onChange={(event) => setEditDescription(event.target.value)}
                      className="min-h-[78px] rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-zinc-700 outline-none focus:border-[color:var(--accent)]"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleSaveSelected}
                      disabled={saving}
                      className="rounded-xl border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Save
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
                      disabled={saving || selected.is_system}
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
