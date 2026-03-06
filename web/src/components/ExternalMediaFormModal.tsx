"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getYouTubeEmbedUrl,
  inferDisplayNameFromUrl,
  inferMediaTypeFromUrl,
  type ExternalMediaType,
} from "@/lib/externalMedia";

type ExternalMediaSubmitPayload = {
  url: string;
  displayName?: string;
  mediaType?: ExternalMediaType;
};

type ExternalMediaFormModalProps = {
  open: boolean;
  submitting?: boolean;
  description?: string;
  onClose: () => void;
  onSubmit: (payload: ExternalMediaSubmitPayload) => Promise<void> | void;
};

export default function ExternalMediaFormModal({
  open,
  submitting = false,
  description,
  onClose,
  onSubmit,
}: ExternalMediaFormModalProps) {
  const [url, setUrl] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [mediaType, setMediaType] = useState<"auto" | ExternalMediaType>("auto");
  const [displayNameTouched, setDisplayNameTouched] = useState(false);
  const [typeTouched, setTypeTouched] = useState(false);

  useEffect(() => {
    if (!open) {
      setUrl("");
      setDisplayName("");
      setMediaType("auto");
      setDisplayNameTouched(false);
      setTypeTouched(false);
    }
  }, [open]);

  const trimmedUrl = url.trim();
  const inferredType = useMemo(() => inferMediaTypeFromUrl(trimmedUrl), [trimmedUrl]);
  const effectiveType = mediaType === "auto" ? inferredType : mediaType;
  const youTubeEmbedUrl = effectiveType === "video" ? getYouTubeEmbedUrl(trimmedUrl) : null;

  if (!open) {
    return null;
  }

  const handleSubmit = async () => {
    if (!trimmedUrl) {
      return;
    }
    await onSubmit({
      url: trimmedUrl,
      displayName: displayName.trim() || undefined,
      mediaType: mediaType === "auto" ? undefined : mediaType,
    });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-3" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-2xl border border-black/10 bg-[color:var(--paper)] p-4 shadow-2xl sm:p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-[var(--font-display)] text-xl text-[color:var(--deep)]">Add External Media</h3>
            {description && <p className="text-sm text-zinc-600">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-2xl text-zinc-400 hover:text-zinc-600 disabled:opacity-50"
            aria-label="Close add external form"
          >
            ✕
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_0.8fr]">
          <label className="text-xs text-zinc-600">
            URL
            <input
              type="url"
              value={url}
              onChange={(event) => {
                const nextUrl = event.target.value;
                setUrl(nextUrl);
                if (!displayNameTouched) {
                  setDisplayName(inferDisplayNameFromUrl(nextUrl));
                }
                if (!typeTouched) {
                  setMediaType(inferMediaTypeFromUrl(nextUrl));
                }
              }}
              placeholder="https://..."
              className="mt-1 w-full rounded-md border border-black/10 bg-white px-2 py-1.5 text-sm outline-none focus:border-[color:var(--accent)]"
            />
          </label>
          <label className="text-xs text-zinc-600">
            Display name
            <input
              type="text"
              value={displayName}
              onChange={(event) => {
                setDisplayNameTouched(true);
                setDisplayName(event.target.value);
              }}
              placeholder="Auto"
              className="mt-1 w-full rounded-md border border-black/10 bg-white px-2 py-1.5 text-sm outline-none focus:border-[color:var(--accent)]"
            />
          </label>
          <label className="text-xs text-zinc-600">
            Type
            <select
              value={mediaType}
              onChange={(event) => {
                setTypeTouched(true);
                setMediaType(event.target.value as "auto" | ExternalMediaType);
              }}
              className="mt-1 w-full rounded-md border border-black/10 bg-white px-2 py-1.5 text-sm outline-none focus:border-[color:var(--accent)]"
            >
              <option value="auto">Auto ({inferredType})</option>
              <option value="image">image</option>
              <option value="audio">audio</option>
              <option value="video">video</option>
              <option value="link">link</option>
            </select>
          </label>
        </div>

        {trimmedUrl && (
          <div className="mt-4 rounded-lg border border-black/10 bg-white p-3">
            <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.12em] text-zinc-500">
              <span>Preview</span>
              <span>{effectiveType}</span>
            </div>
            {effectiveType === "image" ? (
              <img
                src={trimmedUrl}
                alt={displayName.trim() || "External media preview"}
                className="max-h-56 w-full rounded-md border border-black/10 object-contain"
              />
            ) : effectiveType === "audio" ? (
              <audio controls className="w-full">
                <source src={trimmedUrl} />
              </audio>
            ) : effectiveType === "video" && youTubeEmbedUrl ? (
              <iframe
                src={youTubeEmbedUrl}
                title="External video preview"
                className="aspect-video w-full rounded-md border border-black/10"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            ) : (
              <a
                href={trimmedUrl}
                target="_blank"
                rel="noreferrer"
                className="block truncate text-sm text-[color:var(--accent)] hover:underline"
              >
                {trimmedUrl}
              </a>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded border border-black/10 bg-white px-3 py-1.5 text-sm text-zinc-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              void handleSubmit();
            }}
            disabled={submitting || !trimmedUrl}
            className="rounded border border-[color:var(--accent)] bg-[color:var(--accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? "Adding..." : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
