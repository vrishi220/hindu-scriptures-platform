"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getMe } from "../../lib/authClient";

type DraftBook = {
  id: number;
  owner_id: number;
  title: string;
  description?: string | null;
  status: "draft" | "published";
  section_structure: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type EditionSnapshot = {
  id: number;
  draft_book_id: number;
  owner_id: number;
  version: number;
  snapshot_data: Record<string, unknown>;
  immutable: boolean;
  created_at: string;
};

type DraftProvenanceAppendixEntry = {
  section: "front" | "body" | "back";
  source_node_id: number;
  source_book_id?: number | null;
  title: string;
  source_author?: string | null;
  license_type: string;
  source_version: string;
};

type DraftProvenanceAppendix = {
  entries: DraftProvenanceAppendixEntry[];
};

type SnapshotTemplateMetadata = {
  template_family: string;
  template_version: string;
  block_template_pattern: string;
  renderer: string;
  output_profile: string;
};

type DraftLicensePolicyIssue = {
  source_node_id: number;
  license_type: string;
  policy_action: "warn" | "block";
};

type DraftLicensePolicyReport = {
  status: "pass" | "warn" | "block";
  warning_issues: DraftLicensePolicyIssue[];
  blocked_issues: DraftLicensePolicyIssue[];
};

type DraftPublishResponse = {
  snapshot: EditionSnapshot;
  license_policy: DraftLicensePolicyReport;
  provenance_appendix: DraftProvenanceAppendix;
};

type ProvenanceRecord = {
  id: number;
  target_book_id: number;
  target_node_id: number;
  source_book_id: number | null;
  source_node_id: number | null;
  source_type: string;
  source_author: string | null;
  license_type: string;
  source_version: string;
  inserted_by: number | null;
  draft_section: string;
  created_at: string;
};

type DraftSourceItem = {
  section: "front" | "body" | "back";
  nodeId: number;
  sourceBookId: number;
  title: string;
};

type DraftEditorState = {
  title: string;
  description: string;
  sectionStructureText: string;
};

type CartComposeBodyResponse = {
  section_structure: {
    front?: unknown[];
    body?: Array<Record<string, unknown>>;
    back?: unknown[];
  };
  skipped_item_count?: number;
};

type ApiErrorPayload = {
  detail?: unknown;
  message?: unknown;
};

const formatDate = (dateString: string) => {
  try {
    return new Date(dateString).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateString;
  }
};

const extractApiErrorMessage = (payload: ApiErrorPayload | null, fallback: string): string => {
  if (!payload) {
    return fallback;
  }
  if (typeof payload.detail === "string" && payload.detail.trim()) {
    return payload.detail;
  }
  if (typeof payload.message === "string" && payload.message.trim()) {
    return payload.message;
  }
  if (payload.detail && typeof payload.detail === "object") {
    try {
      return JSON.stringify(payload.detail);
    } catch {
      return fallback;
    }
  }
  return fallback;
};

function DraftsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftBook[]>([]);
  const [expandedDraftId, setExpandedDraftId] = useState<number | null>(null);
  const [editorState, setEditorState] = useState<Record<number, DraftEditorState>>({});
  const [snapshotsByDraft, setSnapshotsByDraft] = useState<Record<number, EditionSnapshot[]>>({});
  const [busyDraftId, setBusyDraftId] = useState<number | null>(null);
  const [createTitle, setCreateTitle] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [hasAppliedDraftQuery, setHasAppliedDraftQuery] = useState(false);
  const [highlightedDraftId, setHighlightedDraftId] = useState<number | null>(null);
  const [provenanceByDraft, setProvenanceByDraft] = useState<Record<number, ProvenanceRecord[]>>({});
  const [provenanceLoadingByDraft, setProvenanceLoadingByDraft] = useState<Record<number, boolean>>({});
  const [provenanceErrorByDraft, setProvenanceErrorByDraft] = useState<Record<number, string | null>>({});
  const [provenanceLastRefreshedByDraft, setProvenanceLastRefreshedByDraft] = useState<Record<number, string>>({});
  const [licensePolicyByDraft, setLicensePolicyByDraft] = useState<Record<number, DraftLicensePolicyReport>>({});
  const [licensePolicyLoadingByDraft, setLicensePolicyLoadingByDraft] = useState<Record<number, boolean>>({});
  const [licensePolicyErrorByDraft, setLicensePolicyErrorByDraft] = useState<Record<number, string | null>>({});
  const draftCardRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const extractDraftSourceItems = (sectionStructure: Record<string, unknown>): DraftSourceItem[] => {
    const sections: Array<"front" | "body" | "back"> = ["front", "body", "back"];
    const items: DraftSourceItem[] = [];

    sections.forEach((section) => {
      const sectionItems = sectionStructure[section];
      if (!Array.isArray(sectionItems)) {
        return;
      }

      sectionItems.forEach((rawItem) => {
        if (!rawItem || typeof rawItem !== "object") {
          return;
        }

        const item = rawItem as { node_id?: unknown; source_book_id?: unknown; title?: unknown };
        const nodeId = Number(item.node_id);
        const sourceBookId = Number(item.source_book_id);
        if (!Number.isInteger(nodeId) || nodeId <= 0 || !Number.isInteger(sourceBookId) || sourceBookId <= 0) {
          return;
        }

        items.push({
          section,
          nodeId,
          sourceBookId,
          title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : `Node ${nodeId}`,
        });
      });
    });

    return items;
  };

  const loadProvenanceForDraft = async (draft: DraftBook) => {
    const sourceItems = extractDraftSourceItems(draft.section_structure || {});
    if (sourceItems.length === 0) {
      setProvenanceByDraft((prev) => ({ ...prev, [draft.id]: [] }));
      setProvenanceErrorByDraft((prev) => ({ ...prev, [draft.id]: null }));
      setProvenanceLastRefreshedByDraft((prev) => ({
        ...prev,
        [draft.id]: new Date().toISOString(),
      }));
      return;
    }

    setProvenanceLoadingByDraft((prev) => ({ ...prev, [draft.id]: true }));
    setProvenanceErrorByDraft((prev) => ({ ...prev, [draft.id]: null }));

    try {
      const sourceBookIds = Array.from(new Set(sourceItems.map((item) => item.sourceBookId)));
      const nodeIds = new Set(sourceItems.map((item) => item.nodeId));

      const results = await Promise.all(
        sourceBookIds.map(async (bookId) => {
          const response = await fetch(`/api/books/${bookId}/provenance`, {
            credentials: "include",
            cache: "no-store",
          });
          if (!response.ok) {
            return [] as ProvenanceRecord[];
          }
          return (await response.json()) as ProvenanceRecord[];
        })
      );

      const records = results
        .flat()
        .filter((record) => record.source_node_id !== null && nodeIds.has(record.source_node_id));

      setProvenanceByDraft((prev) => ({ ...prev, [draft.id]: records }));
      setProvenanceLastRefreshedByDraft((prev) => ({
        ...prev,
        [draft.id]: new Date().toISOString(),
      }));
    } catch {
      setProvenanceErrorByDraft((prev) => ({
        ...prev,
        [draft.id]: "Failed to load provenance records",
      }));
    } finally {
      setProvenanceLoadingByDraft((prev) => ({ ...prev, [draft.id]: false }));
    }
  };

  const loadAuth = async () => {
    try {
      const data = await getMe();
      if (!data) {
        setAuthEmail(null);
        return;
      }
      setAuthEmail(data.email || null);
    } catch {
      setAuthEmail(null);
    }
  };

  const loadDrafts = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/draft-books/my", {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(payload?.detail || "Failed to load drafts");
      }
      const data = (await response.json()) as DraftBook[];
      setDrafts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load drafts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const initialize = async () => {
      await loadAuth();
    };
    initialize();
  }, []);

  useEffect(() => {
    if (!authEmail) {
      setLoading(false);
      return;
    }
    loadDrafts();
  }, [authEmail]);

  useEffect(() => {
    if (hasAppliedDraftQuery || loading) {
      return;
    }

    const queryDraftId = searchParams.get("draftId");
    if (!queryDraftId) {
      setHasAppliedDraftQuery(true);
      return;
    }

    const parsedDraftId = Number(queryDraftId);
    if (!Number.isInteger(parsedDraftId) || parsedDraftId <= 0) {
      setHasAppliedDraftQuery(true);
      return;
    }

    const targetDraft = drafts.find((draft) => draft.id === parsedDraftId);
    if (!targetDraft) {
      setHasAppliedDraftQuery(true);
      return;
    }

    setExpandedDraftId(parsedDraftId);
    ensureEditorState(targetDraft);
    void loadSnapshots(parsedDraftId);
    setHighlightedDraftId(parsedDraftId);
    setHasAppliedDraftQuery(true);
  }, [drafts, hasAppliedDraftQuery, loading, searchParams]);

  useEffect(() => {
    if (!highlightedDraftId) {
      return;
    }

    const node = draftCardRefs.current[highlightedDraftId];
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    const timer = window.setTimeout(() => {
      setHighlightedDraftId((current) => (current === highlightedDraftId ? null : current));

      const params = new URLSearchParams(searchParams.toString());
      if (params.has("draftId")) {
        params.delete("draftId");
        const nextQuery = params.toString();
        router.replace(nextQuery ? `/drafts?${nextQuery}` : "/drafts");
      }
    }, 2200);

    return () => window.clearTimeout(timer);
  }, [highlightedDraftId, router, searchParams]);

  const ensureEditorState = (draft: DraftBook) => {
    setEditorState((prev) => {
      if (prev[draft.id]) return prev;
      return {
        ...prev,
        [draft.id]: {
          title: draft.title,
          description: draft.description || "",
          sectionStructureText: JSON.stringify(draft.section_structure || { front: [], body: [], back: [] }, null, 2),
        },
      };
    });
  };

  const loadSnapshots = async (draftId: number) => {
    try {
      const response = await fetch(`/api/draft-books/${draftId}/snapshots`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as EditionSnapshot[];
      setSnapshotsByDraft((prev) => ({ ...prev, [draftId]: data }));
    } catch {
      // Ignore snapshot loading errors
    }
  };

  const loadLicensePolicyForDraft = async (draftId: number) => {
    setLicensePolicyLoadingByDraft((prev) => ({ ...prev, [draftId]: true }));
    setLicensePolicyErrorByDraft((prev) => ({ ...prev, [draftId]: null }));

    try {
      const response = await fetch(`/api/draft-books/${draftId}/license-policy`, {
        credentials: "include",
        cache: "no-store",
      });

      const payload = (await response.json().catch(() => null)) as
        | DraftLicensePolicyReport
        | { detail?: string }
        | null;

      if (!response.ok) {
        throw new Error((payload as { detail?: string } | null)?.detail || "Failed to load license policy");
      }

      setLicensePolicyByDraft((prev) => ({
        ...prev,
        [draftId]: payload as DraftLicensePolicyReport,
      }));
    } catch (err) {
      setLicensePolicyErrorByDraft((prev) => ({
        ...prev,
        [draftId]: err instanceof Error ? err.message : "Failed to load license policy",
      }));
    } finally {
      setLicensePolicyLoadingByDraft((prev) => ({ ...prev, [draftId]: false }));
    }
  };

  const handleCreateDraft = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!createTitle.trim()) {
      setMessage("Draft title is required.");
      return;
    }

    setMessage(null);
    try {
      const response = await fetch("/api/draft-books", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: createTitle.trim(),
          description: createDescription.trim() || null,
          section_structure: { front: [], body: [], back: [] },
        }),
      });

      const payload = (await response.json().catch(() => null)) as DraftBook | { detail?: string } | null;
      if (!response.ok) {
        throw new Error((payload as { detail?: string } | null)?.detail || "Failed to create draft");
      }

      const created = payload as DraftBook;
      setDrafts((prev) => [created, ...prev]);
      setCreateTitle("");
      setCreateDescription("");
      setMessage("✓ Draft created.");
    } catch (err) {
      setMessage(`✗ ${err instanceof Error ? err.message : "Failed to create draft"}`);
    }
  };

  const handleSaveDraft = async (draftId: number) => {
    const state = editorState[draftId];
    if (!state) return;

    let parsedStructure: Record<string, unknown>;
    try {
      parsedStructure = JSON.parse(state.sectionStructureText) as Record<string, unknown>;
    } catch {
      setMessage("✗ Section structure must be valid JSON.");
      return;
    }

    setBusyDraftId(draftId);
    setMessage(null);

    try {
      const response = await fetch(`/api/draft-books/${draftId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: state.title.trim() || undefined,
          description: state.description.trim() || null,
          section_structure: parsedStructure,
        }),
      });

      const payload = (await response.json().catch(() => null)) as DraftBook | { detail?: string } | null;
      if (!response.ok) {
        throw new Error((payload as { detail?: string } | null)?.detail || "Failed to update draft");
      }

      const updated = payload as DraftBook;
      setDrafts((prev) => prev.map((d) => (d.id === draftId ? updated : d)));
      setEditorState((prev) => ({
        ...prev,
        [draftId]: {
          title: updated.title,
          description: updated.description || "",
          sectionStructureText: JSON.stringify(updated.section_structure || { front: [], body: [], back: [] }, null, 2),
        },
      }));
      setMessage("✓ Draft updated.");
    } catch (err) {
      setMessage(`✗ ${err instanceof Error ? err.message : "Failed to update draft"}`);
    } finally {
      setBusyDraftId(null);
    }
  };

  const handleAddCartBodyToDraft = async (draft: DraftBook) => {
    const state = editorState[draft.id];
    if (!state) {
      setMessage("✗ Open and initialize this draft first.");
      return;
    }

    let parsedStructure: Record<string, unknown>;
    try {
      parsedStructure = JSON.parse(state.sectionStructureText) as Record<string, unknown>;
    } catch {
      setMessage("✗ Section structure must be valid JSON before adding cart body.");
      return;
    }

    setBusyDraftId(draft.id);
    setMessage(null);

    try {
      const composeResponse = await fetch("/api/cart/me/compose-draft-body", {
        method: "POST",
        credentials: "include",
      });

      const composePayload = (await composeResponse.json().catch(() => null)) as
        | CartComposeBodyResponse
        | { detail?: string }
        | null;

      if (!composeResponse.ok) {
        throw new Error((composePayload as { detail?: string } | null)?.detail || "Failed to compose cart body");
      }

      const composedBody =
        composePayload &&
        typeof composePayload === "object" &&
        "section_structure" in composePayload &&
        Array.isArray(composePayload.section_structure?.body)
          ? composePayload.section_structure.body
        : [];

      if (composedBody.length === 0) {
        setMessage("✗ Cart has no whole-book body items to add.");
        return;
      }

      const currentBody = Array.isArray(parsedStructure.body)
        ? (parsedStructure.body as Array<Record<string, unknown>>)
        : [];

      const existingBookIds = new Set(
        currentBody
          .map((item) => Number(item.source_book_id))
          .filter((bookId) => Number.isInteger(bookId) && bookId > 0)
      );

      const mergedBody = [...currentBody];
      let addedCount = 0;
      for (const item of composedBody) {
        const sourceBookId = Number(item.source_book_id);
        if (!Number.isInteger(sourceBookId) || sourceBookId <= 0) {
          continue;
        }
        if (existingBookIds.has(sourceBookId)) {
          continue;
        }
        existingBookIds.add(sourceBookId);
        mergedBody.push({ ...item, order: mergedBody.length + 1 });
        addedCount += 1;
      }

      if (addedCount === 0) {
        setMessage("✓ Cart body already exists in this draft. Nothing new to add.");
        return;
      }

      const nextStructure: Record<string, unknown> = {
        front: Array.isArray(parsedStructure.front) ? parsedStructure.front : [],
        body: mergedBody,
        back: Array.isArray(parsedStructure.back) ? parsedStructure.back : [],
      };

      const patchResponse = await fetch(`/api/draft-books/${draft.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: state.title.trim() || undefined,
          description: state.description.trim() || null,
          section_structure: nextStructure,
        }),
      });

      const patchPayload = (await patchResponse.json().catch(() => null)) as DraftBook | { detail?: string } | null;
      if (!patchResponse.ok) {
        throw new Error((patchPayload as { detail?: string } | null)?.detail || "Failed to update draft");
      }

      const updated = patchPayload as DraftBook;
      setDrafts((prev) => prev.map((item) => (item.id === draft.id ? updated : item)));
      setEditorState((prev) => ({
        ...prev,
        [draft.id]: {
          title: updated.title,
          description: updated.description || "",
          sectionStructureText: JSON.stringify(updated.section_structure || { front: [], body: [], back: [] }, null, 2),
        },
      }));

      const skippedCount =
        composePayload &&
        typeof composePayload === "object" &&
        "skipped_item_count" in composePayload
          ? Number(composePayload.skipped_item_count || 0)
          : 0;
      const skippedSuffix = skippedCount > 0 ? ` (${skippedCount} cart item(s) skipped: not whole-book refs)` : "";
      setMessage(`✓ Added ${addedCount} book body reference(s) to draft.${skippedSuffix}`);
    } catch (err) {
      setMessage(`✗ ${err instanceof Error ? err.message : "Failed to add cart body to draft"}`);
    } finally {
      setBusyDraftId(null);
    }
  };

  const handleCreateSnapshot = async (draft: DraftBook) => {
    const state = editorState[draft.id];
    let snapshotData: Record<string, unknown> | undefined;

    if (state?.sectionStructureText) {
      try {
        snapshotData = JSON.parse(state.sectionStructureText) as Record<string, unknown>;
      } catch {
        setMessage("✗ Section structure must be valid JSON before publishing snapshot.");
        return;
      }
    }

    setBusyDraftId(draft.id);
    setMessage(null);

    try {
      const response = await fetch(`/api/draft-books/${draft.id}/snapshots`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot_data: snapshotData }),
      });

      const payload = (await response.json().catch(() => null)) as EditionSnapshot | { detail?: string } | null;
      if (!response.ok) {
        throw new Error((payload as { detail?: string } | null)?.detail || "Failed to create snapshot");
      }

      const created = payload as EditionSnapshot;
      setSnapshotsByDraft((prev) => ({
        ...prev,
        [draft.id]: [created, ...(prev[draft.id] || [])],
      }));
      await loadDrafts();
      setMessage(`✓ Snapshot v${created.version} created.`);
    } catch (err) {
      setMessage(`✗ ${err instanceof Error ? err.message : "Failed to create snapshot"}`);
    } finally {
      setBusyDraftId(null);
    }
  };

  const handlePublishDraft = async (draft: DraftBook) => {
    const state = editorState[draft.id];
    let snapshotData: Record<string, unknown> | undefined;

    if (state?.sectionStructureText) {
      try {
        snapshotData = JSON.parse(state.sectionStructureText) as Record<string, unknown>;
      } catch {
        setMessage("✗ Section structure must be valid JSON before publishing.");
        return;
      }
    }

    setBusyDraftId(draft.id);
    setMessage(null);

    try {
      const response = await fetch(`/api/draft-books/${draft.id}/publish`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot_data: snapshotData }),
      });

      const payload = (await response.json().catch(() => null)) as DraftPublishResponse | { detail?: string } | null;
      if (!response.ok) {
        throw new Error((payload as { detail?: string } | null)?.detail || "Failed to publish draft");
      }

      const published = payload as DraftPublishResponse;
      setSnapshotsByDraft((prev) => ({
        ...prev,
        [draft.id]: [published.snapshot, ...(prev[draft.id] || [])],
      }));
      setLicensePolicyByDraft((prev) => ({
        ...prev,
        [draft.id]: published.license_policy,
      }));
      await loadDrafts();
      setMessage(`✓ Published snapshot v${published.snapshot.version}.`);
    } catch (err) {
      setMessage(`✗ ${err instanceof Error ? err.message : "Failed to publish draft"}`);
    } finally {
      setBusyDraftId(null);
    }
  };

  const handleDeleteDraft = async (draft: DraftBook) => {
    const confirmed = window.confirm(
      `Delete draft \"${draft.title}\"? This cannot be undone.`
    );
    if (!confirmed) {
      return;
    }

    setBusyDraftId(draft.id);
    setMessage(null);

    try {
      const response = await fetch(`/api/draft-books/${draft.id}`, {
        method: "DELETE",
        credentials: "include",
      });

      const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null;
      if (response.status === 409) {
        const reason = extractApiErrorMessage(payload, "Draft cannot be deleted in current state.");
        setMessage(`✗ ${reason}`);
        const forceConfirmed = window.confirm("Are you sure you want to delete?");
        if (!forceConfirmed) {
          return;
        }

        const forceResponse = await fetch(`/api/draft-books/${draft.id}?force=true`, {
          method: "DELETE",
          credentials: "include",
        });
        const forcePayload = (await forceResponse.json().catch(() => null)) as ApiErrorPayload | null;
        if (!forceResponse.ok) {
          throw new Error(
            extractApiErrorMessage(
              forcePayload,
              `Failed to force delete draft (HTTP ${forceResponse.status})`
            )
          );
        }
      } else if (!response.ok) {
        throw new Error(
          extractApiErrorMessage(payload, `Failed to delete draft (HTTP ${response.status})`)
        );
      }

      setDrafts((prev) => prev.filter((item) => item.id !== draft.id));
      setEditorState((prev) => {
        const next = { ...prev };
        delete next[draft.id];
        return next;
      });
      setSnapshotsByDraft((prev) => {
        const next = { ...prev };
        delete next[draft.id];
        return next;
      });
      if (expandedDraftId === draft.id) {
        setExpandedDraftId(null);
      }
      setMessage("✓ Draft deleted.");
    } catch (err) {
      setMessage(`✗ ${err instanceof Error ? err.message : "Failed to delete draft"}`);
    } finally {
      setBusyDraftId(null);
    }
  };

  const toggleExpand = async (draft: DraftBook) => {
    const next = expandedDraftId === draft.id ? null : draft.id;
    setExpandedDraftId(next);
    if (next === draft.id) {
      ensureEditorState(draft);
      await Promise.all([
        loadSnapshots(draft.id),
        loadProvenanceForDraft(draft),
        loadLicensePolicyForDraft(draft.id),
      ]);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[color:var(--sand)] via-white to-[color:var(--sand)]">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8">
          <h1 className="font-[var(--font-display)] text-4xl text-[color:var(--deep)] sm:text-5xl">Draft Books</h1>
          <p className="mt-2 text-zinc-600">Create editable drafts and publish immutable edition snapshots.</p>
        </div>

        {!authEmail ? (
          <div className="rounded-2xl border border-black/10 bg-white/80 p-8 text-center shadow-lg">
            <p className="mb-4 text-zinc-600">Please sign in to manage draft books.</p>
            <button
              onClick={() => router.push("/signin?returnTo=/drafts")}
              className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-6 py-3 font-medium text-white transition hover:shadow-lg"
            >
              Sign In
            </button>
          </div>
        ) : (
          <>
            <form onSubmit={handleCreateDraft} className="mb-6 rounded-2xl border border-black/10 bg-white/85 p-4 shadow-sm sm:p-6">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input
                  type="text"
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                  placeholder="Draft title"
                  className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                  required
                />
                <input
                  type="text"
                  value={createDescription}
                  onChange={(e) => setCreateDescription(e.target.value)}
                  placeholder="Description (optional)"
                  className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <p className="text-xs text-zinc-500">New drafts start with empty front/body/back sections.</p>
                <button
                  type="submit"
                  className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-2 text-sm font-medium text-white"
                >
                  Create Draft
                </button>
              </div>
            </form>

            {message && (
              <div className="mb-4 rounded-lg border border-black/10 bg-white/80 px-4 py-2 text-sm text-zinc-700">
                {message}
              </div>
            )}

            {loading ? (
              <div className="rounded-2xl border border-black/10 bg-white/80 p-8 text-center shadow-lg">
                <p className="text-zinc-600">Loading drafts...</p>
              </div>
            ) : error ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center shadow-lg">
                <p className="text-red-700">{error}</p>
              </div>
            ) : drafts.length === 0 ? (
              <div className="rounded-2xl border border-black/10 bg-white/80 p-8 text-center shadow-lg">
                <p className="text-zinc-600">No drafts yet. Create your first draft above.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {drafts.map((draft) => {
                  const draftEditor = editorState[draft.id];
                  const snapshots = snapshotsByDraft[draft.id] || [];
                  const isBusy = busyDraftId === draft.id;
                  const sourceItems = extractDraftSourceItems(draft.section_structure || {});
                  const provenanceRecords = provenanceByDraft[draft.id] || [];
                  const provenanceLoading = Boolean(provenanceLoadingByDraft[draft.id]);
                  const provenanceError = provenanceErrorByDraft[draft.id];
                  const provenanceLastRefreshed = provenanceLastRefreshedByDraft[draft.id];
                  const licensePolicy = licensePolicyByDraft[draft.id];
                  const licensePolicyLoading = Boolean(licensePolicyLoadingByDraft[draft.id]);
                  const licensePolicyError = licensePolicyErrorByDraft[draft.id];

                  return (
                    <div
                      key={draft.id}
                      ref={(element) => {
                        draftCardRefs.current[draft.id] = element;
                      }}
                      className={`rounded-2xl border bg-white/85 p-4 shadow-sm transition-all sm:p-6 ${
                        highlightedDraftId === draft.id
                          ? "border-emerald-400 ring-2 ring-emerald-200"
                          : "border-black/10"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h2 className="font-[var(--font-display)] text-2xl text-[color:var(--deep)]">{draft.title}</h2>
                          {draft.description && <p className="text-sm text-zinc-600">{draft.description}</p>}
                          <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
                            <span className="rounded-full border border-black/10 bg-white px-2 py-1">{draft.status}</span>
                            <span>Updated {formatDate(draft.updated_at)}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleExpand(draft)}
                          className="rounded-lg border border-black/10 bg-white px-3 py-2 text-xs font-medium uppercase tracking-wider text-zinc-700"
                        >
                          {expandedDraftId === draft.id ? "Hide" : "Manage"}
                        </button>
                      </div>

                      {expandedDraftId === draft.id && draftEditor && (
                        <div className="mt-4 space-y-4 border-t border-black/10 pt-4">
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <input
                              type="text"
                              value={draftEditor.title}
                              onChange={(e) =>
                                setEditorState((prev) => ({
                                  ...prev,
                                  [draft.id]: { ...draftEditor, title: e.target.value },
                                }))
                              }
                              className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                            />
                            <input
                              type="text"
                              value={draftEditor.description}
                              onChange={(e) =>
                                setEditorState((prev) => ({
                                  ...prev,
                                  [draft.id]: { ...draftEditor, description: e.target.value },
                                }))
                              }
                              className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
                              Section Structure (JSON)
                            </label>
                            <textarea
                              value={draftEditor.sectionStructureText}
                              onChange={(e) =>
                                setEditorState((prev) => ({
                                  ...prev,
                                  [draft.id]: {
                                    ...draftEditor,
                                    sectionStructureText: e.target.value,
                                  },
                                }))
                              }
                              rows={10}
                              className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 font-mono text-xs"
                            />
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleSaveDraft(draft.id)}
                              disabled={isBusy}
                              className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Save Draft
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleAddCartBodyToDraft(draft)}
                              disabled={isBusy}
                              className="rounded-lg border border-amber-500/40 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Add Cart Body
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCreateSnapshot(draft)}
                              disabled={isBusy}
                              className="rounded-lg border border-emerald-500/40 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Create Snapshot
                            </button>
                            <button
                              type="button"
                              onClick={() => void handlePublishDraft(draft)}
                              disabled={isBusy}
                              className="rounded-lg border border-[color:var(--deep)]/30 bg-[color:var(--deep)] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Publish
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteDraft(draft)}
                              disabled={isBusy}
                              className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Delete Draft
                            </button>
                          </div>

                          <div>
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500">License Policy</h3>
                              <button
                                type="button"
                                onClick={() => void loadLicensePolicyForDraft(draft.id)}
                                disabled={licensePolicyLoading}
                                className="rounded-md border border-black/10 bg-white px-2 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {licensePolicyLoading ? "Refreshing…" : "Refresh"}
                              </button>
                            </div>
                            {licensePolicyLoading ? (
                              <p className="text-sm text-zinc-500">Checking license policy…</p>
                            ) : licensePolicyError ? (
                              <p className="text-sm text-rose-600">{licensePolicyError}</p>
                            ) : !licensePolicy ? (
                              <p className="text-sm text-zinc-500">No license policy report available yet.</p>
                            ) : (
                              <div className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm">
                                <div className="flex flex-wrap items-center gap-2 text-zinc-700">
                                  <span className="font-medium">Status:</span>
                                  <span
                                    className={`rounded-full border px-2 py-1 text-xs ${
                                      licensePolicy.status === "block"
                                        ? "border-rose-300 bg-rose-50 text-rose-700"
                                        : licensePolicy.status === "warn"
                                        ? "border-amber-300 bg-amber-50 text-amber-700"
                                        : "border-emerald-300 bg-emerald-50 text-emerald-700"
                                    }`}
                                  >
                                    {licensePolicy.status}
                                  </span>
                                  <span className="text-xs text-zinc-500">
                                    {licensePolicy.warning_issues.length} warning(s), {licensePolicy.blocked_issues.length} blocked
                                  </span>
                                </div>

                                {(licensePolicy.warning_issues.length > 0 || licensePolicy.blocked_issues.length > 0) && (
                                  <div className="mt-2 flex flex-col gap-1 text-xs text-zinc-600">
                                    {licensePolicy.warning_issues.map((issue) => (
                                      <div key={`warn-${issue.source_node_id}-${issue.license_type}`}>
                                        ⚠ Node {issue.source_node_id}: {issue.license_type}
                                      </div>
                                    ))}
                                    {licensePolicy.blocked_issues.map((issue) => (
                                      <div key={`block-${issue.source_node_id}-${issue.license_type}`} className="text-rose-700">
                                        ✗ Node {issue.source_node_id}: {issue.license_type}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          <div>
                            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Snapshots</h3>
                            {snapshots.length === 0 ? (
                              <p className="text-sm text-zinc-500">No snapshots yet.</p>
                            ) : (
                              <div className="flex flex-col gap-2">
                                {snapshots.map((snapshot) => (
                                  <div
                                    key={snapshot.id}
                                    className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-zinc-700"
                                  >
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="rounded-full border border-black/10 bg-white px-2 py-1 text-xs">
                                        v{snapshot.version}
                                      </span>
                                      <span className="text-xs text-zinc-500">{formatDate(snapshot.created_at)}</span>
                                      <span className="rounded-full border border-emerald-500/30 bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
                                        immutable
                                      </span>
                                      <a
                                        href={`/api/edition-snapshots/${snapshot.id}/export/pdf`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="rounded-md border border-black/10 bg-white px-2 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
                                      >
                                        Download PDF
                                      </a>
                                      <a
                                        href={`/editions/${snapshot.id}`}
                                        className="rounded-md border border-black/10 bg-white px-2 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
                                      >
                                        Open Reader
                                      </a>
                                    </div>
                                    {(() => {
                                      const templateMetadata = (snapshot.snapshot_data?.template_metadata || null) as
                                        | SnapshotTemplateMetadata
                                        | null;
                                      if (!templateMetadata?.template_family || !templateMetadata?.template_version) {
                                        return null;
                                      }

                                      return (
                                        <div className="mt-2 text-xs text-zinc-500">
                                          Template {templateMetadata.template_family}.{templateMetadata.template_version} • {templateMetadata.output_profile}
                                        </div>
                                      );
                                    })()}
                                    {(() => {
                                      const appendix = (snapshot.snapshot_data?.provenance_appendix || null) as
                                        | DraftProvenanceAppendix
                                        | null;
                                      const entries = appendix?.entries || [];
                                      if (entries.length === 0) {
                                        return null;
                                      }

                                      return (
                                        <div className="mt-2 rounded-md border border-black/10 bg-zinc-50 px-2 py-2">
                                          <div className="mb-1 text-xs font-medium uppercase tracking-wider text-zinc-600">
                                            Provenance Appendix ({entries.length})
                                          </div>
                                          <div className="flex flex-col gap-1 text-xs text-zinc-600">
                                            {entries.map((entry, index) => (
                                              <div key={`${snapshot.id}-${entry.source_node_id}-${index}`}>
                                                {entry.section} • {entry.title} (node {entry.source_node_id}) • {entry.license_type}
                                                {entry.source_author ? ` • ${entry.source_author}` : ""}
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      );
                                    })()}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          <div>
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <div className="flex flex-col">
                                <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Provenance</h3>
                                {provenanceLastRefreshed && (
                                  <span className="text-[11px] text-zinc-500">
                                    Last refreshed {formatDate(provenanceLastRefreshed)}
                                  </span>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => void loadProvenanceForDraft(draft)}
                                disabled={provenanceLoading}
                                className="rounded-md border border-black/10 bg-white px-2 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {provenanceLoading ? "Refreshing…" : "Refresh"}
                              </button>
                            </div>
                            {provenanceLoading ? (
                              <p className="text-sm text-zinc-500">Loading provenance…</p>
                            ) : provenanceError ? (
                              <p className="text-sm text-rose-600">{provenanceError}</p>
                            ) : sourceItems.length === 0 ? (
                              <p className="text-sm text-zinc-500">No source-linked draft items found.</p>
                            ) : (
                              <div className="flex flex-col gap-2">
                                {sourceItems.map((item, index) => {
                                  const matches = provenanceRecords.filter(
                                    (record) =>
                                      record.source_node_id === item.nodeId &&
                                      record.source_book_id === item.sourceBookId
                                  );
                                  const latest = matches[0];

                                  return (
                                    <div
                                      key={`${item.section}-${item.nodeId}-${index}`}
                                      className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                                    >
                                      <div className="flex flex-wrap items-center gap-2 text-zinc-700">
                                        <span className="rounded-full border border-black/10 bg-white px-2 py-1 text-xs">
                                          {item.section}
                                        </span>
                                        <span className="font-medium">{item.title}</span>
                                        <span className="text-xs text-zinc-500">(node {item.nodeId})</span>
                                      </div>
                                      {latest ? (
                                        <div className="mt-1 text-xs text-zinc-600">
                                          {matches.length} record(s) • License {latest.license_type} • Version {latest.source_version}
                                        </div>
                                      ) : (
                                        <div className="mt-1 text-xs text-zinc-500">
                                          No persisted provenance record yet for this source item.
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function DraftsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-[color:var(--sand)] via-white to-[color:var(--sand)]">
          <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
            <div className="rounded-2xl border border-black/10 bg-white/85 p-6 text-sm text-zinc-600">
              Loading drafts...
            </div>
          </div>
        </div>
      }
    >
      <DraftsPageContent />
    </Suspense>
  );
}
