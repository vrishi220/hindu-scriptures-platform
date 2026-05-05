"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MoreVertical } from "lucide-react";
import { getMe } from "@/lib/authClient";
import InlineClearButton from "@/components/InlineClearButton";

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
};

type PropertyCreatePayload = {
  internal_name: string;
  display_name: string;
  data_type: PropertyDataType;
  description: string | null;
  default_value: string | boolean | number | Record<string, unknown> | null;
  is_required: boolean;
  dropdown_options: string[] | null;
};

type ModalMode = "create" | "edit" | "view";

const defaultPayload: PropertyCreatePayload = {
  internal_name: "",
  display_name: "",
  data_type: "text",
  description: null,
  default_value: null,
  is_required: false,
  dropdown_options: null,
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

export default function MetadataPropertiesAdminPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [canAdmin, setCanAdmin] = useState(false);

  const [items, setItems] = useState<PropertyDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [openActionsId, setOpenActionsId] = useState<number | null>(null);
  const actionMenuRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | PropertyDataType>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "deprecated">("all");

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>("create");
  const [editingId, setEditingId] = useState<number | null>(null);

  const [form, setForm] = useState<PropertyCreatePayload>(defaultPayload);
  const [dropdownInput, setDropdownInput] = useState("");

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

  const loadProperties = async () => {
    setLoading(true);
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
      await ensureAdmin();
      await loadProperties();
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

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      if (typeFilter !== "all" && item.data_type !== typeFilter) return false;
      if (statusFilter === "active" && item.is_deprecated) return false;
      if (statusFilter === "deprecated" && !item.is_deprecated) return false;
      if (!normalizedQuery) return true;

      const haystack = [item.display_name, item.internal_name, item.description || "", item.data_type]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [items, query, typeFilter, statusFilter]);

  const resetForm = () => {
    setEditingId(null);
    setForm(defaultPayload);
    setDropdownInput("");
  };

  const openCreate = () => {
    setModalMode("create");
    resetForm();
    setModalOpen(true);
  };

  const openItem = (item: PropertyDefinition) => {
    setModalMode(canAdmin ? "edit" : "view");
    setEditingId(item.id);
    setForm({
      internal_name: item.internal_name,
      display_name: item.display_name,
      data_type: item.data_type,
      description: item.description || null,
      default_value: item.default_value ?? null,
      is_required: item.is_required,
      dropdown_options: item.dropdown_options || null,
    });
    setDropdownInput((item.dropdown_options || []).join(", "));
    setModalOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setToast(null);
    try {
      const isEdit = editingId !== null;
      const dropdownOptions =
        form.data_type === "dropdown"
          ? dropdownInput
              .split(",")
              .map((entry) => entry.trim())
              .filter(Boolean)
          : null;

      if (!isEdit && (!form.internal_name.trim() || !form.display_name.trim())) {
        throw new Error("Internal name and display name are required");
      }

      if (isEdit) {
        const response = await fetch(`/api/metadata/property-definitions/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            display_name: form.display_name.trim(),
            description: form.description?.trim() || null,
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
      } else {
        const payload: PropertyCreatePayload = {
          ...form,
          internal_name: form.internal_name.trim(),
          display_name: form.display_name.trim(),
          description: form.description?.trim() || null,
          default_value: parseDefaultValue(String(form.default_value ?? ""), form.data_type),
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

        setToast({ type: "success", message: "Property created." });
      }

      setModalOpen(false);
      resetForm();
      await loadProperties();
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to save property",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item: PropertyDefinition) => {
    if (!window.confirm(`Delete property "${item.display_name}"? This cannot be undone.`)) return;

    setDeletingId(item.id);
    setToast(null);
    try {
      const response = await fetch(`/api/metadata/property-definitions/${item.id}`, {
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

      if (editingId === item.id) {
        setModalOpen(false);
        resetForm();
      }

      setToast({ type: "success", message: "Property deleted." });
      await loadProperties();
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to delete property",
      });
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeprecate = async (item: PropertyDefinition) => {
    setToast(null);
    try {
      const response = await fetch(`/api/metadata/property-definitions/${item.id}/deprecate`, {
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
    }
  };

  if (!authChecked) {
    return <main className="mx-auto w-full max-w-6xl px-4 py-6">Loading…</main>;
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-zinc-900">Properties</h1>
        <p className="text-sm text-zinc-600">Manage metadata property definitions in a searchable table.</p>
      </header>

      <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
        <a href="/admin" className="rounded-full border border-black/10 bg-white px-3 py-1">Users</a>
        <a href="/admin/ai-generation" className="rounded-full border border-black/10 bg-white px-3 py-1">AI Generation</a>
        <a href="/admin/schemas" className="rounded-full border border-black/10 bg-white px-3 py-1">Schemas</a>
        <a href="/admin/import" className="rounded-full border border-black/10 bg-white px-3 py-1">Import</a>
        <a href="/admin/metadata/properties" className="rounded-full border border-[color:var(--accent)] bg-[color:var(--accent)]/10 px-3 py-1 text-[color:var(--accent)]">Properties</a>
        <a href="/admin/metadata/categories" className="rounded-full border border-black/10 bg-white px-3 py-1">Categories</a>
        <a href="/admin/media-bank" className="rounded-full border border-black/10 bg-white px-3 py-1">Multimedia Repo        </a>
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
          <h2 className="text-base font-semibold text-zinc-900">Property Definitions</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="group relative">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search properties"
                className="rounded-lg border border-black/10 px-3 py-1.5 pr-10 text-sm"
              />
              <InlineClearButton
                visible={Boolean(query)}
                onClear={() => setQuery("")}
                ariaLabel="Clear properties search"
              />
            </div>
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as "all" | PropertyDataType)}
              className="rounded-lg border border-black/10 px-2 py-1.5 text-sm"
            >
              <option value="all">All types</option>
              <option value="text">Text</option>
              <option value="boolean">Boolean</option>
              <option value="number">Number</option>
              <option value="dropdown">Dropdown</option>
              <option value="date">Date</option>
              <option value="datetime">Datetime</option>
            </select>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "all" | "active" | "deprecated")}
              className="rounded-lg border border-black/10 px-2 py-1.5 text-sm"
            >
              <option value="all">All status</option>
              <option value="active">Active</option>
              <option value="deprecated">Deprecated</option>
            </select>
            <button
              type="button"
              onClick={() => void loadProperties()}
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
        ) : filteredItems.length === 0 ? (
          <p className="text-sm text-zinc-600">No properties found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left text-zinc-600">
                  <th className="px-3 py-2 font-medium">Display Name</th>
                  <th className="px-3 py-2 font-medium">Internal Name</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const canDelete = !item.is_system || deletingId === item.id;
                  const actions: Array<{
                    key: "deprecate" | "delete";
                    label: string;
                    onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
                    disabled: boolean;
                    className: string;
                  }> = [];

                  if (canAdmin && !item.is_deprecated) {
                    actions.push({
                      key: "deprecate",
                      label: "Deprecate",
                      onClick: (event) => {
                        event.stopPropagation();
                        setOpenActionsId(null);
                        void handleDeprecate(item);
                      },
                      disabled: false,
                      className: "text-amber-800 hover:bg-amber-50",
                    });
                  }

                  if (canAdmin && canDelete) {
                    actions.push({
                      key: "delete",
                      label: deletingId === item.id ? "Deleting…" : "Delete",
                      onClick: (event) => {
                        event.stopPropagation();
                        setOpenActionsId(null);
                        void handleDelete(item);
                      },
                      disabled: deletingId === item.id,
                      className: "text-red-700 hover:bg-red-50",
                    });
                  }

                  return (
                  <tr key={item.id} onClick={() => openItem(item)} className="cursor-pointer border-b border-black/5 hover:bg-zinc-50">
                    <td className="px-3 py-2 font-medium text-zinc-900">{item.display_name}</td>
                    <td className="px-3 py-2 text-zinc-700">{item.internal_name}</td>
                    <td className="px-3 py-2 text-zinc-700">{item.data_type}</td>
                    <td className="px-3 py-2 text-zinc-700">
                      {item.is_deprecated ? "Deprecated" : "Active"}
                    </td>
                    <td className="px-3 py-2">
                      {actions.length > 1 ? (
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
                            aria-label="Property actions"
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
                              : "border-amber-200 text-amber-800"
                          }`}
                        >
                          {actions[0].label}
                        </button>
                      ) : null}
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
                {modalMode === "create" ? "Create property" : modalMode === "edit" ? "Edit property" : "View property"}
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
                Internal Name
                <input
                  value={form.internal_name}
                  onChange={(event) => setForm((prev) => ({ ...prev, internal_name: event.target.value }))}
                  disabled={modalMode !== "create"}
                  className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm disabled:bg-zinc-100"
                />
              </label>
              <label className="text-sm text-zinc-700">
                Display Name
                <input
                  value={form.display_name}
                  onChange={(event) => setForm((prev) => ({ ...prev, display_name: event.target.value }))}
                  disabled={modalMode === "view"}
                  className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm disabled:bg-zinc-100"
                />
              </label>
              <label className="text-sm text-zinc-700">
                Data Type
                <select
                  value={form.data_type}
                  onChange={(event) => setForm((prev) => ({ ...prev, data_type: event.target.value as PropertyDataType }))}
                  disabled={modalMode !== "create"}
                  className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm disabled:bg-zinc-100"
                >
                  <option value="text">Text</option>
                  <option value="boolean">Boolean</option>
                  <option value="number">Number</option>
                  <option value="dropdown">Dropdown</option>
                  <option value="date">Date</option>
                  <option value="datetime">Datetime</option>
                </select>
              </label>
              <label className="text-sm text-zinc-700">
                Default Value
                <input
                  value={form.default_value == null ? "" : String(form.default_value)}
                  onChange={(event) => setForm((prev) => ({ ...prev, default_value: event.target.value }))}
                  disabled={modalMode !== "create"}
                  placeholder={form.data_type === "boolean" ? "true | false" : "Optional"}
                  className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm disabled:bg-zinc-100"
                />
              </label>
            </div>

            {form.data_type === "dropdown" && (
              <label className="mt-3 block text-sm text-zinc-700">
                Dropdown options (comma separated)
                <input
                  value={dropdownInput}
                  onChange={(event) => setDropdownInput(event.target.value)}
                  disabled={modalMode !== "create"}
                  className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm disabled:bg-zinc-100"
                />
              </label>
            )}

            <label className="mt-3 block text-sm text-zinc-700">
              Description
              <textarea
                value={form.description || ""}
                onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                disabled={modalMode === "view"}
                className="mt-1 min-h-[120px] w-full rounded-lg border border-black/10 px-3 py-2 text-sm disabled:bg-zinc-100"
              />
            </label>

            <label className="mt-3 inline-flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={form.is_required}
                onChange={(event) => setForm((prev) => ({ ...prev, is_required: event.target.checked }))}
                disabled={modalMode !== "create"}
              />
              Required
            </label>

            {modalMode !== "view" ? (
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
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
