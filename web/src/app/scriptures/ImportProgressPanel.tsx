"use client";

import type { BulkFileResult } from "./hooks/useImportPipeline";

type Props = {
  canImport: boolean;
  importSubmitting: boolean;
  importProgressMessage: string | null;
  importProgressCurrent: number | null;
  importProgressTotal: number | null;
  showImportUrlInput: boolean;
  setShowImportUrlInput: React.Dispatch<React.SetStateAction<boolean>>;
  importUrl: string;
  setImportUrl: React.Dispatch<React.SetStateAction<string>>;
  appendImportToExisting: boolean;
  setAppendImportToExisting: React.Dispatch<React.SetStateAction<boolean>>;
  pendingImportFile: File | null;
  setPendingImportFile: React.Dispatch<React.SetStateAction<File | null>>;
  pendingImportBookName: string | null;
  setPendingImportBookName: React.Dispatch<React.SetStateAction<string | null>>;
  pendingImportBookCode: string | null;
  setPendingImportBookCode: React.Dispatch<React.SetStateAction<string | null>>;
  showImportUploadConfirm: boolean;
  setShowImportUploadConfirm: React.Dispatch<React.SetStateAction<boolean>>;
  bulkFileResults: BulkFileResult[];
  setBulkFileResults: React.Dispatch<React.SetStateAction<BulkFileResult[]>>;
  bulkRunning: boolean;
  handleImportBookUrl: () => void;
  startImportBookFile: (file: File, allowExistingContent: boolean, bookName: string) => void;
};

export default function ImportProgressPanel({
  canImport,
  importSubmitting,
  importProgressMessage,
  importProgressCurrent,
  importProgressTotal,
  showImportUrlInput,
  setShowImportUrlInput,
  importUrl,
  setImportUrl,
  appendImportToExisting,
  setAppendImportToExisting,
  pendingImportFile,
  setPendingImportFile,
  pendingImportBookName,
  setPendingImportBookName,
  pendingImportBookCode,
  setPendingImportBookCode,
  showImportUploadConfirm,
  setShowImportUploadConfirm,
  bulkFileResults,
  setBulkFileResults,
  bulkRunning,
  handleImportBookUrl,
  startImportBookFile,
}: Props) {
  return (
    <>
      {canImport && showImportUrlInput && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-black/10 bg-zinc-50 p-2">
          <input
            type="url"
            value={importUrl}
            onChange={(event) => setImportUrl(event.target.value)}
            placeholder="Paste public raw JSON URL"
            className="min-w-[16rem] flex-1 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-zinc-700"
          />
          <button
            type="button"
            onClick={() => {
              void handleImportBookUrl();
            }}
            disabled={importSubmitting || !importUrl.trim()}
            className="inline-flex h-9 items-center rounded-lg border border-black/10 bg-zinc-900 px-3 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {importSubmitting ? "Importing..." : "Import URL"}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowImportUrlInput(false);
              setImportUrl("");
            }}
            disabled={importSubmitting}
            className="inline-flex h-9 items-center rounded-lg border border-black/10 bg-white px-3 text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          {(importSubmitting || importProgressMessage) && (
            <div className="basis-full rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{importProgressMessage || "Importing..."}</span>
                {typeof importProgressCurrent === "number" && typeof importProgressTotal === "number" && importProgressTotal > 0 && (
                  <span className="text-xs text-blue-800">
                    {importProgressCurrent} / {importProgressTotal}
                  </span>
                )}
              </div>
              {typeof importProgressCurrent === "number" && typeof importProgressTotal === "number" && importProgressTotal > 0 && (
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-blue-100">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all"
                    style={{
                      width: `${Math.max(0, Math.min(100, (importProgressCurrent / importProgressTotal) * 100))}%`,
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {canImport && !showImportUrlInput && (importSubmitting || importProgressMessage) && (
        <div className="mt-2 rounded-xl border border-black/10 bg-zinc-50 p-2">
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{importProgressMessage || "Importing..."}</span>
              {typeof importProgressCurrent === "number" && typeof importProgressTotal === "number" && importProgressTotal > 0 && (
                <span className="text-xs text-blue-800">
                  {importProgressCurrent} / {importProgressTotal}
                </span>
              )}
            </div>
            {typeof importProgressCurrent === "number" && typeof importProgressTotal === "number" && importProgressTotal > 0 && (
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-blue-100">
                <div
                  className="h-full rounded-full bg-blue-600 transition-all"
                  style={{
                    width: `${Math.max(0, Math.min(100, (importProgressCurrent / importProgressTotal) * 100))}%`,
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}
      {canImport && bulkFileResults.length > 0 && (
        <div className="mt-2 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-100 bg-zinc-50 px-3 py-2">
            {(() => {
              const totalCount = bulkFileResults.length;
              const completedCount = bulkFileResults.filter(
                (r) => r.status === "success" || r.status === "skipped" || r.status === "error"
              ).length;
              const activeIndex = bulkFileResults.findIndex((r) => r.status === "uploading");
              const activeRow = activeIndex >= 0 ? bulkFileResults[activeIndex] : null;
              const summaryMessage = bulkRunning
                ? activeRow
                  ? `Book ${activeIndex + 1} of ${totalCount}: ${activeRow.name}`
                  : "Preparing bulk import..."
                : `${completedCount} of ${totalCount} books finished`;
              const summaryDetail = activeRow?.progressMessage || activeRow?.message || null;
              const summaryWidth = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

              return (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-zinc-700">
                    <span>{summaryMessage}</span>
                    <span className="text-zinc-500">{completedCount} / {totalCount}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-blue-100">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-all duration-300"
                      style={{
                        width: `${Math.max(
                          bulkRunning && totalCount > 0 && completedCount === 0 ? 2 : 0,
                          Math.min(100, summaryWidth)
                        )}%`,
                      }}
                    />
                  </div>
                  {summaryDetail ? (
                    <div className="mt-2 text-[11px] text-zinc-500">{summaryDetail}</div>
                  ) : null}
                </>
              );
            })()}
          </div>
          {!bulkRunning && (
            <div className="flex gap-4 border-b border-zinc-100 bg-zinc-50 px-3 py-2 text-xs font-medium">
              <span className="text-emerald-600">✓ {bulkFileResults.filter((r) => r.status === "success").length} imported</span>
              <span className="text-zinc-400">⏭ {bulkFileResults.filter((r) => r.status === "skipped").length} skipped</span>
              <span className="text-red-500">✕ {bulkFileResults.filter((r) => r.status === "error").length} failed</span>
              <button
                type="button"
                onClick={() => setBulkFileResults([])}
                className="ml-auto text-zinc-400 hover:text-zinc-600"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          )}
          <ul className="max-h-64 divide-y divide-zinc-100 overflow-y-auto">
            {bulkFileResults.map((r, idx) => {
              const icon = r.status === "success" ? "✅" : r.status === "skipped" ? "⏭" : r.status === "error" ? "❌" : "⏳";
              const elapsed = r.elapsedMs !== undefined ? (r.elapsedMs >= 1000 ? `${(r.elapsedMs / 1000).toFixed(1)}s` : `${r.elapsedMs}ms`) : null;
              const isActive = r.status === "uploading";
              const hasProgress = typeof r.progressCurrent === "number" && typeof r.progressTotal === "number" && r.progressTotal > 0;
              const isWaitingAtZero =
                !hasProgress &&
                (r.status === "pending" || (typeof r.progressCurrent === "number" && r.progressCurrent <= 0));
              return (
                <li key={idx} className="px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0">{icon}</span>
                    <span className="min-w-0 flex-1 truncate font-medium text-zinc-800">{r.name}</span>
                    {r.progressMessage ? (
                      <span className="shrink-0 text-zinc-500">{r.progressMessage}</span>
                    ) : (
                      <span className="shrink-0 text-zinc-500">{r.message}</span>
                    )}
                    {hasProgress && (
                      <span className="shrink-0 font-mono text-zinc-400">
                        {r.progressCurrent} / {r.progressTotal}
                      </span>
                    )}
                    {elapsed && (
                      <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-zinc-400">{elapsed}</span>
                    )}
                  </div>
                  {isActive && (
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-blue-100">
                      {hasProgress ? (
                        <div
                          className="h-full rounded-full bg-blue-500 transition-all duration-300"
                          style={{ width: `${Math.max(2, Math.min(100, ((r.progressCurrent ?? 0) / (r.progressTotal ?? 1)) * 100))}%` }}
                        />
                      ) : isWaitingAtZero ? (
                        <div
                          className="h-full rounded-full bg-blue-400/70 transition-all duration-300"
                          style={{ width: "0%" }}
                        />
                      ) : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {canImport && showImportUploadConfirm && pendingImportFile && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/35 px-4">
          <div className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-4 shadow-2xl">
            <h3 className="text-sm font-semibold text-zinc-900">Confirm Upload Import</h3>
            <p className="mt-1 text-sm text-zinc-600">
              Import file: <span className="font-medium text-zinc-800">{pendingImportFile.name}</span>
            </p>
            <div className="mt-2 rounded-lg border border-black/10 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
              <p>
                Book name: <span className="font-medium text-zinc-800">{pendingImportBookName || "Not detected"}</span>
              </p>
              <p className="mt-1">
                Book code: <span className="font-medium text-zinc-800">{pendingImportBookCode || "Not detected"}</span>
              </p>
            </div>
            <label className="mt-3 flex items-start gap-2 rounded-lg border border-black/10 bg-zinc-50 p-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={appendImportToExisting}
                onChange={(event) => setAppendImportToExisting(event.target.checked)}
                className="mt-0.5"
              />
              <span>
                Append to existing book
                <span className="block text-xs text-zinc-500">
                  Use when importing another part into the same book.
                </span>
              </span>
            </label>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowImportUploadConfirm(false);
                  setPendingImportFile(null);
                  setPendingImportBookName(null);
                  setPendingImportBookCode(null);
                  setAppendImportToExisting(false);
                }}
                className="inline-flex h-9 items-center rounded-lg border border-black/10 bg-white px-3 text-sm text-zinc-700 transition hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const selectedFile = pendingImportFile;
                  const selectedBookName =
                    (pendingImportBookName && pendingImportBookName.trim()) ||
                    selectedFile?.name.replace(/\.json$/i, "") ||
                    "Book";
                  const shouldAppend = appendImportToExisting;
                  setShowImportUploadConfirm(false);
                  setPendingImportFile(null);
                  setPendingImportBookName(null);
                  setPendingImportBookCode(null);
                  setAppendImportToExisting(false);
                  if (selectedFile) {
                    void startImportBookFile(selectedFile, shouldAppend, selectedBookName);
                  }
                }}
                className="inline-flex h-9 items-center rounded-lg border border-black/10 bg-zinc-900 px-3 text-sm font-medium text-white transition hover:bg-zinc-800"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
