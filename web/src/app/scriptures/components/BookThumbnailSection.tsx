type BookThumbnailSectionProps = {
  thumbnailUrl: string | null;
  canEditCurrentBook: boolean;
  onManageMultimedia: () => void;
  schemaLevels: string[];
  levelNameOverridesDraft: Record<string, string>;
  levelNameOverridesSaving: boolean;
  levelNameOverridesMessage: string | null;
  levelNameOverridesError: string | null;
  onLevelNameOverrideChange: (canonicalLevelName: string, nextDisplayName: string) => void;
  onSaveLevelNameOverrides: () => void;
};

export default function BookThumbnailSection({
  thumbnailUrl,
  canEditCurrentBook,
  onManageMultimedia,
  schemaLevels,
  levelNameOverridesDraft,
  levelNameOverridesSaving,
  levelNameOverridesMessage,
  levelNameOverridesError,
  onLevelNameOverrideChange,
  onSaveLevelNameOverrides,
}: BookThumbnailSectionProps) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-black/10 bg-white p-3">
        <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Book Thumbnail</div>
        <div className="mt-2 flex items-start gap-3">
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt="Book thumbnail"
              className="h-20 w-20 rounded-lg border border-black/10 object-cover"
            />
          ) : (
            <div className="h-20 w-20 rounded-lg border border-black/10 bg-zinc-100" />
          )}
          <div className="flex flex-col items-start gap-2">
            <p className="text-xs text-zinc-600">
              {thumbnailUrl ? "Thumbnail is managed in Multimedia Manager." : "No thumbnail set for this book."}
            </p>
            {canEditCurrentBook && (
              <button
                type="button"
                onClick={onManageMultimedia}
                className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs text-zinc-700"
              >
                Manage multimedia
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-black/10 bg-white p-3">
        <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Level Names</div>
        <p className="mt-1 text-xs text-zinc-600">
          Rename schema level labels for this book only. Structure and ordering remain unchanged.
        </p>
        <div className="mt-3 space-y-2">
          {schemaLevels.map((canonicalLevel) => (
            <div key={canonicalLevel} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] sm:items-center">
              <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">
                {canonicalLevel}
              </div>
              <input
                type="text"
                value={levelNameOverridesDraft[canonicalLevel] ?? canonicalLevel}
                onChange={(event) => onLevelNameOverrideChange(canonicalLevel, event.target.value)}
                disabled={!canEditCurrentBook || levelNameOverridesSaving}
                className="rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-[color:var(--accent)] disabled:opacity-60"
                placeholder={canonicalLevel}
              />
            </div>
          ))}
        </div>
        {levelNameOverridesError && (
          <p className="mt-2 text-xs text-red-600">{levelNameOverridesError}</p>
        )}
        {levelNameOverridesMessage && !levelNameOverridesError && (
          <p className="mt-2 text-xs text-zinc-600">{levelNameOverridesMessage}</p>
        )}
        {canEditCurrentBook && schemaLevels.length > 0 && (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={onSaveLevelNameOverrides}
              disabled={levelNameOverridesSaving}
              className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs text-zinc-700 disabled:opacity-60"
            >
              {levelNameOverridesSaving ? "Saving..." : "Save level names"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
