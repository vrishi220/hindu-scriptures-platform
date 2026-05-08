"use client";

import { useState, useRef } from "react";
import type {
  BookShare,
  SharePermission,
  ShareDialogState,
  BookDetails,
  BookOption,
  BookMetadata,
  OwnedBookSummary,
  BookOwnershipTransferResponse,
} from "../../../lib/scriptureTypes";

export function useShareDialog({
  bookId,
  handleSelectBook,
  isCurrentBookOwner,
  currentBook,
  setBooks,
  setCurrentBook,
  loadBooksRefresh,
  setAuthMessage,
  setCopyTarget,
}: {
  bookId: string | null;
  handleSelectBook: (
    id: string,
    opts?: { syncUrl?: boolean; preserveLayout?: boolean }
  ) => boolean;
  isCurrentBookOwner: boolean;
  currentBook: BookDetails | null;
  setBooks: (books: BookOption[] | ((prev: BookOption[]) => BookOption[])) => void;
  setCurrentBook: (book: BookDetails | null) => void;
  loadBooksRefresh: () => Promise<void>;
  setAuthMessage: (msg: string | null) => void;
  setCopyTarget: (target: "book" | "node" | "leaf" | null) => void;
}) {
  const [shareDialogCopyFeedback, setShareDialogCopyFeedback] = useState<{
    key: string;
    ok: boolean;
  } | null>(null);
  const [showShareManager, setShowShareManager] = useState(false);
  const [shareDialogState, setShareDialogState] = useState<ShareDialogState | null>(null);
  const [bookShares, setBookShares] = useState<BookShare[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [sharesError, setSharesError] = useState<string | null>(null);
  const [shareEmail, setShareEmail] = useState("");
  const [sharePermission, setSharePermission] = useState<SharePermission>("viewer");
  const [sharesSubmitting, setSharesSubmitting] = useState(false);
  const [sendEmailWithShare, setSendEmailWithShare] = useState(true);
  const [publicShareRecipientEmail, setPublicShareRecipientEmail] = useState("");
  const [publicShareEmailSending, setPublicShareEmailSending] = useState(false);
  const [shareUpdatingUserId, setShareUpdatingUserId] = useState<number | null>(null);
  const [shareRemovingUserId, setShareRemovingUserId] = useState<number | null>(null);

  const [ownershipTargetEmail, setOwnershipTargetEmail] = useState("");
  const [ownedBooksForTransfer, setOwnedBooksForTransfer] = useState<OwnedBookSummary[]>([]);
  const [ownedBooksForTransferLoading, setOwnedBooksForTransferLoading] = useState(false);
  const [selectedOwnedBookIds, setSelectedOwnedBookIds] = useState<number[]>([]);
  const [showOwnershipTransferDialog, setShowOwnershipTransferDialog] = useState(false);
  const [ownershipTransferSubmitting, setOwnershipTransferSubmitting] = useState(false);
  const [ownershipTransferError, setOwnershipTransferError] = useState<string | null>(null);
  const [ownershipTransferMessage, setOwnershipTransferMessage] = useState<string | null>(null);

  const shareDialogCopyFeedbackTimerRef = useRef<number | null>(null);

  const loadBookShares = async (targetBookId?: string) => {
    const effectiveBookId = targetBookId ?? bookId;
    if (!effectiveBookId) return;
    setSharesLoading(true);
    setSharesError(null);
    try {
      const response = await fetch(`/api/books/${effectiveBookId}/shares`, {
        credentials: "include",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as
        | BookShare[]
        | { detail?: string }
        | null;
      if (!response.ok) {
        setBookShares([]);
        setSharesError(
          (payload as { detail?: string } | null)?.detail || "Failed to load shares"
        );
        return;
      }
      setBookShares(Array.isArray(payload) ? payload : []);
    } catch {
      setBookShares([]);
      setSharesError("Failed to load shares");
    } finally {
      setSharesLoading(false);
    }
  };

  const closeShareDialog = () => {
    if (shareDialogCopyFeedbackTimerRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(shareDialogCopyFeedbackTimerRef.current);
      shareDialogCopyFeedbackTimerRef.current = null;
    }
    setShareDialogCopyFeedback(null);
    setShowShareManager(false);
    setSharesError(null);
    setPublicShareRecipientEmail("");
    setPublicShareEmailSending(false);
    setShareDialogState(null);
  };

  const openShareDialogForBook = async (nextDialogState: ShareDialogState) => {
    const didSelect = handleSelectBook(nextDialogState.bookId, {
      syncUrl: false,
      preserveLayout: true,
    });
    if (!didSelect) return;
    setSharesError(null);
    setPublicShareRecipientEmail("");
    setPublicShareEmailSending(false);
    const params = new URLSearchParams();
    params.set("book", nextDialogState.bookId);
    params.set("preview", "book");
    const defaultPreviewPath = `/scriptures?${params.toString()}`;
    const effectivePrivateAccessPath =
      nextDialogState.privateAccessPath || defaultPreviewPath;
    setShareDialogState({
      ...nextDialogState,
      privateAccessPath: effectivePrivateAccessPath,
      privateCopyTarget: nextDialogState.privateCopyTarget || "book",
    });
    setShowShareManager(true);
    if (nextDialogState.visibility === "private" && nextDialogState.canManageShares) {
      await loadBookShares(nextDialogState.bookId);
      return;
    }
    setBookShares([]);
    setSharesLoading(false);
  };

  const showShareDialogCopyFeedback = (key: string, ok: boolean) => {
    if (shareDialogCopyFeedbackTimerRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(shareDialogCopyFeedbackTimerRef.current);
      shareDialogCopyFeedbackTimerRef.current = null;
    }
    setShareDialogCopyFeedback({ key, ok });
    if (typeof window !== "undefined") {
      shareDialogCopyFeedbackTimerRef.current = window.setTimeout(() => {
        setShareDialogCopyFeedback(null);
        shareDialogCopyFeedbackTimerRef.current = null;
      }, 1800);
    }
  };

  const writeClipboardText = async (text: string) => {
    if (typeof window === "undefined" || !navigator.clipboard) {
      return false;
    }
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };

  const copyShareUrl = async (
    absoluteUrl: string,
    target: "book" | "node" | "leaf",
    onDone?: () => void
  ): Promise<boolean> => {
    onDone?.();
    const ok = await writeClipboardText(absoluteUrl);
    if (ok) {
      setAuthMessage("Link copied.");
      setCopyTarget(target);
      window.setTimeout(() => {
        setAuthMessage(null);
        setCopyTarget(null);
      }, 2000);
    } else {
      setAuthMessage("Failed to copy link.");
      setCopyTarget(target);
      window.setTimeout(() => {
        setAuthMessage(null);
        setCopyTarget(null);
      }, 2000);
    }
    return ok;
  };

  const emailShareUrl = (
    subjectText: string,
    bodyText: string,
    recipientEmail: string,
    onDone?: () => void
  ) => {
    if (typeof window === "undefined") {
      return;
    }

    const isValidEmailAddress = (value: string) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

    const email = recipientEmail.trim();
    if (!email) {
      onDone?.();
      return;
    }

    if (!isValidEmailAddress(email)) {
      alert("Please enter a valid email address");
      onDone?.();
      return;
    }

    const sendEmail = async () => {
      setPublicShareEmailSending(true);
      try {
        const response = await fetch("/api/email/send", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            to: email,
            subject: subjectText,
            body: bodyText,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          alert("Failed to send email: " + (errorData.detail || "Unknown error"));
        } else {
          alert("Email sent successfully!");
        }
      } catch (error) {
        console.error("Error sending email:", error);
        alert("Failed to send email. Please try again.");
      } finally {
        setPublicShareEmailSending(false);
        onDone?.();
      }
    };

    sendEmail();
  };

  const handleCreateShare = async (e: React.FormEvent) => {
    e.preventDefault();
    const effectiveBookId = shareDialogState?.bookId || bookId;
    if (!effectiveBookId || !shareEmail.trim()) {
      setSharesError("No active book selected for sharing");
      return;
    }

    setSharesSubmitting(true);
    setSharesError(null);
    try {
      const response = await fetch(`/api/books/${effectiveBookId}/shares`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: shareEmail.trim(),
          permission: sharePermission,
          send_email: sendEmailWithShare,
          access_path: shareDialogState?.privateAccessPath,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | BookShare
        | { detail?: string }
        | null;
      if (!response.ok) {
        setSharesError(
          (payload as { detail?: string } | null)?.detail || "Failed to add share"
        );
        return;
      }
      setShareEmail("");
      setSharePermission("viewer");
      setSendEmailWithShare(true);
      await loadBookShares(effectiveBookId);
    } catch {
      setSharesError("Failed to add share");
    } finally {
      setSharesSubmitting(false);
    }
  };

  const handleUpdateSharePermission = async (
    sharedUserId: number,
    permission: SharePermission
  ) => {
    const effectiveBookId = shareDialogState?.bookId || bookId;
    if (!effectiveBookId) {
      setSharesError("No active book selected for sharing");
      return;
    }

    setShareUpdatingUserId(sharedUserId);
    setSharesError(null);
    try {
      const response = await fetch(
        `/api/books/${effectiveBookId}/shares/${sharedUserId}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ permission }),
        }
      );
      const payload = (await response.json().catch(() => null)) as
        | BookShare
        | { detail?: string }
        | null;
      if (!response.ok) {
        setSharesError(
          (payload as { detail?: string } | null)?.detail || "Failed to update share"
        );
        return;
      }
      setBookShares((prev) =>
        prev.map((share) =>
          share.shared_with_user_id === sharedUserId
            ? { ...share, permission }
            : share
        )
      );
    } catch {
      setSharesError("Failed to update share");
    } finally {
      setShareUpdatingUserId(null);
    }
  };

  const handleDeleteShare = async (sharedUserId: number) => {
    const effectiveBookId = shareDialogState?.bookId || bookId;
    if (!effectiveBookId) {
      setSharesError("No active book selected for sharing");
      return;
    }

    setShareRemovingUserId(sharedUserId);
    setSharesError(null);
    try {
      const response = await fetch(`/api/books/${effectiveBookId}/shares/${sharedUserId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const payload = (await response.json().catch(() => null)) as
        | { message?: string; detail?: string }
        | null;
      if (!response.ok) {
        setSharesError(payload?.detail || "Failed to remove share");
        return;
      }
      setBookShares((prev) =>
        prev.filter((share) => share.shared_with_user_id !== sharedUserId)
      );
    } catch {
      setSharesError("Failed to remove share");
    } finally {
      setShareRemovingUserId(null);
    }
  };

  const loadOwnedBooksForTransfer = async () => {
    if (!isCurrentBookOwner) {
      setOwnedBooksForTransfer([]);
      setSelectedOwnedBookIds([]);
      return;
    }

    setOwnedBooksForTransferLoading(true);
    setOwnershipTransferError(null);
    try {
      const response = await fetch("/api/books/owned-by-me", {
        credentials: "include",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as
        | OwnedBookSummary[]
        | { detail?: string }
        | null;

      if (!response.ok) {
        throw new Error(
          (payload as { detail?: string } | null)?.detail || "Failed to load owned books"
        );
      }

      const books = Array.isArray(payload) ? payload : [];
      setOwnedBooksForTransfer(books);
      setSelectedOwnedBookIds((prev) => {
        if (prev.length > 0) {
          const validIds = new Set(books.map((book) => book.id));
          return prev.filter((id) => validIds.has(id));
        }
        const currentId = currentBook?.id;
        if (typeof currentId === "number" && books.some((book) => book.id === currentId)) {
          return [currentId];
        }
        return [];
      });
    } catch (err) {
      setOwnedBooksForTransfer([]);
      setSelectedOwnedBookIds([]);
      setOwnershipTransferError(
        err instanceof Error ? err.message : "Failed to load owned books"
      );
    } finally {
      setOwnedBooksForTransferLoading(false);
    }
  };

  const handleTransferBookOwnership = async () => {
    const targetEmail = ownershipTargetEmail.trim().toLowerCase();
    if (!targetEmail) {
      setOwnershipTransferError("Target email is required");
      return;
    }
    if (selectedOwnedBookIds.length === 0) {
      setOwnershipTransferError("Select at least one book");
      return;
    }

    const selectedBookNames = ownedBooksForTransfer
      .filter((book) => selectedOwnedBookIds.includes(book.id))
      .map((book) => book.book_name);
    const previewList = selectedBookNames.slice(0, 3).join(", ");
    const plusMore =
      selectedBookNames.length > 3 ? ` +${selectedBookNames.length - 3} more` : "";
    if (
      !window.confirm(
        `Transfer ownership of ${selectedOwnedBookIds.length} selected book(s) to ${targetEmail}? ${previewList}${plusMore}`
      )
    ) {
      return;
    }

    setOwnershipTransferSubmitting(true);
    setOwnershipTransferError(null);
    setOwnershipTransferMessage(null);
    try {
      const response = await fetch("/api/books/transfer-ownership", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_email: targetEmail,
          book_ids: selectedOwnedBookIds,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | BookOwnershipTransferResponse
        | { detail?: string }
        | null;

      if (!response.ok) {
        throw new Error(
          (payload as { detail?: string } | null)?.detail || "Ownership transfer failed"
        );
      }

      const result = payload as BookOwnershipTransferResponse;
      const transferredIds = new Set(result.transferred_book_ids || []);
      const patchOwnerMetadata = (
        metadata: BookMetadata | null | undefined
      ): BookMetadata => ({
        ...(metadata || {}),
        owner_id: result.target_user_id,
        owner_email: result.target_email,
      });

      setBooks((prev) =>
        prev.map((book) =>
          transferredIds.has(book.id)
            ? {
                ...book,
                metadata_json: patchOwnerMetadata(book.metadata_json),
                metadata: patchOwnerMetadata(book.metadata),
              }
            : book
        )
      );
      if (currentBook && transferredIds.has(currentBook.id)) {
        setCurrentBook({
          ...currentBook,
          metadata_json: patchOwnerMetadata(currentBook.metadata_json),
          metadata: patchOwnerMetadata(currentBook.metadata),
        });
      }

      setOwnershipTransferMessage(
        `Transferred ${result.transferred_count} book(s) to ${result.target_email}.`
      );
      setShowOwnershipTransferDialog(false);
      setSelectedOwnedBookIds([]);
      setOwnershipTargetEmail("");
      setOwnedBooksForTransfer([]);
      await loadBooksRefresh();
    } catch (err) {
      setOwnershipTransferError(
        err instanceof Error ? err.message : "Ownership transfer failed"
      );
    } finally {
      setOwnershipTransferSubmitting(false);
    }
  };

  const openOwnershipTransferDialog = async () => {
    if (!isCurrentBookOwner) return;
    setOwnershipTransferError(null);
    setOwnershipTransferMessage(null);
    setOwnershipTargetEmail("");
    setSelectedOwnedBookIds([]);
    setShowOwnershipTransferDialog(true);
    await loadOwnedBooksForTransfer();
  };

  const closeOwnershipTransferDialog = () => {
    setShowOwnershipTransferDialog(false);
    setOwnershipTransferError(null);
    setOwnershipTargetEmail("");
    setOwnedBooksForTransfer([]);
    setSelectedOwnedBookIds([]);
  };

  return {
    shareDialogCopyFeedback,
    showShareManager,
    setShowShareManager,
    shareDialogState,
    setShareDialogState,
    bookShares,
    setBookShares,
    sharesLoading,
    setSharesLoading,
    sharesError,
    setSharesError,
    shareEmail,
    setShareEmail,
    sharePermission,
    setSharePermission,
    sharesSubmitting,
    sendEmailWithShare,
    setSendEmailWithShare,
    publicShareRecipientEmail,
    setPublicShareRecipientEmail,
    publicShareEmailSending,
    setPublicShareEmailSending,
    shareUpdatingUserId,
    shareRemovingUserId,
    ownershipTargetEmail,
    setOwnershipTargetEmail,
    ownedBooksForTransfer,
    ownedBooksForTransferLoading,
    selectedOwnedBookIds,
    setSelectedOwnedBookIds,
    showOwnershipTransferDialog,
    setShowOwnershipTransferDialog,
    ownershipTransferSubmitting,
    ownershipTransferError,
    setOwnershipTransferError,
    ownershipTransferMessage,
    setOwnershipTransferMessage,
    setOwnedBooksForTransfer,
    loadBookShares,
    closeShareDialog,
    openShareDialogForBook,
    showShareDialogCopyFeedback,
    copyShareUrl,
    emailShareUrl,
    handleCreateShare,
    handleUpdateSharePermission,
    handleDeleteShare,
    loadOwnedBooksForTransfer,
    handleTransferBookOwnership,
    openOwnershipTransferDialog,
    closeOwnershipTransferDialog,
  };
}
