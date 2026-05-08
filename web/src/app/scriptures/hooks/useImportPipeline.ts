"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type {
  CanonicalUploadComplete,
  ImportJobLifecycleStatus,
  ImportResult,
  ImportJobStatus,
  CanonicalUploadInit,
  CanonicalUploadChunk,
  ImportJobStart,
  ImportResultDialogState,
} from "../../../lib/scriptureTypes";
import {
  readPersistedImportJobState,
  writePersistedImportJobState,
  clearPersistedImportJobState,
} from "../../../lib/scriptureStorage";
import { IMPORT_CANONICAL_CHUNK_FALLBACK_BYTES } from "../../../lib/translationUtils";

export type BulkFileStatus = "pending" | "uploading" | "success" | "skipped" | "error";
export type BulkFileResult = {
  name: string;
  status: BulkFileStatus;
  message: string;
  elapsedMs?: number;
  progressMessage?: string | null;
  progressCurrent?: number | null;
  progressTotal?: number | null;
};

export function useImportPipeline({
  canImport,
  loadBooksRefreshRef,
}: {
  canImport: boolean;
  loadBooksRefreshRef: React.MutableRefObject<() => Promise<void>>;
}) {
  const importBookInputRef = useRef<HTMLInputElement | null>(null);
  const importPollingRunIdRef = useRef(0);
  const activeImportJobIdRef = useRef<string | null>(null);

  const [importSubmitting, setImportSubmitting] = useState(false);
  const [importProgressMessage, setImportProgressMessage] = useState<string | null>(null);
  const [importProgressCurrent, setImportProgressCurrent] = useState<number | null>(null);
  const [importProgressTotal, setImportProgressTotal] = useState<number | null>(null);
  const [showImportUrlInput, setShowImportUrlInput] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [appendImportToExisting, setAppendImportToExisting] = useState(false);
  const [importResultDialog, setImportResultDialog] = useState<ImportResultDialogState | null>(null);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [pendingImportBookName, setPendingImportBookName] = useState<string | null>(null);
  const [pendingImportBookCode, setPendingImportBookCode] = useState<string | null>(null);
  const [showImportUploadConfirm, setShowImportUploadConfirm] = useState(false);
  const [bulkFileResults, setBulkFileResults] = useState<BulkFileResult[]>([]);
  const [bulkRunning, setBulkRunning] = useState(false);

  const pollImportJob = useCallback(
    async (
      jobId: string,
      options?: {
        canonicalJsonUrl?: string | null;
        showResumeMessage?: boolean;
        bookName?: string | null;
      }
    ) => {
      if (!jobId) {
        return;
      }

      importPollingRunIdRef.current += 1;
      const runId = importPollingRunIdRef.current;
      activeImportJobIdRef.current = jobId;

      const updateProgressState = (
        status: ImportJobLifecycleStatus,
        message: string | null,
        current: number | null,
        total: number | null
      ) => {
        if (importPollingRunIdRef.current !== runId) {
          return false;
        }

        setImportSubmitting(status === "queued" || status === "running");
        setImportProgressMessage(message);
        setImportProgressCurrent(current);
        setImportProgressTotal(total);
        writePersistedImportJobState({
          jobId,
          status,
          progressMessage: message,
          progressCurrent: current,
          progressTotal: total,
          canonicalJsonUrl: options?.canonicalJsonUrl ?? null,
        });
        return true;
      };

      if (options?.showResumeMessage) {
        updateProgressState("running", "Resuming import status...", null, null);
      }

      const pollIntervalMs = 2000;
      const maxPollAttempts = 900;
      let finalResult: ImportResult | null = null;
      const resolvedBookName =
        typeof options?.bookName === "string" && options.bookName.trim()
          ? options.bookName.trim()
          : "Book";

      for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
        if (importPollingRunIdRef.current !== runId) {
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

        if (importPollingRunIdRef.current !== runId) {
          return;
        }

        const statusResponse = await fetch(`/api/content/import/jobs/${encodeURIComponent(jobId)}`, {
          method: "GET",
          cache: "no-store",
          credentials: "include",
          headers: { Accept: "application/json" },
        });

        const statusRawText = await statusResponse.text();
        let statusPayload: ImportJobStatus | null = null;
        if (statusRawText) {
          try {
            const parsed = JSON.parse(statusRawText) as unknown;
            if (parsed && typeof parsed === "object") {
              statusPayload = parsed as ImportJobStatus;
            }
          } catch {
            statusPayload = null;
          }
        }

        if (!statusResponse.ok) {
          clearPersistedImportJobState();
          activeImportJobIdRef.current = null;
          setImportSubmitting(false);
          setImportProgressMessage(null);
          setImportProgressCurrent(null);
          setImportProgressTotal(null);
          const fallbackDetail =
            statusRawText.trim() || `Import status failed (${statusResponse.status} ${statusResponse.statusText})`;
          setImportResultDialog({
            bookName: resolvedBookName,
            status: "error",
            nodesCreated: null,
            reason: statusPayload?.detail || statusPayload?.error || fallbackDetail,
          });
          return;
        }

        const nextStatus = statusPayload?.status || "running";
        const nextMessage = statusPayload?.progress_message || nextStatus || "Importing...";
        const nextCurrent =
          typeof statusPayload?.progress_current === "number" ? statusPayload.progress_current : null;
        const nextTotal =
          typeof statusPayload?.progress_total === "number" ? statusPayload.progress_total : null;

        if (!updateProgressState(nextStatus, nextMessage, nextCurrent, nextTotal)) {
          return;
        }

        if (nextStatus === "queued" || nextStatus === "running") {
          continue;
        }

        if (nextStatus === "failed") {
          clearPersistedImportJobState();
          activeImportJobIdRef.current = null;
          setImportSubmitting(false);
          setImportProgressMessage(null);
          setImportProgressCurrent(null);
          setImportProgressTotal(null);
          setImportResultDialog({
            bookName: resolvedBookName,
            status: "error",
            nodesCreated: null,
            reason: statusPayload?.error || statusPayload?.result?.error || "Import job failed",
          });
          return;
        }

        finalResult = statusPayload?.result ?? null;
        break;
      }

      if (importPollingRunIdRef.current !== runId) {
        return;
      }

      if (!finalResult) {
        setImportResultDialog({
          bookName: resolvedBookName,
          status: "error",
          nodesCreated: null,
          reason: "Import is still running. Please wait and try again in a minute.",
        });
        return;
      }

      if (finalResult.success === false) {
        clearPersistedImportJobState();
        activeImportJobIdRef.current = null;
        setImportSubmitting(false);
        setImportProgressMessage(null);
        setImportProgressCurrent(null);
        setImportProgressTotal(null);
        setImportResultDialog({
          bookName: resolvedBookName,
          status: "error",
          nodesCreated: null,
          reason: finalResult.detail || finalResult.error || "Import failed",
        });
        return;
      }

      await loadBooksRefreshRef.current();

      clearPersistedImportJobState();
      activeImportJobIdRef.current = null;
      setImportSubmitting(false);
      setImportProgressMessage(null);
      setImportProgressCurrent(null);
      setImportProgressTotal(null);
      setShowImportUrlInput(false);
      setImportUrl("");
      setImportResultDialog({
        bookName: resolvedBookName,
        status: "completed",
        nodesCreated: typeof finalResult.nodes_created === "number" ? finalResult.nodes_created : null,
        reason: "",
      });
    },
    // loadBooksRefreshRef is a stable ref — no dep needed
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Cancel in-flight polling on unmount
  useEffect(() => {
    return () => {
      importPollingRunIdRef.current += 1;
    };
  }, []);

  // Resume a persisted import job from a previous page load
  useEffect(() => {
    const persistedJob = readPersistedImportJobState();
    if (!persistedJob) {
      return;
    }

    // Upload-phase sentinel: chunked upload was in progress when page was left — cannot resume
    if (persistedJob.status === "uploading" || !persistedJob.jobId) {
      clearPersistedImportJobState();
      setImportSubmitting(false);
      setImportProgressMessage("A previous file upload was interrupted. Please re-upload the file.");
      return;
    }

    if (persistedJob.status === "succeeded" || persistedJob.status === "failed") {
      clearPersistedImportJobState();
      return;
    }
    if (activeImportJobIdRef.current === persistedJob.jobId) {
      return;
    }

    // Only open the URL input panel if the user was actually using URL import
    const wasUrlImport = Boolean(persistedJob.fromUrlInput);
    setImportSubmitting(true);
    setShowImportUrlInput(wasUrlImport);
    if (wasUrlImport && typeof persistedJob.canonicalJsonUrl === "string" && persistedJob.canonicalJsonUrl) {
      setImportUrl(persistedJob.canonicalJsonUrl);
    }
    setImportProgressMessage(persistedJob.progressMessage || "Resuming import status...");
    setImportProgressCurrent(
      typeof persistedJob.progressCurrent === "number" ? persistedJob.progressCurrent : null
    );
    setImportProgressTotal(
      typeof persistedJob.progressTotal === "number" ? persistedJob.progressTotal : null
    );

    void pollImportJob(persistedJob.jobId, {
      canonicalJsonUrl: persistedJob.canonicalJsonUrl ?? null,
      showResumeMessage: true,
      bookName:
        persistedJob.canonicalJsonUrl
          ?.split("?")[0]
          .split("#")[0]
          .split("/")
          .filter(Boolean)
          .pop()
          ?.replace(/\.json$/i, "")
          .replace(/[-_]+/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .replace(/\b\w/g, (ch) => ch.toUpperCase()) || "Book",
    });
  }, [pollImportJob]);

  const startImportBookFile = async (
    file: File,
    allowExistingContent: boolean,
    bookName: string
  ) => {
    if (!file || !canImport) return;

    setImportSubmitting(true);
    setImportProgressMessage("Preparing import...");
    setImportProgressCurrent(null);
    setImportProgressTotal(null);
    clearPersistedImportJobState();
    try {
      const retryableStatuses = new Set([429, 500, 502, 503, 504]);
      const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      let initResponse: Response | null = null;
      let initRaw = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        initResponse = await fetch("/api/content/import/canonical-uploads/init", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, size_bytes: file.size }),
        });
        initRaw = await initResponse.text();
        if (initResponse.ok || !retryableStatuses.has(initResponse.status) || attempt === 2) {
          break;
        }
        setImportProgressMessage(`Preparing upload... retry ${attempt + 2}/3`);
        await pause(400 * (attempt + 1));
      }

      let initResult: CanonicalUploadInit | null = null;
      try {
        initResult = JSON.parse(initRaw) as CanonicalUploadInit;
      } catch {
        initResult = null;
      }

      if (!initResponse || !initResponse.ok) {
        const fallback = `Upload init failed (${initResponse?.status ?? 0})`;
        setImportResultDialog({
          bookName,
          status: "error",
          nodesCreated: null,
          reason: initResult?.detail || initResult?.error || fallback,
        });
        return;
      }

      const uploadId = typeof initResult?.upload_id === "string" ? initResult.upload_id : "";
      if (!uploadId) {
        setImportResultDialog({
          bookName,
          status: "error",
          nodesCreated: null,
          reason: "Upload init returned no upload ID",
        });
        return;
      }

      const chunkSizeBytes =
        typeof initResult?.chunk_size_bytes === "number" && initResult.chunk_size_bytes > 0
          ? initResult.chunk_size_bytes
          : IMPORT_CANONICAL_CHUNK_FALLBACK_BYTES;
      const totalChunks = Math.max(1, Math.ceil(file.size / chunkSizeBytes));

      setImportProgressMessage("Uploading chunks...");
      setImportProgressCurrent(0);
      setImportProgressTotal(totalChunks);
      writePersistedImportJobState({
        jobId: "",
        status: "uploading",
        progressMessage: "Uploading chunks...",
        progressCurrent: 0,
        progressTotal: totalChunks,
        canonicalJsonUrl: null,
        fromUrlInput: false,
      });

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * chunkSizeBytes;
        const end = Math.min(start + chunkSizeBytes, file.size);
        const chunkBlob = file.slice(start, end);
        const chunkForm = new FormData();
        chunkForm.append("index", String(chunkIndex));
        chunkForm.append("chunk", new File([chunkBlob], `${file.name}.part`, { type: "application/octet-stream" }));

        let chunkResponse: Response | null = null;
        let chunkRaw = "";
        for (let attempt = 0; attempt < 3; attempt++) {
          chunkResponse = await fetch(
            `/api/content/import/canonical-uploads/${encodeURIComponent(uploadId)}/chunk`,
            { method: "POST", credentials: "include", body: chunkForm }
          );
          chunkRaw = await chunkResponse.text();
          if (chunkResponse.ok || !retryableStatuses.has(chunkResponse.status) || attempt === 2) {
            break;
          }
          setImportProgressMessage(`Uploading chunks... retry ${attempt + 2}/3`);
          setImportProgressCurrent(chunkIndex);
          setImportProgressTotal(totalChunks);
          await pause(300 * (attempt + 1));
        }

        let chunkResult: CanonicalUploadChunk | null = null;
        try {
          chunkResult = JSON.parse(chunkRaw) as CanonicalUploadChunk;
        } catch {
          chunkResult = null;
        }

        if (!chunkResponse || !chunkResponse.ok) {
          const fallback = `Chunk upload failed (${chunkResponse?.status ?? 0})`;
          setImportResultDialog({
            bookName,
            status: "error",
            nodesCreated: null,
            reason: chunkResult?.detail || chunkResult?.error || fallback,
          });
          return;
        }

        setImportProgressMessage("Uploading chunks...");
        setImportProgressCurrent(chunkIndex + 1);
        setImportProgressTotal(totalChunks);
      }

      setImportProgressMessage("Finalizing upload...");
      setImportProgressCurrent(null);
      setImportProgressTotal(null);

      const completeResponse = await fetch(
        `/api/content/import/canonical-uploads/${encodeURIComponent(uploadId)}/complete`,
        { method: "POST", credentials: "include" }
      );
      const completeRaw = await completeResponse.text();

      let completeResult: CanonicalUploadComplete | null = null;
      try {
        completeResult = JSON.parse(completeRaw) as CanonicalUploadComplete;
      } catch {
        completeResult = null;
      }

      if (!completeResponse.ok) {
        const fallback = `Upload completion failed (${completeResponse.status})`;
        setImportResultDialog({
          bookName,
          status: "error",
          nodesCreated: null,
          reason: completeResult?.detail || completeResult?.error || fallback,
        });
        return;
      }

      const canonicalJsonUrl =
        typeof completeResult?.canonical_json_url === "string"
          ? completeResult.canonical_json_url.trim()
          : "";
      if (!canonicalJsonUrl) {
        setImportResultDialog({
          bookName,
          status: "error",
          nodesCreated: null,
          reason: "Upload did not return a canonical URL",
        });
        return;
      }

      setImportProgressMessage("Starting import...");
      const response = await fetch("/api/content/import/jobs", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          import_type: "json",
          schema_version: "hsp-book-json-v1",
          canonical_json_url: canonicalJsonUrl,
          ...(allowExistingContent ? { allow_existing_content: true } : {}),
        }),
      });

      const startResult = (await response.json().catch(() => null)) as
        | {
            job_id?: string;
            status?: ImportJobLifecycleStatus;
            error?: string;
            detail?: string;
          }
        | null;

      if (!response.ok) {
        setImportResultDialog({
          bookName,
          status: "error",
          nodesCreated: null,
          reason: startResult?.detail || startResult?.error || "Failed to start import book job",
        });
        return;
      }

      const jobId = typeof startResult?.job_id === "string" ? startResult.job_id : "";
      if (!jobId) {
        setImportResultDialog({
          bookName,
          status: "error",
          nodesCreated: null,
          reason: "Import job did not return a valid job ID",
        });
        return;
      }

      const queuedMessage = startResult?.status === "queued" ? "Queued" : "Starting import...";
      setImportProgressMessage(queuedMessage);
      setImportProgressCurrent(0);
      setImportProgressTotal(null);
      writePersistedImportJobState({
        jobId,
        status: startResult?.status || "queued",
        progressMessage: queuedMessage,
        progressCurrent: 0,
        progressTotal: null,
        canonicalJsonUrl,
        fromUrlInput: false,
      });

      await pollImportJob(jobId, { canonicalJsonUrl, bookName });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to import JSON file";
      setImportResultDialog({
        bookName,
        status: "error",
        nodesCreated: null,
        reason: message,
      });
    } finally {
      if (activeImportJobIdRef.current === null) {
        setImportSubmitting(false);
        setImportProgressMessage(null);
        setImportProgressCurrent(null);
        setImportProgressTotal(null);
      }
    }
  };

  // Helper: update one entry in bulkFileResults by index
  const updateBulkRow = (index: number, patch: Partial<BulkFileResult>) => {
    setBulkFileResults((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const runBulkImportFiles = async (files: File[]) => {
    if (files.length === 0 || !canImport) return;
    setBulkRunning(true);
    setBulkFileResults(
      files.map((f) => ({
        name: f.name,
        status: "pending",
        message: "Waiting for previous files…",
      }))
    );

    type BulkJobStatus = {
      status?: string;
      progress_message?: string;
      progress_current?: number;
      progress_total?: number;
      error?: string;
      detail?: string;
      result?: { success?: boolean; error?: string; nodes_created?: number };
    };
    const retryableStatuses = new Set([429, 500, 502, 503, 504]);
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const pollBulkImportJobUntilDone = async (index: number, jobId: string, startedAt: number) => {
      let hasPolledOnce = false;
      while (true) {
        if (hasPolledOnce) {
          await pause(750);
        }
        hasPolledOnce = true;
        try {
          const pollResponse = await fetch(`/api/content/import/jobs/${encodeURIComponent(jobId)}`, {
            method: "GET",
            cache: "no-store",
            credentials: "include",
            headers: { Accept: "application/json" },
          });
          const pollRaw = await pollResponse.text();
          let pollStatus: BulkJobStatus | null = null;
          try {
            pollStatus = JSON.parse(pollRaw) as BulkJobStatus;
          } catch {
            pollStatus = null;
          }

          if (!pollResponse.ok) {
            // Keep retrying transient backend/proxy failures for long-running jobs.
            if ([429, 500, 502, 503, 504].includes(pollResponse.status)) {
              updateBulkRow(index, {
                status: "uploading",
                progressMessage: "Waiting for status…",
                message: "Polling import status",
              });
              continue;
            }
            const msg =
              pollStatus?.error ||
              pollStatus?.detail ||
              `Status poll failed (${pollResponse.status})`;
            updateBulkRow(index, {
              status: "error",
              message: msg,
              progressMessage: null,
              progressCurrent: null,
              progressTotal: null,
              elapsedMs: Math.round(performance.now() - startedAt),
            });
            return;
          }

          const jobStatus = (pollStatus?.status || "running").toLowerCase();
          const jobMsg = pollStatus?.progress_message || jobStatus || "Importing…";
          const jobCurrent =
            typeof pollStatus?.progress_current === "number"
              ? pollStatus.progress_current
              : null;
          const jobTotal =
            typeof pollStatus?.progress_total === "number"
              ? pollStatus.progress_total
              : null;
          updateBulkRow(index, {
            status: "uploading",
            message: jobStatus === "queued" ? "Queued on server" : jobMsg,
            progressMessage: jobMsg,
            progressCurrent: jobCurrent,
            progressTotal: jobTotal,
          });

          if (jobStatus === "queued" || jobStatus === "running") {
            continue;
          }

          if (jobStatus === "failed") {
            const msg = pollStatus?.error || pollStatus?.result?.error || "Import failed";
            updateBulkRow(index, {
              status: "error",
              message: msg,
              progressMessage: null,
              progressCurrent: null,
              progressTotal: null,
              elapsedMs: Math.round(performance.now() - startedAt),
            });
            return;
          }

          const finalJobResult = pollStatus?.result ?? null;
          if (finalJobResult?.success === false) {
            const errorMsg = finalJobResult.error ?? "Import failed";
            if (errorMsg.toLowerCase().includes("already")) {
              updateBulkRow(index, {
                status: "skipped",
                message: "Already exists — skipped",
                progressMessage: null,
                progressCurrent: null,
                progressTotal: null,
                elapsedMs: Math.round(performance.now() - startedAt),
              });
            } else {
              updateBulkRow(index, {
                status: "error",
                message: errorMsg,
                progressMessage: null,
                progressCurrent: null,
                progressTotal: null,
                elapsedMs: Math.round(performance.now() - startedAt),
              });
            }
            return;
          }

          const nodes = finalJobResult?.nodes_created ?? 0;
          updateBulkRow(index, {
            status: "success",
            message: `${nodes} node${nodes === 1 ? "" : "s"} imported`,
            progressMessage: null,
            progressCurrent: null,
            progressTotal: null,
            elapsedMs: Math.round(performance.now() - startedAt),
          });
          return;
        } catch {
          updateBulkRow(index, {
            status: "uploading",
            progressMessage: "Waiting for status…",
            message: "Polling import status",
          });
        }
      }
    };

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Read only the first 16 KB to extract metadata — schema_version, book_name, book_code
      // always appear near the top of an HSP JSON file. Avoids loading multi-MB files into memory.
      const headerText = await file.slice(0, 16384).text();
      const schemaMatch = /"schema_version"\s*:\s*"([^"]+)"/.exec(headerText);
      if (!schemaMatch || schemaMatch[1] !== "hsp-book-json-v1") {
        updateBulkRow(i, { status: "error", message: "Not an HSP book JSON (missing schema_version)" });
        continue;
      }
      const bookNameMatch = /"book_name"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(headerText);
      const bookCodeMatch = /"book_code"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(headerText);
      const bookName = bookNameMatch ? bookNameMatch[1] : file.name;
      const bookCode = bookCodeMatch ? bookCodeMatch[1] : null;

      // Ask the API whether a book with this name/code already exists.
      // Uses exact-match params — no fuzzy scoring, no false negatives.
      updateBulkRow(i, { message: `Checking "${bookName}"…` });
      try {
        type BookCheck = { book_name?: string; book_code?: string };
        // Check by book_code first (most precise), then fall back to book_name.
        const checkByCode = bookCode
          ? await fetch(`/api/content/books?book_code=${encodeURIComponent(bookCode)}`, { credentials: "include" })
          : null;
        const codeExists =
          checkByCode?.ok &&
          ((await checkByCode.json()) as BookCheck[]).length > 0;

        if (!codeExists) {
          const checkByName = await fetch(
            `/api/content/books?book_name=${encodeURIComponent(bookName)}`,
            { credentials: "include" }
          );
          const nameExists =
            checkByName.ok && ((await checkByName.json()) as BookCheck[]).length > 0;
          if (nameExists) {
            updateBulkRow(i, { status: "skipped", message: "Already exists — skipped" });
            continue;
          }
        } else {
          updateBulkRow(i, { status: "skipped", message: "Already exists — skipped" });
          continue;
        }
      } catch {
        // Non-fatal — if the check fails just proceed with the upload
      }

      const t0 = performance.now();

      try {
        // ── Phase 1: init chunked upload ──────────────────────────────────────
        updateBulkRow(i, {
          status: "uploading",
          message: `Uploading "${bookName}"…`,
          progressMessage: "Preparing upload…",
          progressCurrent: null,
          progressTotal: null,
        });

        let initResponse: Response | null = null;
        let initRaw = "";
        for (let attempt = 0; attempt < 3; attempt++) {
          initResponse = await fetch("/api/content/import/canonical-uploads/init", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: file.name, size_bytes: file.size }),
          });
          initRaw = await initResponse.text();
          if (initResponse.ok || !retryableStatuses.has(initResponse.status) || attempt === 2) {
            break;
          }
          updateBulkRow(i, {
            progressMessage: `Preparing upload… retry ${attempt + 2}/3`,
            progressCurrent: null,
            progressTotal: null,
          });
          await pause(400 * (attempt + 1));
        }
        type BulkUploadInit = { upload_id?: string; chunk_size_bytes?: number; max_size_bytes?: number; detail?: string; error?: string };
        let initResult: BulkUploadInit | null = null;
        try { initResult = JSON.parse(initRaw) as BulkUploadInit; } catch { /* */ }

        if (!initResponse || !initResponse.ok) {
          const statusCode = initResponse?.status ?? 0;
          const msg = initResult?.detail || initResult?.error || `Upload init failed (${statusCode})`;
          updateBulkRow(i, { status: "error", message: msg, progressMessage: null, progressCurrent: null, progressTotal: null, elapsedMs: Math.round(performance.now() - t0) });
          continue;
        }

        const uploadId = typeof initResult?.upload_id === "string" ? initResult.upload_id : "";
        if (!uploadId) {
          updateBulkRow(i, { status: "error", message: "Upload init returned no upload ID", progressMessage: null, progressCurrent: null, progressTotal: null, elapsedMs: Math.round(performance.now() - t0) });
          continue;
        }

        const chunkSizeBytes =
          typeof initResult?.chunk_size_bytes === "number" && initResult.chunk_size_bytes > 0
            ? initResult.chunk_size_bytes
            : IMPORT_CANONICAL_CHUNK_FALLBACK_BYTES;
        const totalChunks = Math.max(1, Math.ceil(file.size / chunkSizeBytes));

        // ── Phase 2: upload chunks ───────────────────────────────────────────
        updateBulkRow(i, { progressMessage: "Uploading chunks…", progressCurrent: 0, progressTotal: totalChunks });

        let chunkFailed = false;
        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
          const start = chunkIndex * chunkSizeBytes;
          const end = Math.min(start + chunkSizeBytes, file.size);
          const chunkBlob = file.slice(start, end);
          const chunkForm = new FormData();
          chunkForm.append("index", String(chunkIndex));
          chunkForm.append("chunk", new File([chunkBlob], `${file.name}.part`, { type: "application/octet-stream" }));

          let chunkResponse: Response | null = null;
          let chunkRaw = "";
          for (let attempt = 0; attempt < 3; attempt++) {
            chunkResponse = await fetch(
              `/api/content/import/canonical-uploads/${encodeURIComponent(uploadId)}/chunk`,
              { method: "POST", credentials: "include", body: chunkForm }
            );
            chunkRaw = await chunkResponse.text();
            if (chunkResponse.ok || !retryableStatuses.has(chunkResponse.status) || attempt === 2) {
              break;
            }
            updateBulkRow(i, {
              progressMessage: `Uploading chunks… retry ${attempt + 2}/3`,
              progressCurrent: chunkIndex,
              progressTotal: totalChunks,
            });
            await pause(300 * (attempt + 1));
          }
          type BulkUploadChunk = { detail?: string; error?: string };
          let chunkResult: BulkUploadChunk | null = null;
          try { chunkResult = JSON.parse(chunkRaw) as BulkUploadChunk; } catch { /* */ }

          if (!chunkResponse || !chunkResponse.ok) {
            const statusCode = chunkResponse?.status ?? 0;
            const msg = chunkResult?.detail || chunkResult?.error || `Chunk upload failed (${statusCode})`;
            updateBulkRow(i, { status: "error", message: msg, progressMessage: null, progressCurrent: null, progressTotal: null, elapsedMs: Math.round(performance.now() - t0) });
            chunkFailed = true;
            break;
          }

          updateBulkRow(i, { progressMessage: "Uploading chunks…", progressCurrent: chunkIndex + 1 });
        }
        if (chunkFailed) continue;

        // ── Phase 3: complete upload ─────────────────────────────────────────
        updateBulkRow(i, { progressMessage: "Finalizing upload…", progressCurrent: null, progressTotal: null });

        const completeResponse = await fetch(
          `/api/content/import/canonical-uploads/${encodeURIComponent(uploadId)}/complete`,
          { method: "POST", credentials: "include" }
        );
        const completeRaw = await completeResponse.text();
        type BulkUploadComplete = { canonical_json_url?: string; detail?: string; error?: string };
        let completeResult: BulkUploadComplete | null = null;
        try { completeResult = JSON.parse(completeRaw) as BulkUploadComplete; } catch { /* */ }

        if (!completeResponse.ok) {
          const msg = completeResult?.detail || completeResult?.error || `Upload completion failed (${completeResponse.status})`;
          updateBulkRow(i, { status: "error", message: msg, progressMessage: null, progressCurrent: null, progressTotal: null, elapsedMs: Math.round(performance.now() - t0) });
          continue;
        }

        const canonicalJsonUrl = typeof completeResult?.canonical_json_url === "string" ? completeResult.canonical_json_url.trim() : "";
        if (!canonicalJsonUrl) {
          updateBulkRow(i, { status: "error", message: "Upload did not return a canonical URL", progressMessage: null, progressCurrent: null, progressTotal: null, elapsedMs: Math.round(performance.now() - t0) });
          continue;
        }

        // ── Phase 4: start import job ────────────────────────────────────────
        updateBulkRow(i, { progressMessage: "Starting import…", progressCurrent: null, progressTotal: null });

        const jobResponse = await fetch("/api/content/import/jobs", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ import_type: "json", schema_version: "hsp-book-json-v1", canonical_json_url: canonicalJsonUrl }),
        });
        const jobRaw = await jobResponse.text();
        type BulkJobStart = { job_id?: string; status?: string; detail?: string; error?: string };
        let jobResult: BulkJobStart | null = null;
        try { jobResult = JSON.parse(jobRaw) as BulkJobStart; } catch { /* */ }

        if (!jobResponse.ok) {
          const msg = jobResult?.detail || jobResult?.error || `Import start failed (${jobResponse.status})`;
          updateBulkRow(i, { status: "error", message: msg, progressMessage: null, progressCurrent: null, progressTotal: null, elapsedMs: Math.round(performance.now() - t0) });
          continue;
        }

        const jobId = typeof jobResult?.job_id === "string" ? jobResult.job_id : "";
        if (!jobId) {
          updateBulkRow(i, { status: "error", message: "Import job returned no job ID", progressMessage: null, progressCurrent: null, progressTotal: null, elapsedMs: Math.round(performance.now() - t0) });
          continue;
        }

        updateBulkRow(i, {
          status: "uploading",
          message: "Queued on server",
          progressMessage: "Queued",
          progressCurrent: 0,
          progressTotal: null,
        });
        await pollBulkImportJobUntilDone(i, jobId, t0);
      } catch (err) {
        updateBulkRow(i, {
          status: "error",
          message: err instanceof Error ? err.message : "Unknown error",
          progressMessage: null,
          progressCurrent: null,
          progressTotal: null,
          elapsedMs: Math.round(performance.now() - t0),
        });
      }
    }

    setBulkRunning(false);
    void loadBooksRefreshRef.current();
  };

  const handleImportBookFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    // Snapshot into Array before clearing the input — clearing input.value invalidates the FileList in some browsers
    const filesArray = Array.from(event.target.files ?? []);
    event.currentTarget.value = "";
    if (filesArray.length === 0 || !canImport) return;

    // Multiple files → bulk import flow (no confirmation dialog)
    if (filesArray.length > 1) {
      void runBulkImportFiles(filesArray);
      return;
    }

    const file = filesArray[0];

    let detectedBookName: string | null = null;
    let detectedBookCode: string | null = null;
    try {
      const parsed = JSON.parse(await file.text()) as {
        book?: { book_name?: unknown; book_code?: unknown };
      };
      const rawBookName = parsed?.book?.book_name;
      const rawBookCode = parsed?.book?.book_code;
      if (typeof rawBookName === "string" && rawBookName.trim()) {
        detectedBookName = rawBookName.trim();
      }
      if (typeof rawBookCode === "string" && rawBookCode.trim()) {
        detectedBookCode = rawBookCode.trim();
      }
    } catch {
      detectedBookName = null;
      detectedBookCode = null;
    }

    setPendingImportFile(file);
    setPendingImportBookName(detectedBookName);
    setPendingImportBookCode(detectedBookCode);
    setAppendImportToExisting(false);
    setShowImportUploadConfirm(true);
  };

  const handleImportBookUrl = async () => {
    if (!canImport) return;

    const trimmedUrl = importUrl.trim();
    const inferredBookName =
      trimmedUrl
        .split("?")[0]
        .split("#")[0]
        .split("/")
        .filter(Boolean)
        .pop()
        ?.replace(/\.json$/i, "")
        .replace(/[-_]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (ch) => ch.toUpperCase()) || "Book";

    if (!trimmedUrl) {
      setImportResultDialog({
        bookName: inferredBookName,
        status: "error",
        nodesCreated: null,
        reason: "Enter a public raw JSON URL",
      });
      return;
    }

    let canonicalJsonUrl = trimmedUrl;
    let forceReimport = false;
    let allowExistingContent = false;

    try {
      const parsedUrl = new URL(trimmedUrl);
      const forceParam = parsedUrl.searchParams.get("force_reimport");
      const allowParam = parsedUrl.searchParams.get("allow_existing_content");
      forceReimport = forceParam === "true";
      allowExistingContent = allowParam === "true";

      if (forceParam !== null) {
        parsedUrl.searchParams.delete("force_reimport");
      }
      if (allowParam !== null) {
        parsedUrl.searchParams.delete("allow_existing_content");
      }
      canonicalJsonUrl = parsedUrl.toString();
    } catch {
      canonicalJsonUrl = trimmedUrl;
    }

    setImportSubmitting(true);
    setImportProgressMessage("Starting import...");
    setImportProgressCurrent(0);
    setImportProgressTotal(null);
    try {
      const response = await fetch("/api/content/import/jobs", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          import_type: "json",
          schema_version: "hsp-book-json-v1",
          canonical_json_url: canonicalJsonUrl,
          ...(forceReimport ? { force_reimport: true } : {}),
          ...(allowExistingContent ? { allow_existing_content: true } : {}),
        }),
      });

      const rawText = await response.text();

      let startResult: ImportJobStart | null = null;
      if (rawText) {
        try {
          const parsed = JSON.parse(rawText) as unknown;
          if (parsed && typeof parsed === "object") {
            startResult = parsed as ImportJobStart;
          }
        } catch {
          startResult = null;
        }
      }

      if (!response.ok) {
        const fallbackDetail = rawText.trim() || `Import start failed (${response.status} ${response.statusText})`;
        setImportResultDialog({
          bookName: inferredBookName,
          status: "error",
          nodesCreated: null,
          reason: startResult?.detail || startResult?.error || fallbackDetail,
        });
        return;
      }

      const jobId = typeof startResult?.job_id === "string" ? startResult.job_id : "";
      if (!jobId) {
        setImportResultDialog({
          bookName: inferredBookName,
          status: "error",
          nodesCreated: null,
          reason: "Import job did not return a valid job ID",
        });
        return;
      }

      const queuedMessage = startResult?.status === "queued" ? "Queued" : "Starting import...";
      setImportProgressMessage(queuedMessage);
      setImportProgressCurrent(null);
      setImportProgressTotal(null);
      writePersistedImportJobState({
        jobId,
        status: startResult?.status || "queued",
        progressMessage: queuedMessage,
        progressCurrent: 0,
        progressTotal: null,
        canonicalJsonUrl,
        fromUrlInput: true,
      });

      await pollImportJob(jobId, { canonicalJsonUrl, bookName: inferredBookName });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to import JSON from URL";
      setImportResultDialog({
        bookName: inferredBookName,
        status: "error",
        nodesCreated: null,
        reason: message,
      });
    } finally {
      if (activeImportJobIdRef.current === null) {
        setImportSubmitting(false);
        setImportProgressMessage(null);
        setImportProgressCurrent(null);
        setImportProgressTotal(null);
      }
    }
  };

  return {
    importBookInputRef,
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
    importResultDialog,
    setImportResultDialog,
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
    pollImportJob,
    startImportBookFile,
    runBulkImportFiles,
    handleImportBookFile,
    handleImportBookUrl,
  };
}
