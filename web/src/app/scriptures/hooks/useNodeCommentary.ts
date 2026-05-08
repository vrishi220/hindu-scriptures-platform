"use client";

import { useState, useRef, useEffect } from "react";
import type { CommentaryEntry, NodeComment } from "../../../lib/scriptureTypes";
import { contentPath } from "../../../lib/apiPaths";
import { getMe } from "../../../lib/authClient";

export function useNodeCommentary({
  selectedId,
}: {
  selectedId: number | null;
}) {
  const [nodeCommentary, setNodeCommentary] = useState<CommentaryEntry[]>([]);
  const [nodeCommentaryLoading, setNodeCommentaryLoading] = useState(false);
  const [nodeCommentaryError, setNodeCommentaryError] = useState<string | null>(null);
  const [nodeComments, setNodeComments] = useState<NodeComment[]>([]);
  const [nodeCommentsLoading, setNodeCommentsLoading] = useState(false);
  const [nodeCommentsError, setNodeCommentsError] = useState<string | null>(null);
  const [nodeCommentEditorOpen, setNodeCommentEditorOpen] = useState(false);
  const [nodeCommentEditingId, setNodeCommentEditingId] = useState<number | null>(null);
  const [nodeCommentFormLanguage, setNodeCommentFormLanguage] = useState("en");
  const [nodeCommentFormText, setNodeCommentFormText] = useState("");
  const [nodeCommentSubmitting, setNodeCommentSubmitting] = useState(false);
  const [nodeCommentMessage, setNodeCommentMessage] = useState<string | null>(null);
  const [commentaryEditorOpen, setCommentaryEditorOpen] = useState(false);
  const [commentaryEditingId, setCommentaryEditingId] = useState<number | null>(null);
  const [commentaryFormAuthor, setCommentaryFormAuthor] = useState("");
  const [commentaryFormWorkTitle, setCommentaryFormWorkTitle] = useState("");
  const [commentaryFormLanguage, setCommentaryFormLanguage] = useState("en");
  const [commentaryFormText, setCommentaryFormText] = useState("");
  const [commentarySubmitting, setCommentarySubmitting] = useState(false);
  const [commentaryMessage, setCommentaryMessage] = useState<string | null>(null);

  const activeNodeCommentaryRequestId = useRef(0);
  const activeNodeCommentaryAbortController = useRef<AbortController | null>(null);
  const activeNodeCommentaryNodeId = useRef<number | null>(null);
  const activeNodeCommentsRequestId = useRef(0);
  const activeNodeCommentsAbortController = useRef<AbortController | null>(null);
  const activeNodeCommentsNodeId = useRef<number | null>(null);

  const fetchContent = async (path: string, init?: RequestInit): Promise<Response> => {
    let response = await fetch(contentPath(path), init);
    if (response.status !== 401) return response;
    await getMe({ force: true }).catch(() => null);
    response = await fetch(contentPath(path), init);
    return response;
  };

  const loadNodeCommentary = async (nodeId: number, force = false) => {
    if (!force && activeNodeCommentaryNodeId.current === nodeId) return;

    activeNodeCommentaryAbortController.current?.abort();
    const abortController = new AbortController();
    activeNodeCommentaryAbortController.current = abortController;
    const requestId = activeNodeCommentaryRequestId.current + 1;
    activeNodeCommentaryRequestId.current = requestId;
    activeNodeCommentaryNodeId.current = nodeId;

    setNodeCommentaryLoading(true);
    setNodeCommentaryError(null);
    try {
      const response = await fetchContent(`/nodes/${nodeId}/commentary?limit=100`, {
        credentials: "include",
        signal: abortController.signal,
      });
      if (requestId !== activeNodeCommentaryRequestId.current) return;
      if (!response.ok) {
        setNodeCommentary([]);
        setNodeCommentaryError("Unable to load commentary for this node.");
        return;
      }
      const data = (await response.json()) as CommentaryEntry[];
      if (requestId !== activeNodeCommentaryRequestId.current) return;
      setNodeCommentary(Array.isArray(data) ? data : []);
      setNodeCommentaryError(null);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      if (requestId !== activeNodeCommentaryRequestId.current) return;
      setNodeCommentary([]);
      setNodeCommentaryError("Unable to load commentary for this node.");
    } finally {
      if (requestId === activeNodeCommentaryRequestId.current) {
        setNodeCommentaryLoading(false);
        activeNodeCommentaryNodeId.current = null;
      }
    }
  };

  const loadNodeComments = async (nodeId: number, force = false) => {
    if (!force && activeNodeCommentsNodeId.current === nodeId) return;

    activeNodeCommentsAbortController.current?.abort();
    const abortController = new AbortController();
    activeNodeCommentsAbortController.current = abortController;
    const requestId = activeNodeCommentsRequestId.current + 1;
    activeNodeCommentsRequestId.current = requestId;
    activeNodeCommentsNodeId.current = nodeId;

    setNodeCommentsLoading(true);
    setNodeCommentsError(null);
    try {
      const response = await fetchContent(`/nodes/${nodeId}/comments?limit=200`, {
        credentials: "include",
        signal: abortController.signal,
      });
      if (requestId !== activeNodeCommentsRequestId.current) return;
      if (!response.ok) {
        setNodeComments([]);
        setNodeCommentsError("Unable to load comments for this node.");
        return;
      }
      const data = (await response.json()) as NodeComment[];
      if (requestId !== activeNodeCommentsRequestId.current) return;
      setNodeComments(Array.isArray(data) ? data : []);
      setNodeCommentsError(null);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      if (requestId !== activeNodeCommentsRequestId.current) return;
      setNodeComments([]);
      setNodeCommentsError("Unable to load comments for this node.");
    } finally {
      if (requestId === activeNodeCommentsRequestId.current) {
        setNodeCommentsLoading(false);
        activeNodeCommentsNodeId.current = null;
      }
    }
  };

  const resetNodeCommentEditor = () => {
    setNodeCommentEditingId(null);
    setNodeCommentFormLanguage("en");
    setNodeCommentFormText("");
  };

  const openCreateNodeCommentEditor = () => {
    resetNodeCommentEditor();
    setNodeCommentEditorOpen(true);
    setNodeCommentMessage(null);
  };

  const openEditNodeCommentEditor = (entry: NodeComment) => {
    setNodeCommentEditingId(entry.id);
    setNodeCommentFormLanguage((entry.language_code || "en").trim().toLowerCase() || "en");
    setNodeCommentFormText(entry.content_text || "");
    setNodeCommentEditorOpen(true);
    setNodeCommentMessage(null);
  };

  const handleSubmitNodeComment = async () => {
    if (!selectedId) return;
    const trimmedText = nodeCommentFormText.trim();
    if (!trimmedText) {
      setNodeCommentMessage("Comment text is required.");
      return;
    }

    const trimmedLanguage = nodeCommentFormLanguage.trim().toLowerCase() || "en";

    setNodeCommentSubmitting(true);
    setNodeCommentMessage(null);
    try {
      const endpoint =
        nodeCommentEditingId !== null
          ? contentPath(`/nodes/${selectedId}/comments/${nodeCommentEditingId}`)
          : contentPath(`/nodes/${selectedId}/comments`);
      const payload =
        nodeCommentEditingId !== null
          ? {
              content_text: trimmedText,
              language_code: trimmedLanguage,
            }
          : {
              node_id: selectedId,
              content_text: trimmedText,
              language_code: trimmedLanguage,
            };

      const response = await fetch(endpoint, {
        method: nodeCommentEditingId !== null ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => null)) as { detail?: string } | null;
      if (!response.ok) {
        throw new Error(result?.detail || "Unable to save comment.");
      }

      await loadNodeComments(selectedId, true);
      resetNodeCommentEditor();
      setNodeCommentEditorOpen(false);
      setNodeCommentMessage("Comment saved.");
    } catch (err) {
      setNodeCommentMessage(err instanceof Error ? err.message : "Unable to save comment.");
    } finally {
      setNodeCommentSubmitting(false);
    }
  };

  const handleDeleteNodeComment = async (commentId: number) => {
    if (!selectedId) return;
    if (!window.confirm("Delete this comment?")) return;

    setNodeCommentSubmitting(true);
    setNodeCommentMessage(null);
    try {
      const response = await fetchContent(`/nodes/${selectedId}/comments/${commentId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const result = (await response.json().catch(() => null)) as { detail?: string } | null;
      if (!response.ok) {
        throw new Error(result?.detail || "Unable to delete comment.");
      }

      await loadNodeComments(selectedId, true);
      if (nodeCommentEditingId === commentId) {
        resetNodeCommentEditor();
      }
      setNodeCommentMessage("Comment deleted.");
    } catch (err) {
      setNodeCommentMessage(err instanceof Error ? err.message : "Unable to delete comment.");
    } finally {
      setNodeCommentSubmitting(false);
    }
  };

  const resetCommentaryEditor = () => {
    setCommentaryEditingId(null);
    setCommentaryFormAuthor("");
    setCommentaryFormWorkTitle("");
    setCommentaryFormLanguage("en");
    setCommentaryFormText("");
  };

  const openCreateCommentaryEditor = () => {
    resetCommentaryEditor();
    setCommentaryEditorOpen(true);
    setCommentaryMessage(null);
  };

  const openEditCommentaryEditor = (entry: CommentaryEntry) => {
    const metadata =
      entry.metadata && typeof entry.metadata === "object"
        ? (entry.metadata as Record<string, unknown>)
        : {};
    const author = typeof metadata.author === "string" ? metadata.author : "";
    const workTitle = typeof metadata.work_title === "string" ? metadata.work_title : "";

    setCommentaryEditingId(entry.id);
    setCommentaryFormAuthor(author);
    setCommentaryFormWorkTitle(workTitle);
    setCommentaryFormLanguage((entry.language_code || "en").trim().toLowerCase() || "en");
    setCommentaryFormText(entry.content_text || "");
    setCommentaryEditorOpen(true);
    setCommentaryMessage(null);
  };

  const handleSubmitCommentary = async () => {
    if (!selectedId) return;
    const trimmedText = commentaryFormText.trim();
    if (!trimmedText) {
      setCommentaryMessage("Commentary text is required.");
      return;
    }

    const trimmedLanguage = commentaryFormLanguage.trim().toLowerCase() || "en";
    const trimmedAuthor = commentaryFormAuthor.trim();
    const trimmedWorkTitle = commentaryFormWorkTitle.trim();
    const metadata: Record<string, unknown> = {};
    if (trimmedAuthor) metadata.author = trimmedAuthor;
    if (trimmedWorkTitle) metadata.work_title = trimmedWorkTitle;

    setCommentarySubmitting(true);
    setCommentaryMessage(null);
    try {
      const endpoint =
        commentaryEditingId !== null
          ? contentPath(`/nodes/${selectedId}/commentary/${commentaryEditingId}`)
          : contentPath(`/nodes/${selectedId}/commentary`);
      const payload =
        commentaryEditingId !== null
          ? {
              content_text: trimmedText,
              language_code: trimmedLanguage,
              metadata,
            }
          : {
              node_id: selectedId,
              content_text: trimmedText,
              language_code: trimmedLanguage,
              metadata,
            };

      const response = await fetch(endpoint, {
        method: commentaryEditingId !== null ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => null)) as { detail?: string } | null;
      if (!response.ok) {
        throw new Error(result?.detail || "Unable to save commentary.");
      }

      await loadNodeCommentary(selectedId, true);
      resetCommentaryEditor();
      setCommentaryEditorOpen(false);
      setCommentaryMessage("Commentary saved.");
    } catch (err) {
      setCommentaryMessage(err instanceof Error ? err.message : "Unable to save commentary.");
    } finally {
      setCommentarySubmitting(false);
    }
  };

  const handleDeleteCommentary = async (entryId: number) => {
    if (!selectedId) return;
    if (!window.confirm("Delete this commentary entry?")) return;

    setCommentarySubmitting(true);
    setCommentaryMessage(null);
    try {
      const response = await fetchContent(`/nodes/${selectedId}/commentary/${entryId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const result = (await response.json().catch(() => null)) as { detail?: string } | null;
      if (!response.ok) {
        throw new Error(result?.detail || "Unable to delete commentary.");
      }

      await loadNodeCommentary(selectedId, true);
      if (commentaryEditingId === entryId) {
        resetCommentaryEditor();
      }
      setCommentaryMessage("Commentary deleted.");
    } catch (err) {
      setCommentaryMessage(err instanceof Error ? err.message : "Unable to delete commentary.");
    } finally {
      setCommentarySubmitting(false);
    }
  };

  // Manages commentary lifecycle when selected node changes
  useEffect(() => {
    if (!selectedId) {
      activeNodeCommentaryAbortController.current?.abort();
      setNodeCommentary([]);
      setNodeCommentaryError(null);
      setNodeCommentaryLoading(false);
      activeNodeCommentsAbortController.current?.abort();
      setNodeComments([]);
      setNodeCommentsError(null);
      setNodeCommentsLoading(false);
      setNodeCommentEditorOpen(false);
      setNodeCommentEditingId(null);
      setNodeCommentFormLanguage("en");
      setNodeCommentFormText("");
      setNodeCommentMessage(null);
      setCommentaryEditorOpen(false);
      setCommentaryEditingId(null);
      setCommentaryFormAuthor("");
      setCommentaryFormWorkTitle("");
      setCommentaryFormLanguage("en");
      setCommentaryFormText("");
      setCommentaryMessage(null);
      return;
    }

    void loadNodeCommentary(selectedId);
    void loadNodeComments(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  return {
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
    loadNodeCommentary,
    loadNodeComments,
    resetNodeCommentEditor,
    openCreateNodeCommentEditor,
    openEditNodeCommentEditor,
    handleSubmitNodeComment,
    handleDeleteNodeComment,
    resetCommentaryEditor,
    openCreateCommentaryEditor,
    openEditCommentaryEditor,
    handleSubmitCommentary,
    handleDeleteCommentary,
  };
}
