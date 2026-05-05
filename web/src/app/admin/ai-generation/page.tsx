"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Play, X } from "lucide-react";
import { getMe } from "@/lib/authClient";

type Toast = {
  type: "success" | "error";
  message: string;
};

type BookOption = {
  id: number;
  book_name: string;
  verse_count?: number | null;
  metadata?: Record<string, unknown> | null;
  metadata_json?: Record<string, unknown> | null;
};

type CartItem = {
  id: number;
  cart_id: number;
  item_id: number;
  item_type: "library_node" | "user_content";
  source_book_id: number | null;
  order: number;
  added_at: string;
};

type CartPublic = {
  id: number;
  owner_id: number;
  title: string;
  items: CartItem[];
};

type GenerationSummaryResponse = {
  total_jobs: number;
  total_verses_generated: number;
  total_cost_usd: number;
  projected_total_cost_usd: number;
  jobs_by_status: Record<string, number>;
  cost_by_book: Array<{
    book_name: string;
    total_cost: number;
    verses_generated: number;
  }>;
  languages_covered: Array<{
    language_code: string;
    verse_count: number;
  }>;
};

type GenerationEstimateResponse = {
  total_nodes: number;
  estimated_cost_realtime: number;
  estimated_cost_batch: number;
};

type BatchStatusSnapshot = {
  batch_id: string;
  processing_status?: string | null;
  status?: string | null;
  requests_total?: number | null;
  requests_completed?: number | null;
  requests_processing?: number | null;
  error?: string | null;
  retrieved_at: string;
};

type AIJob = {
  id: number;
  book_id: number | null;
  language_code: string | null;
  status: string;
  total_nodes: number;
  processed_nodes: number;
  failed_nodes: number;
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string | null;
  source_type: string | null;
  source_label: string | null;
  error_log: Array<{ error?: string; message?: string } & Record<string, unknown>> | null;
  metadata: Record<string, unknown> | null;
  batch_status_snapshot?: BatchStatusSnapshot | null;
};

type LanguageOption = {
  code: "en" | "te" | "hi" | "ta";
  label: string;
};

const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: "en", label: "English" },
  { code: "te", label: "Telugu" },
  { code: "hi", label: "Hindi" },
  { code: "ta", label: "Tamil" },
];

const LANGUAGE_LABELS = Object.fromEntries(
  LANGUAGE_OPTIONS.map((option) => [option.code, option.label])
) as Record<LanguageOption["code"], string>;

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat("en-US");

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

const MAX_ADDITIONAL_INSTRUCTIONS = 500;

const parsePayload = (raw: string) => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

const getErrorMessage = (raw: string, fallback: string) => {
  const parsed = parsePayload(raw) as { detail?: string } | null;
  if (parsed?.detail) return parsed.detail;
  const trimmed = raw.trim();
  return trimmed || fallback;
};

const formatCurrency = (value: number | null | undefined) =>
  currencyFormatter.format(Number.isFinite(value ?? NaN) ? Number(value) : 0);

const formatInteger = (value: number | null | undefined) =>
  numberFormatter.format(Number.isFinite(value ?? NaN) ? Number(value) : 0);

const formatDurationMs = (value: number | null | undefined) => {
  if (!Number.isFinite(value ?? NaN) || value === null || value === undefined || value < 0) {
    return "--";
  }

  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
};

const formatDate = (value: string | null | undefined) => {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return dateTimeFormatter.format(date);
};

const getBookMetadata = (book: BookOption) => {
  if (book.metadata && typeof book.metadata === "object") {
    return book.metadata;
  }
  if (book.metadata_json && typeof book.metadata_json === "object") {
    return book.metadata_json;
  }
  return null;
};

const getBookVerseCount = (book: BookOption) => {
  if (typeof book.verse_count === "number") {
    return book.verse_count;
  }

  const metadata = getBookMetadata(book);
  const stats =
    metadata?.stats && typeof metadata.stats === "object"
      ? (metadata.stats as Record<string, unknown>)
      : null;
  const candidates = [metadata?.verse_count, metadata?.total_verses, metadata?.node_count, stats?.verse_count];

  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return null;
};

const getJobMetadata = (job: AIJob) =>
  job.metadata && typeof job.metadata === "object" ? job.metadata : {};

const getJobMode = (job: AIJob) =>
  getJobMetadata(job).mode === "batch" ? "batch" : "realtime";

const getJobSourceLabel = (job: AIJob, bookNameById: Map<number, string>) => {
  if (job.source_label) return job.source_label;
  if (job.source_type === "basket") {
    const count = getJobMetadata(job).basket_item_count ?? job.total_nodes;
    return `Basket (${count} verses)`;
  }
  if (job.book_id) return bookNameById.get(job.book_id) || `Book #${job.book_id}`;
  return "Unknown";
};

const getJobLanguageLabel = (job: AIJob) => {
  const metadata = getJobMetadata(job);
  if (typeof metadata.language_name === "string" && metadata.language_name.trim()) {
    return metadata.language_name;
  }
  if (job.language_code && job.language_code in LANGUAGE_LABELS) {
    return LANGUAGE_LABELS[job.language_code as LanguageOption["code"]];
  }
  return job.language_code || "Unknown";
};

const getJobProgress = (job: AIJob) => {
  const snapshotTotal = job.batch_status_snapshot?.requests_total;
  const snapshotCompleted = job.batch_status_snapshot?.requests_completed;
  const total =
    typeof snapshotTotal === "number" && snapshotTotal > 0 ? snapshotTotal : job.total_nodes;
  const processed = Math.max(
    job.processed_nodes,
    typeof snapshotCompleted === "number" ? snapshotCompleted : 0
  );
  const safeTotal = total > 0 ? total : 0;
  const ratio = safeTotal > 0 ? Math.min(1, processed / safeTotal) : 0;

  return {
    processed,
    total: safeTotal,
    ratio,
    percent: safeTotal > 0 ? Math.min(100, Math.round(ratio * 100)) : 0,
  };
};

const getJobElapsedMs = (job: AIJob) => {
  if (!job.started_at) return null;
  const startedAt = new Date(job.started_at).getTime();
  if (Number.isNaN(startedAt)) return null;
  const endAt = job.completed_at ? new Date(job.completed_at).getTime() : Date.now();
  if (Number.isNaN(endAt) || endAt < startedAt) return null;
  return endAt - startedAt;
};

const getJobRemainingMs = (job: AIJob) => {
  const elapsedMs = getJobElapsedMs(job);
  const progress = getJobProgress(job);
  if (!elapsedMs || progress.processed <= 0 || progress.total <= progress.processed) {
    return null;
  }

  const msPerNode = elapsedMs / progress.processed;
  return Math.max(0, Math.round((progress.total - progress.processed) * msPerNode));
};

const getJobCostSoFar = (job: AIJob) => {
  if (typeof job.actual_cost_usd === "number" && Number.isFinite(job.actual_cost_usd)) {
    return job.actual_cost_usd;
  }

  const estimate = typeof job.estimated_cost_usd === "number" ? job.estimated_cost_usd : 0;
  const totalEstimate = getJobMode(job) === "batch" ? estimate / 2 : estimate;
  return totalEstimate * getJobProgress(job).ratio;
};

const getJobErrorSummary = (job: AIJob) => {
  if (!Array.isArray(job.error_log) || job.error_log.length === 0) {
    return "--";
  }

  const entry = job.error_log.find((item) => item?.error || item?.message) || job.error_log[0];
  return entry.error || entry.message || JSON.stringify(entry);
};

const getStatusClasses = (status: string) => {
  if (status === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "failed") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (status === "cancelled") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-blue-200 bg-blue-50 text-blue-700";
};

const getJobAdditionalInstructions = (job: AIJob): string | null => {
  const value = getJobMetadata(job).additional_instructions;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const truncateWithEllipsis = (value: string, maxLength: number) => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}...`;
};

export default function AdminAiGenerationPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [canAdmin, setCanAdmin] = useState(false);

  const [books, setBooks] = useState<BookOption[]>([]);
  const [booksLoading, setBooksLoading] = useState(false);
  const [basket, setBasket] = useState<CartPublic | null>(null);
  const [basketLoading, setBasketLoading] = useState(false);
  const [summary, setSummary] = useState<GenerationSummaryResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [allJobs, setAllJobs] = useState<AIJob[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [activeJobs, setActiveJobs] = useState<AIJob[]>([]);
  const [activeLoading, setActiveLoading] = useState(false);
  const [estimate, setEstimate] = useState<GenerationEstimateResponse | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancellingJobId, setCancellingJobId] = useState<number | null>(null);

  const [selectedSourceId, setSelectedSourceId] = useState(""); // "basket" | book id string
  const [languageCode, setLanguageCode] = useState<LanguageOption["code"]>("en");
  const [mode, setMode] = useState<"batch" | "realtime">("batch");
  const [limitMode, setLimitMode] = useState<"all" | "custom">("all");
  const [customLimit, setCustomLimit] = useState("");
  const [additionalInstructions, setAdditionalInstructions] = useState("");

  const activeJobsLoaderRef = useRef<((options?: { silent?: boolean }) => Promise<void>) | null>(null);
  const allJobsLoaderRef = useRef<((options?: { silent?: boolean }) => Promise<void>) | null>(null);

  const selectedLanguage = useMemo(
    () => LANGUAGE_OPTIONS.find((option) => option.code === languageCode) || LANGUAGE_OPTIONS[0],
    [languageCode]
  );

  const isBasketSelected = selectedSourceId === "basket";

  const selectedBook = useMemo(
    () => (isBasketSelected ? null : books.find((book) => book.id === Number(selectedSourceId)) || null),
    [books, selectedSourceId, isBasketSelected]
  );

  const basketNodeCount = useMemo(
    () => basket?.items.filter((i) => i.item_type === "library_node").length ?? 0,
    [basket]
  );

  const basketBookCount = useMemo(
    () =>
      new Set(
        (basket?.items ?? [])
          .filter((i) => i.item_type === "library_node" && typeof i.source_book_id === "number")
          .map((i) => i.source_book_id)
      ).size,
    [basket]
  );

  const parsedCustomLimit = useMemo(() => {
    if (limitMode !== "custom") return null;
    const numericValue = Number.parseInt(customLimit, 10);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return null;
    }
    return numericValue;
  }, [customLimit, limitMode]);

  const bookNameById = useMemo(() => {
    const map = new Map<number, string>();
    books.forEach((book) => map.set(book.id, book.book_name));
    return map;
  }, [books]);

  const activeOrPendingJobs = useMemo(
    () => allJobs.filter((job) => job.status === "running" || job.status === "pending"),
    [allJobs]
  );

  const historyJobs = useMemo(
    () => allJobs.filter((job) => job.status !== "running" && job.status !== "pending"),
    [allJobs]
  );

  const duplicateJobRunning = useMemo(() => {
    if (!selectedSourceId) return false;
    if (isBasketSelected) {
      return activeOrPendingJobs.some(
        (job) => job.source_type === "basket" && job.language_code === languageCode
      );
    }
    const bookId = Number(selectedSourceId);
    return activeOrPendingJobs.some(
      (job) => job.book_id === bookId && job.language_code === languageCode
    );
  }, [activeOrPendingJobs, languageCode, selectedSourceId, isBasketSelected]);

  const limitError =
    limitMode === "custom" && parsedCustomLimit === null ? "Enter a limit greater than 0." : null;
  const additionalInstructionsTrimmed = additionalInstructions.trim();
  const additionalInstructionsError =
    additionalInstructionsTrimmed.length > MAX_ADDITIONAL_INSTRUCTIONS
      ? `Additional instructions must be ${MAX_ADDITIONAL_INSTRUCTIONS} characters or fewer.`
      : null;

  const basketMissingTranslationCount = isBasketSelected ? estimate?.total_nodes ?? null : null;
  const basketValidationPending =
    isBasketSelected && basketNodeCount > 0 && !estimateLoading && !estimate && !estimateError;
  const basketIsEmpty = isBasketSelected && basketNodeCount === 0;
  const basketAllTranslated =
    isBasketSelected &&
    basketNodeCount > 0 &&
    !estimateLoading &&
    !estimateError &&
    basketMissingTranslationCount === 0;

  const canStartJob =
    Boolean(selectedSourceId) &&
    !submitting &&
    !duplicateJobRunning &&
    !limitError &&
    !additionalInstructionsError &&
    !basketIsEmpty &&
    !basketAllTranslated &&
    !basketValidationPending;

  const ensureAdmin = async () => {
    try {
      const me = await getMe({ force: true });
      const admin = Boolean(me?.permissions?.can_admin || me?.role === "admin");
      setCanAdmin(admin);
      setAccessDenied(!admin);
      return admin;
    } catch {
      setCanAdmin(false);
      setAccessDenied(true);
      return false;
    }
  };

  const loadBooks = async () => {
    setBooksLoading(true);
    try {
      const response = await fetch("/api/books", { credentials: "include" });
      const raw = await response.text();
      const payload = parsePayload(raw) as BookOption[] | null;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          setBooks([]);
          return;
        }
        throw new Error(`(${response.status}) ${getErrorMessage(raw, "Failed to load books")}`);
      }
      setBooks(Array.isArray(payload) ? payload : []);
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to load books",
      });
    } finally {
      setBooksLoading(false);
    }
  };

  const loadBasket = async () => {
    setBasketLoading(true);
    try {
      const response = await fetch("/api/cart/me", { credentials: "include" });
      const raw = await response.text();
      const payload = parsePayload(raw) as CartPublic | null;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setBasket(null);
          return;
        }
        // Non-fatal — basket just won't show
        return;
      }
      setBasket(payload);
    } catch {
      // Non-fatal
    } finally {
      setBasketLoading(false);
    }
  };

  const loadSummary = async () => {
    setSummaryLoading(true);
    try {
      const response = await fetch("/api/ai/generate/summary", {
        credentials: "include",
        cache: "no-store",
      });
      const raw = await response.text();
      const payload = parsePayload(raw) as GenerationSummaryResponse | null;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          setSummary(null);
          return;
        }
        throw new Error(`(${response.status}) ${getErrorMessage(raw, "Failed to load summary")}`);
      }
      setSummary(payload);
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to load summary",
      });
    } finally {
      setSummaryLoading(false);
    }
  };

  const loadAllJobs = async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setHistoryLoading(true);
    }
    try {
      const response = await fetch("/api/ai/generate/jobs", {
        credentials: "include",
        cache: "no-store",
      });
      const raw = await response.text();
      const payload = parsePayload(raw) as AIJob[] | null;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          setAllJobs([]);
          return;
        }
        throw new Error(`(${response.status}) ${getErrorMessage(raw, "Failed to load jobs")}`);
      }
      setAllJobs(Array.isArray(payload) ? payload : []);
    } catch (error) {
      if (!options?.silent) {
        setToast({
          type: "error",
          message: error instanceof Error ? error.message : "Failed to load jobs",
        });
      }
    } finally {
      if (!options?.silent) {
        setHistoryLoading(false);
      }
    }
  };

  const loadActiveJobs = async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setActiveLoading(true);
    }

    try {
      const response = await fetch("/api/ai/generate/jobs?status=running", {
        credentials: "include",
        cache: "no-store",
      });
      const raw = await response.text();
      const payload = parsePayload(raw) as AIJob[] | null;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          setActiveJobs([]);
          return;
        }
        throw new Error(`(${response.status}) ${getErrorMessage(raw, "Failed to load active jobs")}`);
      }
      setActiveJobs(Array.isArray(payload) ? payload : []);
    } catch (error) {
      if (!options?.silent) {
        setToast({
          type: "error",
          message: error instanceof Error ? error.message : "Failed to load active jobs",
        });
      }
    } finally {
      if (!options?.silent) {
        setActiveLoading(false);
      }
    }
  };

  activeJobsLoaderRef.current = loadActiveJobs;
  allJobsLoaderRef.current = loadAllJobs;

  useEffect(() => {
    void (async () => {
      const admin = await ensureAdmin();
      if (admin) {
        await Promise.all([loadBooks(), loadBasket(), loadSummary(), loadAllJobs(), loadActiveJobs()]);
      }
      setAuthChecked(true);
    })();
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!canAdmin || !selectedSourceId) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void Promise.all([
        activeJobsLoaderRef.current?.({ silent: true }),
        allJobsLoaderRef.current?.({ silent: true }),
      ]);
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [canAdmin, selectedSourceId]);

  useEffect(() => {
    if (!canAdmin || !selectedSourceId) {
      setEstimate(null);
      setEstimateError(null);
      return undefined;
    }

    if (isBasketSelected && basketNodeCount === 0) {
      setEstimate(null);
      setEstimateError(null);
      return undefined;
    }

    if (limitMode === "custom" && parsedCustomLimit === null) {
      setEstimate(null);
      setEstimateError(null);
      return undefined;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setEstimateLoading(true);
      setEstimateError(null);
      try {
        const params = new URLSearchParams({
          language_code: languageCode,
          language_name: selectedLanguage.label,
        });
        if (isBasketSelected) {
          params.set("source_type", "basket");
          if (basket?.id) params.set("basket_id", String(basket.id));
        } else {
          params.set("source_type", "book");
          params.set("book_id", selectedSourceId);
        }
        if (parsedCustomLimit !== null) {
          params.set("limit", String(parsedCustomLimit));
        }

        const response = await fetch(`/api/ai/generate/estimate?${params.toString()}`, {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });
        const raw = await response.text();
        const payload = parsePayload(raw) as GenerationEstimateResponse | null;
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            setAccessDenied(true);
            setEstimate(null);
            return;
          }
          throw new Error(`(${response.status}) ${getErrorMessage(raw, "Estimate failed")}`);
        }
        setEstimate(payload);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setEstimate(null);
        setEstimateError(error instanceof Error ? error.message : "Estimate failed");
      } finally {
        if (!controller.signal.aborted) {
          setEstimateLoading(false);
        }
      }
    }, 500);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [canAdmin, selectedSourceId, isBasketSelected, basket?.id, basketNodeCount, languageCode, limitMode, mode, parsedCustomLimit, selectedLanguage.label]);

  const handleStartJob = async () => {
    if (!canStartJob) {
      return;
    }

    setSubmitting(true);
    setToast(null);
    try {
      const body = isBasketSelected
        ? {
            source_type: "basket",
            basket_id: basket?.id ?? null,
            language_code: languageCode,
            language_name: selectedLanguage.label,
            mode,
            limit: parsedCustomLimit,
            additional_instructions: additionalInstructionsTrimmed || null,
          }
        : {
            source_type: "book",
            book_id: selectedBook!.id,
            language_code: languageCode,
            language_name: selectedLanguage.label,
            mode,
            limit: parsedCustomLimit,
            additional_instructions: additionalInstructionsTrimmed || null,
          };

      const response = await fetch("/api/ai/generate/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const raw = await response.text();
      const payload = parsePayload(raw) as (GenerationEstimateResponse & { job_id?: number }) | null;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          return;
        }
        throw new Error(`(${response.status}) ${getErrorMessage(raw, "Failed to start generation")}`);
      }

      if (payload) {
        setEstimate({
          total_nodes: estimate?.total_nodes || (isBasketSelected ? basketNodeCount : getBookVerseCount(selectedBook!) || 0),
          estimated_cost_realtime: payload.estimated_cost_realtime,
          estimated_cost_batch: payload.estimated_cost_batch,
        });
      }

      const sourceName = isBasketSelected ? "My Basket" : selectedBook!.book_name;
      setToast({
        type: "success",
        message: `Started ${selectedLanguage.label} generation for ${sourceName}.`,
      });
      await Promise.all([loadSummary(), loadAllJobs(), loadActiveJobs()]);
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to start generation",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelJob = async (job: AIJob) => {
    if (!window.confirm("Cancel this AI generation job?")) {
      return;
    }

    setCancellingJobId(job.id);
    setToast(null);
    try {
      const response = await fetch(`/api/ai/generate/jobs/${job.id}/cancel`, {
        method: "POST",
        credentials: "include",
      });
      const raw = await response.text();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          return;
        }
        throw new Error(`(${response.status}) ${getErrorMessage(raw, "Failed to cancel job")}`);
      }

      setToast({ type: "success", message: "Job cancelled." });
      await Promise.all([loadSummary(), loadAllJobs(), loadActiveJobs()]);
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to cancel job",
      });
    } finally {
      setCancellingJobId(null);
    }
  };

  if (!authChecked) {
    return <main className="mx-auto w-full max-w-7xl px-4 py-6">Loading…</main>;
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-zinc-900">AI Generation</h1>
        <p className="text-sm text-zinc-600">
          Start translation jobs, monitor active runs, and review completed AI output history.
        </p>
      </header>

      <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
        <a href="/admin" className="rounded-full border border-black/10 bg-white px-3 py-1">Users</a>
        <a href="/admin/ai-generation" className="rounded-full border border-[color:var(--accent)] bg-[color:var(--accent)]/10 px-3 py-1 text-[color:var(--accent)]">AI Generation</a>
        <a href="/admin/schemas" className="rounded-full border border-black/10 bg-white px-3 py-1">Schemas</a>
        <a href="/admin/import" className="rounded-full border border-black/10 bg-white px-3 py-1">Import</a>
        <a href="/admin/metadata/properties" className="rounded-full border border-black/10 bg-white px-3 py-1">Properties</a>
        <a href="/admin/metadata/categories" className="rounded-full border border-black/10 bg-white px-3 py-1">Categories</a>
        <a href="/admin/media-bank" className="rounded-full border border-black/10 bg-white px-3 py-1">Multimedia Repo</a>
      </div>

      {toast && (
        <div className={`rounded-lg border px-3 py-2 text-sm ${toast.type === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
          {toast.message}
        </div>
      )}

      {accessDenied && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          Admin access required.
          <Link className="ml-2 font-semibold underline" href="/signin">
            Sign in
          </Link>
        </div>
      )}

      <section className={`grid gap-4 sm:grid-cols-2 xl:grid-cols-4 ${accessDenied ? "pointer-events-none opacity-60" : ""}`}>
        {[
          {
            label: "Total verses generated",
            value: summaryLoading ? "Loading..." : formatInteger(summary?.total_verses_generated),
            note: summary ? `${formatInteger(summary.total_jobs)} total jobs` : "",
          },
          {
            label: "Total cost spent",
            value: summaryLoading ? "Loading..." : formatCurrency(summary?.total_cost_usd),
            note: summary ? `Projected ${formatCurrency(summary.projected_total_cost_usd)}` : "",
          },
          {
            label: "Languages covered",
            value: summaryLoading ? "Loading..." : formatInteger(summary?.languages_covered.length),
            note:
              summary && summary.languages_covered.length > 0
                ? summary.languages_covered
                    .slice(0, 3)
                    .map((item) => LANGUAGE_LABELS[item.language_code as LanguageOption["code"]] || item.language_code)
                    .join(", ")
                : "No generated languages yet",
          },
          {
            label: "Books with AI content",
            value: summaryLoading ? "Loading..." : formatInteger(summary?.cost_by_book.length),
            note:
              summary && summary.cost_by_book[0]
                ? `${summary.cost_by_book[0].book_name} leads with ${formatInteger(summary.cost_by_book[0].verses_generated)} verses`
                : "No completed output yet",
          },
        ].map((card) => (
          <article key={card.label} className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{card.label}</p>
            <p className="mt-3 text-2xl font-semibold text-zinc-900">{card.value}</p>
            <p className="mt-2 text-sm text-zinc-600">{card.note || " "}</p>
          </article>
        ))}
      </section>

      <section className={`rounded-xl border border-black/10 bg-white p-4 shadow-sm ${accessDenied ? "pointer-events-none opacity-60" : ""}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">Start New Job</h2>
            <p className="text-sm text-zinc-600">Create AI generation jobs for a book and target language.</p>
          </div>
        {duplicateJobRunning ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
              A generation job is already running for this source in {selectedLanguage.label}. Please wait for it to complete or cancel it first.
            </div>
          ) : null}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-sm font-medium text-zinc-800">Source</span>
              <select
                value={selectedSourceId}
                onChange={(event) => setSelectedSourceId(event.target.value)}
                className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
                disabled={booksLoading || basketLoading}
              >
                <option value="">Select a source</option>
                <option value="basket">
                  🧺 My Basket{basketLoading ? " (loading…)" : ` (${basketNodeCount} verses)`}
                </option>
                {books.map((book) => {
                  const verseCount = getBookVerseCount(book);
                  return (
                    <option key={book.id} value={book.id}>
                      {book.book_name}
                      {typeof verseCount === "number" ? ` • ${formatInteger(verseCount)} verses` : ""}
                    </option>
                  );
                })}
              </select>
              {isBasketSelected && basket && (
                <p className="text-xs text-zinc-500">
                  {basketNodeCount} verse{basketNodeCount !== 1 ? "s" : ""} from{" "}
                  {basketBookCount} different book{basketBookCount === 1 ? "" : "s"}
                </p>
              )}
              {isBasketSelected && basketIsEmpty ? (
                <p className="text-sm text-amber-700">
                  Your basket is empty. Browse scriptures and add verses to generate content.
                </p>
              ) : null}
              {isBasketSelected && basketAllTranslated ? (
                <p className="text-sm text-sky-700">
                  All {formatInteger(basketNodeCount)} verses in your basket already have {selectedLanguage.label} translation. Nothing to generate.
                </p>
              ) : null}
              {isBasketSelected && basketNodeCount > 0 && (basketMissingTranslationCount ?? 0) > 0 ? (
                <p className="text-sm text-emerald-700">
                  {formatInteger(basketMissingTranslationCount)} of {formatInteger(basketNodeCount)} verses need {selectedLanguage.label} translation.
                </p>
              ) : null}
            </label>

            <label className="space-y-1">
              <span className="text-sm font-medium text-zinc-800">Language</span>
              <select
                value={languageCode}
                onChange={(event) => setLanguageCode(event.target.value as LanguageOption["code"])}
                className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
              >
                {LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="space-y-2 sm:col-span-2">
              <span className="text-sm font-medium text-zinc-800">Mode</span>
              <div className="inline-flex rounded-lg border border-black/10 bg-zinc-50 p-1">
                <button
                  type="button"
                  onClick={() => setMode("realtime")}
                  className={`rounded-md px-3 py-2 text-sm ${mode === "realtime" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600"}`}
                >
                  Real-time
                </button>
                <button
                  type="button"
                  onClick={() => setMode("batch")}
                  className={`rounded-md px-3 py-2 text-sm ${mode === "batch" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600"}`}
                >
                  Batch (50% cheaper)
                </button>
              </div>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-zinc-800">Additional Instructions (optional)</span>
                <span className="text-xs text-zinc-500">
                  {additionalInstructions.length} / {MAX_ADDITIONAL_INSTRUCTIONS}
                </span>
              </div>
              <textarea
                value={additionalInstructions}
                onChange={(event) => setAdditionalInstructions(event.target.value)}
                maxLength={MAX_ADDITIONAL_INSTRUCTIONS}
                rows={3}
                className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
                placeholder="Leave blank for standard generation"
              />
              {additionalInstructionsError ? (
                <p className="text-sm text-red-600">{additionalInstructionsError}</p>
              ) : (
                <p className="text-xs text-zinc-500">
                  e.g. "Commentary should be from Advaitic perspective. Keep w2w meanings concise."
                </p>
              )}
            </div>

            <div className="space-y-2 sm:col-span-2">
              <span className="text-sm font-medium text-zinc-800">Limit</span>
              <div className="space-y-2 rounded-lg border border-black/10 bg-zinc-50 p-3">
                <label className="flex items-center gap-2 text-sm text-zinc-700">
                  <input
                    type="radio"
                    name="limit-mode"
                    checked={limitMode === "all"}
                    onChange={() => setLimitMode("all")}
                  />
                  All verses
                </label>
                <label className="flex flex-col gap-2 text-sm text-zinc-700 sm:flex-row sm:items-center">
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="limit-mode"
                      checked={limitMode === "custom"}
                      onChange={() => setLimitMode("custom")}
                    />
                    Custom limit
                  </span>
                  <input
                    type="number"
                    min="1"
                    inputMode="numeric"
                    value={customLimit}
                    onChange={(event) => setCustomLimit(event.target.value)}
                    disabled={limitMode !== "custom"}
                    className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm sm:max-w-40"
                    placeholder="Verse count"
                  />
                </label>
                {limitError ? <p className="text-sm text-red-600">{limitError}</p> : null}
              </div>
            </div>

            <div className="sm:col-span-2">
              <button
                type="button"
                onClick={() => void handleStartJob()}
                disabled={!canStartJob}
                className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Play className="h-4 w-4" />
                {submitting ? "Starting..." : "Start Generation"}
              </button>
            </div>
          </div>

          <aside className="rounded-xl border border-black/10 bg-zinc-50 p-4">
            <h3 className="text-sm font-semibold text-zinc-900">Cost estimate</h3>
            <p className="mt-1 text-sm text-zinc-600">
              {isBasketSelected && basketIsEmpty
                ? "Add verses to your basket to see cost estimate."
                : estimateLoading
                ? "Calculating estimate..."
                : estimate
                  ? `Estimated cost: ${formatCurrency(estimate.estimated_cost_batch)} (batch) / ${formatCurrency(estimate.estimated_cost_realtime)} (real-time)`
                  : isBasketSelected
                    ? "Select a language to calculate basket cost."
                    : "Select a source to calculate cost."}
            </p>
            {estimate && !(isBasketSelected && basketIsEmpty) ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <div className="rounded-lg border border-black/10 bg-white px-3 py-2">
                  <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Mode selected</p>
                  <p className="mt-1 text-sm font-medium text-zinc-900">
                    {mode === "batch"
                      ? `${formatCurrency(estimate.estimated_cost_batch)} batch`
                      : `${formatCurrency(estimate.estimated_cost_realtime)} real-time`}
                  </p>
                </div>
                <div className="rounded-lg border border-black/10 bg-white px-3 py-2">
                  <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Verses to process</p>
                  <p className="mt-1 text-sm font-medium text-zinc-900">{formatInteger(estimate.total_nodes)}</p>
                </div>
              </div>
            ) : null}
            {estimateError && !(isBasketSelected && basketIsEmpty) ? <p className="mt-3 text-sm text-red-600">{estimateError}</p> : null}
          </aside>
        </div>
      </section>

      <section className={`rounded-xl border border-black/10 bg-white p-4 shadow-sm ${accessDenied ? "pointer-events-none opacity-60" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">Active Jobs</h2>
            <p className="text-sm text-zinc-600">Running jobs refresh automatically every 5 seconds.</p>
          </div>
          <button
            type="button"
            onClick={() => void loadActiveJobs()}
            className="rounded-lg border border-black/10 px-3 py-1.5 text-sm"
          >
            {activeLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {!activeLoading && activeJobs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-black/10 px-4 py-6 text-sm text-zinc-600">
              No active jobs.
            </div>
          ) : null}

          {activeJobs.map((job) => {
            const progress = getJobProgress(job);
            const sourceLabel = getJobSourceLabel(job, bookNameById);
            const modeLabel = getJobMode(job) === "batch" ? "Batch" : "Real-time";
            const snapshotStatus = job.batch_status_snapshot?.status || job.batch_status_snapshot?.processing_status;
            const remainingMs = getJobRemainingMs(job);

            return (
              <article key={job.id} className="rounded-xl border border-black/10 bg-zinc-50 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3 flex-1">
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-900">
                        {sourceLabel} • {getJobLanguageLabel(job)} • {modeLabel}
                      </h3>
                      <p className="text-sm text-zinc-600">
                        {formatInteger(progress.processed)} / {formatInteger(progress.total)} processed • {progress.percent}%
                        {snapshotStatus ? ` • ${snapshotStatus}` : ""}
                      </p>
                    </div>

                    <div className="h-2 overflow-hidden rounded-full bg-zinc-200">
                      <div
                        className="h-full rounded-full bg-[color:var(--accent)] transition-all"
                        style={{ width: `${progress.percent}%` }}
                      />
                    </div>

                    <div className="grid gap-3 text-sm text-zinc-600 sm:grid-cols-2 xl:grid-cols-4">
                      <p>
                        <span className="font-medium text-zinc-900">Elapsed:</span> {formatDurationMs(getJobElapsedMs(job))}
                      </p>
                      <p>
                        <span className="font-medium text-zinc-900">Remaining:</span> {remainingMs ? `~${formatDurationMs(remainingMs)}` : "--"}
                      </p>
                      <p>
                        <span className="font-medium text-zinc-900">Cost so far:</span> {formatCurrency(getJobCostSoFar(job))}
                      </p>
                      <p>
                        <span className="font-medium text-zinc-900">Started:</span> {formatDate(job.started_at || job.created_at)}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleCancelJob(job)}
                    disabled={cancellingJobId === job.id}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <X className="h-4 w-4" />
                    {cancellingJobId === job.id ? "Cancelling..." : "Cancel"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className={`rounded-xl border border-black/10 bg-white p-4 shadow-sm ${accessDenied ? "pointer-events-none opacity-60" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">Job History</h2>
            <p className="text-sm text-zinc-600">Completed, failed, and cancelled generation jobs.</p>
          </div>
          <button
            type="button"
            onClick={() => void loadAllJobs()}
            className="rounded-lg border border-black/10 px-3 py-1.5 text-sm"
          >
            {historyLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-black/10 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-[0.2em] text-zinc-500">
                <th className="px-3 py-2 font-medium">Book</th>
                <th className="px-3 py-2 font-medium">Language</th>
                <th className="px-3 py-2 font-medium">Mode</th>
                <th className="px-3 py-2 font-medium">Instructions</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Verses generated</th>
                <th className="px-3 py-2 font-medium">Actual cost</th>
                <th className="px-3 py-2 font-medium">Duration</th>
                <th className="px-3 py-2 font-medium">Errors</th>
                <th className="px-3 py-2 font-medium">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {historyLoading ? (
                <tr>
                  <td className="px-3 py-4 text-zinc-600" colSpan={10}>
                    Loading history...
                  </td>
                </tr>
              ) : null}

              {!historyLoading && historyJobs.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-zinc-600" colSpan={10}>
                    No completed or failed jobs yet.
                  </td>
                </tr>
              ) : null}

              {!historyLoading
                ? historyJobs.map((job) => {
                    const sourceLabel = getJobSourceLabel(job, bookNameById);
                    const jobInstructions = getJobAdditionalInstructions(job);

                    return (
                      <tr key={job.id} className="align-top">
                        <td className="px-3 py-3 text-zinc-900">{sourceLabel}</td>
                        <td className="px-3 py-3 text-zinc-700">{getJobLanguageLabel(job)}</td>
                        <td className="px-3 py-3 text-zinc-700">
                          {getJobMode(job) === "batch" ? "Batch" : "Real-time"}
                        </td>
                        <td className="max-w-72 px-3 py-3 text-zinc-700" title={jobInstructions || undefined}>
                          {jobInstructions ? truncateWithEllipsis(jobInstructions, 50) : "—"}
                        </td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${getStatusClasses(job.status)}`}>
                            {job.status}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-zinc-700">{formatInteger(job.processed_nodes)}</td>
                        <td className="px-3 py-3 text-zinc-700">{formatCurrency(job.actual_cost_usd)}</td>
                        <td className="px-3 py-3 text-zinc-700">{formatDurationMs(getJobElapsedMs(job))}</td>
                        <td className="max-w-72 px-3 py-3 text-zinc-700">{getJobErrorSummary(job)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-zinc-700">
                          {formatDate(job.completed_at || job.created_at)}
                        </td>
                      </tr>
                    );
                  })
                : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}