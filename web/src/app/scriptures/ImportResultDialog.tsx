"use client";

import type { ImportResultDialogState } from "../../lib/scriptureTypes";

type Props = {
  importResultDialog: ImportResultDialogState | null;
  setImportResultDialog: (value: ImportResultDialogState | null) => void;
};

export default function ImportResultDialog({ importResultDialog, setImportResultDialog }: Props) {
  if (!importResultDialog) return null;

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-sm rounded-2xl border border-black/10 bg-[color:var(--paper)] p-6 shadow-xl">
        <button
          type="button"
          onClick={() => setImportResultDialog(null)}
          aria-label="Close"
          className="absolute right-3 top-3 text-lg leading-none text-zinc-400 transition hover:text-zinc-600"
        >
          ✕
        </button>
        <p className="mt-2 text-sm font-semibold text-zinc-800">
          <em className="italic">{importResultDialog.bookName}</em> upload
        </p>
        <div className="mt-3 rounded-lg border border-black/10 bg-white/70 p-3 text-sm text-zinc-700">
          <p>
            Status:{" "}
            <span
              className={
                importResultDialog.status === "completed"
                  ? "font-semibold text-emerald-700"
                  : "font-semibold text-red-700"
              }
            >
              {importResultDialog.status === "completed" ? "Completed" : "Error"}
            </span>
          </p>
          <p className="mt-1">
            Node count:{" "}
            <span className="font-medium text-zinc-900">
              {importResultDialog.nodesCreated === null
                ? ""
                : importResultDialog.nodesCreated.toLocaleString()}
            </span>
          </p>
          {importResultDialog.status !== "completed" && importResultDialog.reason.trim() ? (
            <p className="mt-1">
              Reason: <span className="font-medium text-zinc-900">{importResultDialog.reason}</span>
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setImportResultDialog(null)}
          className="mt-5 w-full rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-2 text-xs font-medium text-white transition hover:shadow-md"
        >
          Done
        </button>
      </div>
    </div>
  );
}
