import type { ReactNode } from "react";

type MetadataCategoryOption = {
  id: number;
  name: string;
};

type EffectivePropertyBinding = {
  property_internal_name: string;
  property_display_name: string;
  property_data_type: "text" | "boolean" | "number" | "dropdown" | "date" | "datetime";
  is_required?: boolean;
  dropdown_options?: string[] | null;
};

type PropertiesPanelProps = {
  open: boolean;
  title: string;
  subtitle: string;
  nameValue: string;
  descriptionValue: string;
  categoryId: number | null;
  categories: MetadataCategoryOption[];
  loading: boolean;
  categoriesLoading: boolean;
  error: string | null;
  message: string | null;
  saving: boolean;
  saveDisabled: boolean;
  effectiveFields: EffectivePropertyBinding[];
  values: Record<string, unknown>;
  extraSections?: ReactNode;
  onClose: () => void;
  onCategoryChange: (value: string) => void;
  onValueChange: (key: string, value: unknown) => void;
  onSave: () => void;
  toDisplayText: (rawValue: unknown) => string;
  toDatetimeLocalValue: (rawValue: unknown) => string;
  isSingleLineTextField: (field: EffectivePropertyBinding) => boolean;
  isTemplateField: (field: EffectivePropertyBinding) => boolean;
};

export default function PropertiesPanel({
  open,
  title,
  subtitle,
  nameValue,
  descriptionValue,
  categoryId,
  categories,
  loading,
  categoriesLoading,
  error,
  message,
  saving,
  saveDisabled,
  effectiveFields,
  values,
  extraSections,
  onClose,
  onCategoryChange,
  onValueChange,
  onSave,
  toDisplayText,
  toDatetimeLocalValue,
  isSingleLineTextField,
  isTemplateField,
}: PropertiesPanelProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-3 md:items-center">
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col rounded-3xl bg-[color:var(--paper)] p-4 shadow-2xl sm:p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-[var(--font-display)] text-2xl text-[color:var(--deep)]">{title}</h2>
            <p className="text-sm text-zinc-600">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-black/10 px-2.5 py-1 text-sm text-zinc-700"
          >
            X
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto pr-1">
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Name</span>
            <input
              type="text"
              readOnly
              value={nameValue}
              className="rounded-lg border border-black/10 bg-zinc-50 px-3 py-2 text-sm text-zinc-700"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Description</span>
            <textarea
              readOnly
              value={descriptionValue}
              rows={2}
              className="rounded-lg border border-black/10 bg-zinc-50 px-3 py-2 text-sm text-zinc-700"
            />
          </label>

          {extraSections}

          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Category</span>
            <select
              value={categoryId?.toString() || ""}
              onChange={(event) => onCategoryChange(event.target.value)}
              disabled={loading || categoriesLoading}
              className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)] disabled:opacity-60"
            >
              <option value="">Select category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id.toString()}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          {loading && <p className="text-xs text-zinc-500">Loading metadata properties...</p>}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          {!loading && categoryId && effectiveFields.length === 0 && (
            <p className="text-xs text-zinc-500">Selected category has no metadata properties.</p>
          )}

          {effectiveFields.map((field) => {
            const key = field.property_internal_name;
            const value = values[key];
            const required = Boolean(field.is_required);

            if (field.property_data_type === "boolean") {
              return (
                <label
                  key={key}
                  className="flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-zinc-700"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={(event) => onValueChange(key, event.target.checked)}
                    className="rounded border-black/20"
                  />
                  <span>
                    {field.property_display_name}
                    {required ? " *" : ""}
                  </span>
                </label>
              );
            }

            if (field.property_data_type === "dropdown") {
              const dropdownValue = toDisplayText(value);
              return (
                <label key={key} className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                    {field.property_display_name}
                    {required ? " *" : ""}
                  </span>
                  <select
                    value={dropdownValue}
                    onChange={(event) => onValueChange(key, event.target.value)}
                    className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Select value</option>
                    {(field.dropdown_options || []).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              );
            }

            if (field.property_data_type === "number") {
              return (
                <label key={key} className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                    {field.property_display_name}
                    {required ? " *" : ""}
                  </span>
                  <input
                    type="number"
                    value={value === null || value === undefined ? "" : String(value)}
                    onChange={(event) => onValueChange(key, event.target.value)}
                    className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                  />
                </label>
              );
            }

            if (field.property_data_type === "date") {
              return (
                <label key={key} className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                    {field.property_display_name}
                    {required ? " *" : ""}
                  </span>
                  <input
                    type="date"
                    value={typeof value === "string" ? value : ""}
                    onChange={(event) => onValueChange(key, event.target.value)}
                    className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                  />
                </label>
              );
            }

            if (field.property_data_type === "datetime") {
              return (
                <label key={key} className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                    {field.property_display_name}
                    {required ? " *" : ""}
                  </span>
                  <input
                    type="datetime-local"
                    value={toDatetimeLocalValue(value)}
                    onChange={(event) => onValueChange(key, event.target.value)}
                    className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                  />
                </label>
              );
            }

            const singleLine = isSingleLineTextField(field);
            const templateField = isTemplateField(field);
            const textValue = toDisplayText(value);

            return (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                  {field.property_display_name}
                  {required ? " *" : ""}
                </span>
                {templateField ? (
                  <select
                    value={textValue}
                    disabled
                    className="rounded-lg border border-black/10 bg-zinc-100 px-3 py-2 text-sm text-zinc-700"
                  >
                    <option value={textValue}>{textValue || "Not configured"}</option>
                  </select>
                ) : singleLine ? (
                  <input
                    type="text"
                    value={textValue}
                    onChange={(event) => onValueChange(key, event.target.value)}
                    className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                  />
                ) : (
                  <textarea
                    value={textValue}
                    onChange={(event) => onValueChange(key, event.target.value)}
                    rows={4}
                    className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                  />
                )}
              </label>
            );
          })}

          <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-black/5 bg-[color:var(--paper)] pt-2">
            <div>{message && <span className="text-xs text-emerald-700">{message}</span>}</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onSave}
                disabled={saveDisabled}
                className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
