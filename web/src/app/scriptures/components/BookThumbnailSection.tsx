type BookThumbnailSectionProps = {
  thumbnailUrl: string | null;
  canEditCurrentBook: boolean;
  onManageMultimedia: () => void;
};

export default function BookThumbnailSection({
  thumbnailUrl,
  canEditCurrentBook,
  onManageMultimedia,
}: BookThumbnailSectionProps) {
  return (
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
  );
}
