"use client";

import { useEffect, useState } from "react";
import { getMe } from "../../lib/authClient";

type TemplateVisibility = "private" | "published";

type Schema = {
  id: number;
  name: string;
  levels: string[];
};

type RenderTemplate = {
  id: number;
  owner_id: number;
  name: string;
  description?: string | null;
  target_schema_id?: number | null;
  target_level?: string | null;
  is_system?: boolean;
  system_key?: string | null;
  visibility: TemplateVisibility;
  liquid_template: string;
  current_version: number;
  is_active: boolean;
  created_at: string;
  updated_at?: string | null;
};

type MePayload = {
  id: number;
  email?: string | null;
  role?: string | null;
  permissions?: {
    can_admin?: boolean;
    can_edit?: boolean;
  } | null;
};

const DEFAULT_TEMPLATE = `{% if metadata.sanskrit %}Sanskrit: {{ metadata.sanskrit }}\n{% endif %}{% if metadata.transliteration %}Transliteration: {{ metadata.transliteration }}\n{% endif %}{% if metadata.english %}English: {{ metadata.english }}\n{% endif %}`;

type ModalMode = "create" | "edit" | "view";

const formatDate = (value: string) => {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

const readErrorMessage = (payload: unknown, fallback: string) => {
  if (!payload || typeof payload !== "object") return fallback;
  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  return fallback;
};

export default function TemplatesPage() {
  const [me, setMe] = useState<MePayload | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [templates, setTemplates] = useState<RenderTemplate[]>([]);
  const [schemas, setSchemas] = useState<Schema[]>([]);
  const [showDefaultTemplates, setShowDefaultTemplates] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>("create");
  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedSchemaId, setSelectedSchemaId] = useState("");
  const [targetLevel, setTargetLevel] = useState("");
  const [visibility, setVisibility] = useState<TemplateVisibility>("private");
  const [liquidTemplate, setLiquidTemplate] = useState(DEFAULT_TEMPLATE);
  const [isActive, setIsActive] = useState(true);

  const selectedSchema = schemas.find((schema) => String(schema.id) === selectedSchemaId) || null;
  const availableLevels = selectedSchema?.levels || [];

  const inferSchemaIdByLevel = (level: string | null | undefined): string => {
    const normalizedLevel = (level || "").trim();
    if (!normalizedLevel) return "";
    const match = schemas.find((schema) => schema.levels.includes(normalizedLevel));
    return match ? String(match.id) : "";
  };

  const inferSchemaNameByLevel = (level: string | null | undefined): string => {
    const normalizedLevel = (level || "").trim();
    if (!normalizedLevel) return "—";
    const match = schemas.find((schema) => schema.levels.includes(normalizedLevel));
    return match?.name || "—";
  };

  const getSchemaNameById = (schemaId: number | null | undefined): string => {
    if (!schemaId) return "—";
    const match = schemas.find((schema) => schema.id === schemaId);
    return match?.name || "—";
  };

  const loadSchemas = async () => {
    try {
      const response = await fetch("/api/schemas", { credentials: "include" });
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        return;
      }
      setSchemas(Array.isArray(payload) ? (payload as Schema[]) : []);
    } catch {
      setSchemas([]);
    }
  };

  const loadTemplates = async () => {
    setLoading(true);
    setError(null);
    try {
      const templatesRes = await fetch(
        "/api/templates?include_published=true&include_inactive=false",
        { credentials: "include" }
      );

      const templatesPayload = (await templatesRes.json().catch(() => null)) as unknown;
      if (!templatesRes.ok) {
        throw new Error(readErrorMessage(templatesPayload, "Failed to load templates"));
      }

      setTemplates(Array.isArray(templatesPayload) ? (templatesPayload as RenderTemplate[]) : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load templates");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const run = async () => {
      const profile = (await getMe()) as MePayload | null;
      setMe(profile);
      setAuthChecked(true);
      if (profile) {
        await Promise.all([loadTemplates(), loadSchemas()]);
      }
    };
    void run();
  }, []);

  const resetForm = (mode: ModalMode = "create") => {
    setModalMode(mode);
    setEditingTemplateId(null);
    setName("");
    setDescription("");
    setSelectedSchemaId("");
    setTargetLevel("");
    setVisibility("private");
    setLiquidTemplate(DEFAULT_TEMPLATE);
    setIsActive(true);
  };

  const saveTemplate = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const isEdit = editingTemplateId !== null;
      const response = await fetch(
        isEdit ? `/api/templates/${editingTemplateId}` : "/api/templates",
        {
          method: isEdit ? "PATCH" : "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            description: description.trim() || null,
            target_schema_id: Number(selectedSchemaId),
            target_level: targetLevel.trim(),
            visibility,
            liquid_template: liquidTemplate,
            is_active: isActive,
          }),
        }
      );
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        throw new Error(readErrorMessage(payload, isEdit ? "Failed to update template" : "Failed to create template"));
      }

      const saved = payload as RenderTemplate;
      setTemplates((prev) => [saved, ...prev.filter((item) => item.id !== saved.id)]);
      setMessage(isEdit ? "Template updated" : "Template created");
      setModalOpen(false);
      resetForm("create");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save template");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (template: RenderTemplate) => {
    const canManage = canManageTemplate(template);
    setModalMode(canManage ? "edit" : "view");
    setModalOpen(true);
    setEditingTemplateId(template.id);
    setName(template.name);
    setDescription(template.description || "");
    const nextSchemaId = template.target_schema_id ? String(template.target_schema_id) : inferSchemaIdByLevel(template.target_level);
    setSelectedSchemaId(nextSchemaId);
    setTargetLevel(template.target_level || "");
    setVisibility(template.visibility);
    setLiquidTemplate(template.liquid_template || DEFAULT_TEMPLATE);
    setIsActive(template.is_active);
  };

  const deleteTemplate = async (template: RenderTemplate) => {
    const confirmed = window.confirm(`Delete template \"${template.name}\"?`);
    if (!confirmed) {
      return;
    }

    setDeletingId(template.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/templates/${template.id}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (response.status === 204) {
        setTemplates((prev) => prev.filter((item) => item.id !== template.id));
        if (editingTemplateId === template.id) {
          setModalOpen(false);
          resetForm("create");
        }
        setMessage("Template deleted");
        return;
      }

      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        throw new Error(readErrorMessage(payload, "Failed to delete template"));
      }

      setTemplates((prev) => prev.filter((item) => item.id !== template.id));
      setMessage("Template deleted");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete template");
    } finally {
      setDeletingId(null);
    }
  };

  const canManageTemplate = (template: RenderTemplate): boolean => {
    if (!me) return false;
    const isAdminUser = Boolean(me.permissions?.can_admin || me.role === "admin");
    if (Boolean(template.is_system)) {
      return isAdminUser;
    }
    if (template.owner_id === me.id) return true;
    return Boolean(me.permissions?.can_admin || me.permissions?.can_edit);
  };

  const isDefaultSystemTemplate = (template: RenderTemplate): boolean => {
    const key = (template.system_key || "").trim().toLowerCase();
    return Boolean(template.is_system) && key.startsWith("default.");
  };

  const visibleTemplates = showDefaultTemplates
    ? templates
    : templates.filter((template) => !isDefaultSystemTemplate(template));

  if (!authChecked) {
    return <main className="mx-auto w-full max-w-6xl px-4 py-6">Loading…</main>;
  }

  if (!me) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-6">
        <div className="rounded-xl border border-black/10 bg-white p-4 text-sm text-zinc-700">
          Please sign in to manage templates.
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-zinc-900">Templates</h1>
        <p className="text-sm text-zinc-600">
          Valid templates available to you (your templates + published templates).
        </p>
      </header>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div>}

      <section className="rounded-xl border border-black/10 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-zinc-900">Templates</h2>
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={showDefaultTemplates}
                onChange={(event) => setShowDefaultTemplates(event.target.checked)}
                className="h-4 w-4 rounded border-black/20"
              />
              Show default templates
            </label>
            <button
              type="button"
              onClick={() => {
                setModalMode("create");
                resetForm("create");
                setModalOpen(true);
              }}
              className="rounded-lg border border-black/10 bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white"
            >
              Create
            </button>
          </div>
        </div>
        {loading ? (
          <p className="text-sm text-zinc-600">Loading…</p>
        ) : visibleTemplates.length === 0 ? (
          <p className="text-sm text-zinc-600">No templates yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left text-zinc-600">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Schema</th>
                  <th className="px-3 py-2 font-medium">Level</th>
                  <th className="px-3 py-2 font-medium">Visibility</th>
                  <th className="px-3 py-2 font-medium">Version</th>
                  <th className="px-3 py-2 font-medium">Owner</th>
                  <th className="px-3 py-2 font-medium">Updated</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
            {visibleTemplates.map((item) => (
              <tr
                key={item.id}
                onClick={() => startEdit(item)}
                className="cursor-pointer border-b border-black/5 hover:bg-zinc-50"
              >
                <td className="px-3 py-2 font-medium text-zinc-900">{item.name}</td>
                <td className="px-3 py-2 text-zinc-700">
                  {item.target_schema_id ? getSchemaNameById(item.target_schema_id) : inferSchemaNameByLevel(item.target_level)}
                </td>
                <td className="px-3 py-2 text-zinc-700">{item.target_level || "—"}</td>
                <td className="px-3 py-2 text-zinc-700">{item.visibility}</td>
                <td className="px-3 py-2 text-zinc-700">v{item.current_version}</td>
                <td className="px-3 py-2 text-zinc-700">{item.owner_id === me.id ? "You" : `User ${item.owner_id}`}</td>
                <td className="px-3 py-2 text-zinc-700">{formatDate(item.updated_at || item.created_at)}</td>
                <td className="px-3 py-2">
                  {canManageTemplate(item) && !item.is_system ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void deleteTemplate(item);
                      }}
                      disabled={deletingId === item.id}
                      className="rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-700 disabled:opacity-50"
                    >
                      {deletingId === item.id ? "Deleting…" : "Delete"}
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
          <div className="w-full max-w-3xl rounded-xl border border-black/10 bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-zinc-900">
                {modalMode === "create" ? "Create template" : modalMode === "edit" ? "Edit template" : "View template"}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  resetForm("create");
                }}
                className="rounded-md border border-black/10 px-2.5 py-1 text-sm text-zinc-700"
              >
                Close
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
                Schema
                <select
                  value={selectedSchemaId}
                  onChange={(event) => {
                    setSelectedSchemaId(event.target.value);
                    setTargetLevel("");
                  }}
                  disabled={modalMode === "view"}
                  className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm disabled:bg-zinc-100"
                >
                  <option value="">Select schema</option>
                  {schemas.map((schema) => (
                    <option key={schema.id} value={String(schema.id)}>
                      {schema.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm text-zinc-700">
                Target level
                <select
                  value={targetLevel}
                  onChange={(event) => setTargetLevel(event.target.value)}
                  disabled={modalMode === "view" || !selectedSchemaId}
                  className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm disabled:bg-zinc-100"
                >
                  <option value="">Select level</option>
                  {availableLevels.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="mt-3 block text-sm text-zinc-700">
              Description
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={modalMode === "view"}
                className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm disabled:bg-zinc-100"
              />
            </label>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-zinc-700">
                Visibility
                <select
                  value={visibility}
                  onChange={(event) => setVisibility(event.target.value as TemplateVisibility)}
                  disabled={modalMode === "view"}
                  className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm disabled:bg-zinc-100"
                >
                  <option value="private">private</option>
                  <option value="published">published</option>
                </select>
              </label>

              {modalMode !== "create" ? (
                <label className="inline-flex items-center gap-2 self-end pb-2 text-sm text-zinc-700">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(event) => setIsActive(event.target.checked)}
                    disabled={modalMode === "view"}
                  />
                  Active
                </label>
              ) : (
                <div />
              )}
            </div>

            <label className="mt-3 block text-sm text-zinc-700">
              Liquid template
              <textarea
                value={liquidTemplate}
                onChange={(event) => setLiquidTemplate(event.target.value)}
                disabled={modalMode === "view"}
                className="mt-1 min-h-[200px] w-full rounded-lg border border-black/10 px-3 py-2 text-xs font-mono disabled:bg-zinc-100"
              />
            </label>

            {modalMode !== "view" ? (
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={saveTemplate}
                  disabled={saving || !name.trim() || !selectedSchemaId || !targetLevel.trim() || !liquidTemplate.trim()}
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
