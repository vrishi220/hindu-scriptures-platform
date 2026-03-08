type LevelTemplateSummary = {
  id: number;
  name: string;
  current_version: number;
  visibility: "private" | "published";
};

type NodeLevelTemplateSectionProps = {
  levelDefaultTemplateKey: string;
  propertiesLevelKey: string;
  selectedLevelTemplateId: string;
  levelTemplates: LevelTemplateSummary[];
  levelTemplatesLoading: boolean;
  levelTemplateSaving: boolean;
  levelTemplateAssignmentId: number | null;
  levelTemplateError: string | null;
  levelTemplateMessage: string | null;
  onTemplateChange: (templateId: string) => void;
  onAssignTemplate: () => void;
};

export default function NodeLevelTemplateSection({
  levelDefaultTemplateKey,
  propertiesLevelKey,
  selectedLevelTemplateId,
  levelTemplates,
  levelTemplatesLoading,
  levelTemplateSaving,
  levelTemplateAssignmentId,
  levelTemplateError,
  levelTemplateMessage,
  onTemplateChange,
  onAssignTemplate,
}: NodeLevelTemplateSectionProps) {
  return (
    <div className="rounded-lg border border-black/10 bg-white p-3">
      <div>
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Level Template</div>
          <p className="mt-1 text-xs text-zinc-600">
            Schema default: <span className="font-medium">{levelDefaultTemplateKey || "Not configured"}</span>
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            Instance override for level: <span className="font-medium">{propertiesLevelKey || "unknown"}</span>
          </p>
        </div>
      </div>

      <label className="mt-3 flex flex-col gap-1">
        <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Template</span>
        <select
          value={selectedLevelTemplateId}
          onChange={(event) => onTemplateChange(event.target.value)}
          disabled={levelTemplatesLoading || levelTemplateSaving || !propertiesLevelKey}
          className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)] disabled:opacity-60"
        >
          <option value="">Select template</option>
          {levelTemplates.map((template) => (
            <option key={template.id} value={template.id.toString()}>
              {template.name} (v{template.current_version}, {template.visibility})
            </option>
          ))}
        </select>
      </label>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onAssignTemplate}
          disabled={!selectedLevelTemplateId || levelTemplateSaving || !propertiesLevelKey}
          className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
        >
          {levelTemplateSaving
            ? "Saving..."
            : levelTemplateAssignmentId
              ? "Update Assignment"
              : "Assign Template"}
        </button>
        <span className="text-xs text-zinc-500">
          {levelTemplateAssignmentId ? "Override active" : "Using schema default"}
        </span>
        <a
          href="/templates"
          className="text-xs text-[color:var(--accent)] underline decoration-transparent underline-offset-2 hover:decoration-current"
        >
          Manage templates
        </a>
      </div>

      {levelTemplateError && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {levelTemplateError}
        </div>
      )}
      {levelTemplateMessage && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {levelTemplateMessage}
        </div>
      )}
    </div>
  );
}
