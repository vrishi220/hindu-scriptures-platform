"use client";

import type {
  CommentaryEntry,
  CommentaryDisplayItem,
  NodeComment,
  NodeContent,
} from "../../lib/scriptureTypes";

type Props = {
  showCommentary: boolean;
  canEditCurrentBook: boolean;
  authEmail: string | null;
  authUserId: number | null;
  nodeContent: NodeContent;

  nodeCommentary: CommentaryEntry[];
  nodeCommentaryLoading: boolean;
  nodeCommentaryError: string | null;
  nodeComments: NodeComment[];
  nodeCommentsLoading: boolean;
  nodeCommentsError: string | null;

  nodeCommentEditorOpen: boolean;
  setNodeCommentEditorOpen: React.Dispatch<React.SetStateAction<boolean>>;
  nodeCommentEditingId: number | null;
  nodeCommentFormLanguage: string;
  setNodeCommentFormLanguage: React.Dispatch<React.SetStateAction<string>>;
  nodeCommentFormText: string;
  setNodeCommentFormText: React.Dispatch<React.SetStateAction<string>>;
  nodeCommentSubmitting: boolean;
  nodeCommentMessage: string | null;

  commentaryEditorOpen: boolean;
  setCommentaryEditorOpen: React.Dispatch<React.SetStateAction<boolean>>;
  commentaryEditingId: number | null;
  commentaryFormAuthor: string;
  setCommentaryFormAuthor: React.Dispatch<React.SetStateAction<string>>;
  commentaryFormWorkTitle: string;
  setCommentaryFormWorkTitle: React.Dispatch<React.SetStateAction<string>>;
  commentaryFormLanguage: string;
  setCommentaryFormLanguage: React.Dispatch<React.SetStateAction<string>>;
  commentaryFormText: string;
  setCommentaryFormText: React.Dispatch<React.SetStateAction<string>>;
  commentarySubmitting: boolean;
  commentaryMessage: string | null;

  openCreateCommentaryEditor: () => void;
  openEditCommentaryEditor: (entry: CommentaryEntry) => void;
  handleSubmitCommentary: () => void;
  handleDeleteCommentary: (entryId: number) => void;
  resetCommentaryEditor: () => void;

  openCreateNodeCommentEditor: () => void;
  openEditNodeCommentEditor: (entry: NodeComment) => void;
  handleSubmitNodeComment: () => void;
  handleDeleteNodeComment: (commentId: number) => void;
  resetNodeCommentEditor: () => void;
};

export default function NodeCommentaryPanel({
  showCommentary,
  canEditCurrentBook,
  authEmail,
  authUserId,
  nodeContent,
  nodeCommentary,
  nodeCommentaryLoading,
  nodeCommentaryError,
  nodeComments,
  nodeCommentsLoading,
  nodeCommentsError,
  nodeCommentEditorOpen,
  setNodeCommentEditorOpen,
  nodeCommentEditingId,
  nodeCommentFormLanguage,
  setNodeCommentFormLanguage,
  nodeCommentFormText,
  setNodeCommentFormText,
  nodeCommentSubmitting,
  nodeCommentMessage,
  commentaryEditorOpen,
  setCommentaryEditorOpen,
  commentaryEditingId,
  commentaryFormAuthor,
  setCommentaryFormAuthor,
  commentaryFormWorkTitle,
  setCommentaryFormWorkTitle,
  commentaryFormLanguage,
  setCommentaryFormLanguage,
  commentaryFormText,
  setCommentaryFormText,
  commentarySubmitting,
  commentaryMessage,
  openCreateCommentaryEditor,
  openEditCommentaryEditor,
  handleSubmitCommentary,
  handleDeleteCommentary,
  resetCommentaryEditor,
  openCreateNodeCommentEditor,
  openEditNodeCommentEditor,
  handleSubmitNodeComment,
  handleDeleteNodeComment,
  resetNodeCommentEditor,
}: Props) {
  const apiEntries: CommentaryDisplayItem[] = nodeCommentary
    .filter((entry) => typeof entry.content_text === "string" && entry.content_text.trim())
    .map((entry) => {
      const metadata =
        entry.metadata && typeof entry.metadata === "object" ? entry.metadata : null;
      const metadataAuthor =
        metadata && typeof metadata.author === "string" && metadata.author.trim()
          ? metadata.author.trim()
          : "";
      const metadataWork =
        metadata && typeof metadata.work_title === "string" && metadata.work_title.trim()
          ? metadata.work_title.trim()
          : "";
      const author = metadataAuthor || metadataWork || "Commentary";
      return { id: entry.id, author, text: entry.content_text };
    });

  const metadata =
    (nodeContent.metadata_json && typeof nodeContent.metadata_json === "object"
      ? nodeContent.metadata_json
      : nodeContent.metadata && typeof nodeContent.metadata === "object"
        ? nodeContent.metadata
        : {}) as Record<string, unknown>;
  const metadataCommentary = metadata.commentary;
  const metadataEntries: CommentaryDisplayItem[] = Array.isArray(metadataCommentary)
    ? metadataCommentary
        .map((item, idx) => {
          if (!item || typeof item !== "object") return null;
          const entry = item as Record<string, unknown>;
          const author = typeof entry.author === "string" ? entry.author : "Commentary";
          const text = typeof entry.text === "string" ? entry.text : "";
          if (!text.trim()) return null;
          return { id: `metadata-${idx}`, author, text } as CommentaryDisplayItem;
        })
        .filter((item): item is CommentaryDisplayItem => Boolean(item))
    : [];

  const apiEditableEntries = nodeCommentary.filter(
    (entry) => typeof entry.content_text === "string" && entry.content_text.trim()
  );
  const displayEntries = apiEntries.length > 0 ? apiEntries : metadataEntries;

  const showCommentaryBlock =
    showCommentary && (nodeCommentaryLoading || nodeCommentaryError || displayEntries.length > 0);
  const showCommentsBlock =
    nodeCommentsLoading || nodeCommentsError || nodeComments.length > 0 || Boolean(authEmail);

  return (
    <>
      {showCommentaryBlock && (
        <div className="rounded-2xl border border-black/10 bg-white/90 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Commentary</div>
            {canEditCurrentBook && (
              <button
                type="button"
                onClick={openCreateCommentaryEditor}
                disabled={commentarySubmitting}
                className="rounded-lg border border-black/10 bg-white px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-700 transition hover:border-black/20 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add
              </button>
            )}
          </div>
          {nodeCommentaryLoading && (
            <p className="text-sm text-zinc-600">Loading commentary...</p>
          )}
          {!nodeCommentaryLoading && nodeCommentaryError && (
            <p className="text-sm text-red-600">{nodeCommentaryError}</p>
          )}
          {commentaryMessage && (
            <p className="mb-2 text-xs text-zinc-600">{commentaryMessage}</p>
          )}
          {canEditCurrentBook && commentaryEditorOpen && (
            <div className="mb-3 space-y-2 rounded-lg border border-black/10 bg-white p-3">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <input
                  type="text"
                  value={commentaryFormAuthor}
                  onChange={(event) => setCommentaryFormAuthor(event.target.value)}
                  placeholder="Author"
                  className="rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-[color:var(--accent)]"
                />
                <input
                  type="text"
                  value={commentaryFormWorkTitle}
                  onChange={(event) => setCommentaryFormWorkTitle(event.target.value)}
                  placeholder="Work"
                  className="rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-[color:var(--accent)]"
                />
                <input
                  type="text"
                  value={commentaryFormLanguage}
                  onChange={(event) => setCommentaryFormLanguage(event.target.value)}
                  placeholder="Language code"
                  className="rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-[color:var(--accent)]"
                />
              </div>
              <textarea
                rows={4}
                value={commentaryFormText}
                onChange={(event) => setCommentaryFormText(event.target.value)}
                placeholder="Commentary text"
                className="w-full rounded-lg border border-black/10 bg-white px-2.5 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCommentaryEditorOpen(false);
                    resetCommentaryEditor();
                  }}
                  disabled={commentarySubmitting}
                  className="rounded-lg border border-black/10 bg-white px-2.5 py-1 text-xs uppercase tracking-[0.14em] text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleSubmitCommentary();
                  }}
                  disabled={commentarySubmitting || !commentaryFormText.trim()}
                  className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-2.5 py-1 text-xs uppercase tracking-[0.14em] text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {commentarySubmitting
                    ? "Saving..."
                    : commentaryEditingId !== null
                      ? "Update"
                      : "Save"}
                </button>
              </div>
            </div>
          )}
          {!nodeCommentaryLoading && !nodeCommentaryError && displayEntries.length > 0 && (
            <div className="space-y-3">
              {apiEntries.length > 0
                ? apiEditableEntries.map((entry) => {
                    const entryMetadata =
                      entry.metadata && typeof entry.metadata === "object"
                        ? (entry.metadata as Record<string, unknown>)
                        : {};
                    const author =
                      typeof entryMetadata.author === "string" && entryMetadata.author.trim()
                        ? entryMetadata.author.trim()
                        : typeof entryMetadata.work_title === "string" && entryMetadata.work_title.trim()
                          ? entryMetadata.work_title.trim()
                          : "Commentary";
                    return (
                      <div key={entry.id} className="rounded-lg border border-black/10 bg-white p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs uppercase tracking-[0.15em] text-zinc-500">{author}</div>
                          {canEditCurrentBook && (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => openEditCommentaryEditor(entry)}
                                disabled={commentarySubmitting}
                                className="rounded border border-black/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-50"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  void handleDeleteCommentary(entry.id);
                                }}
                                disabled={commentarySubmitting}
                                className="rounded border border-red-200 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">{entry.content_text}</p>
                      </div>
                    );
                  })
                : displayEntries.map((entry) => (
                    <div key={entry.id}>
                      <div className="text-xs uppercase tracking-[0.15em] text-zinc-500">{entry.author}</div>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">{entry.text}</p>
                    </div>
                  ))}
            </div>
          )}
        </div>
      )}

      {showCommentsBlock && (
        <div className="rounded-2xl border border-black/10 bg-white/90 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Comments</div>
            {authEmail && (
              <button
                type="button"
                onClick={openCreateNodeCommentEditor}
                disabled={nodeCommentSubmitting}
                className="rounded-lg border border-black/10 bg-white px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-700 transition hover:border-black/20 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add
              </button>
            )}
          </div>
          {nodeCommentsLoading && (
            <p className="text-sm text-zinc-600">Loading comments...</p>
          )}
          {!nodeCommentsLoading && nodeCommentsError && (
            <p className="text-sm text-red-600">{nodeCommentsError}</p>
          )}
          {nodeCommentMessage && (
            <p className="mb-2 text-xs text-zinc-600">{nodeCommentMessage}</p>
          )}
          {authEmail && nodeCommentEditorOpen && (
            <div className="mb-3 space-y-2 rounded-lg border border-black/10 bg-white p-3">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <input
                  type="text"
                  value={nodeCommentFormLanguage}
                  onChange={(event) => setNodeCommentFormLanguage(event.target.value)}
                  placeholder="Language code"
                  className="rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-[color:var(--accent)]"
                />
              </div>
              <textarea
                rows={4}
                value={nodeCommentFormText}
                onChange={(event) => setNodeCommentFormText(event.target.value)}
                placeholder="Comment text"
                className="w-full rounded-lg border border-black/10 bg-white px-2.5 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setNodeCommentEditorOpen(false);
                    resetNodeCommentEditor();
                  }}
                  disabled={nodeCommentSubmitting}
                  className="rounded-lg border border-black/10 bg-white px-2.5 py-1 text-xs uppercase tracking-[0.14em] text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleSubmitNodeComment();
                  }}
                  disabled={nodeCommentSubmitting || !nodeCommentFormText.trim()}
                  className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-2.5 py-1 text-xs uppercase tracking-[0.14em] text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {nodeCommentSubmitting
                    ? "Saving..."
                    : nodeCommentEditingId !== null
                      ? "Update"
                      : "Save"}
                </button>
              </div>
            </div>
          )}
          {!nodeCommentsLoading && !nodeCommentsError && nodeComments.length > 0 && (
            <div className="space-y-3">
              {nodeComments.map((entry) => {
                const canManageComment =
                  canEditCurrentBook ||
                  (authUserId !== null && entry.created_by === authUserId);

                return (
                  <div key={entry.id} className="rounded-lg border border-black/10 bg-white p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs uppercase tracking-[0.15em] text-zinc-500">
                        {entry.created_by ? `User ${entry.created_by}` : "Comment"}
                      </div>
                      {canManageComment && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditNodeCommentEditor(entry)}
                            disabled={nodeCommentSubmitting}
                            className="rounded border border-black/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-50"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void handleDeleteNodeComment(entry.id);
                            }}
                            disabled={nodeCommentSubmitting}
                            className="rounded border border-red-200 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">
                      {entry.content_text}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );
}
