"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type {
  BasketItem,
  TreeNode,
  NodeContent,
  BookDetails,
  BookPreviewArtifact,
  BookPreviewBlock,
} from "../../../lib/scriptureTypes";
import {
  formatValue,
  parseSequenceNumber,
  getSequenceSortValue,
  formatSequenceDisplay,
} from "../../../lib/scriptureUtils";

const findPath = (nodes: TreeNode[], targetId: number): TreeNode[] | null => {
  for (const node of nodes) {
    if (node.id === targetId) {
      return [node];
    }
    if (node.children && node.children.length > 0) {
      const childPath = findPath(node.children, targetId);
      if (childPath) {
        return [node, ...childPath];
      }
    }
  }
  return null;
};

const findNodeById = (nodes: TreeNode[], id: number): TreeNode | null => {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children && node.children.length > 0) {
      const found = findNodeById(node.children, id);
      if (found) return found;
    }
  }
  return null;
};

export function useBasket({
  authEmail,
  authResolved,
  nodeContent,
  treeData,
  breadcrumb,
  currentBook,
  selectedId,
  bookPreviewArtifact,
  setPreviewBasketUiOverrides,
  getNodeBreadcrumbLabel,
  getSchemaMatchedLevelName,
}: {
  authEmail: string | null;
  authResolved: boolean;
  nodeContent: NodeContent | null;
  treeData: TreeNode[];
  breadcrumb: TreeNode[];
  currentBook: BookDetails | null;
  selectedId: number | null;
  bookPreviewArtifact: BookPreviewArtifact | null;
  setPreviewBasketUiOverrides: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  getNodeBreadcrumbLabel: (node: TreeNode | NodeContent) => string;
  getSchemaMatchedLevelName: (levelName: string, levelOrder?: number | null) => string;
}) {
  const [isReorderingBasket, setIsReorderingBasket] = useState(false);
  const [basketItems, setBasketItems] = useState<BasketItem[]>([]);
  const cancelledPreviewBasketAddsRef = useRef<Set<number>>(new Set());
  const [basketRangeStart, setBasketRangeStart] = useState("");
  const [basketRangeEnd, setBasketRangeEnd] = useState("");
  const [basketRangeSubmitting, setBasketRangeSubmitting] = useState(false);
  const [basketRangeMessage, setBasketRangeMessage] = useState<string | null>(null);

  const loadBasket = async () => {
    try {
      const response = await fetch("/api/cart/me", { credentials: "include" });
      if (!response.ok) {
        setBasketItems([]);
        return;
      }
      const data = (await response.json()) as {
        items?: Array<{
          id: number;
          item_id: number;
          order: number;
          metadata?: {
            title?: string;
            content?: string;
            breadcrumb?: string;
            book_name?: string;
            level_name?: string;
          };
        }>;
      };

      const mappedItems = (data.items || [])
        .map((item) => ({
          cart_item_id: item.id,
          node_id: item.item_id,
          title: item.metadata?.title,
          content: item.metadata?.content,
          breadcrumb: item.metadata?.breadcrumb,
          book_name: item.metadata?.book_name,
          level_name: item.metadata?.level_name,
          order: item.order,
        }))
        .sort((a, b) => a.order - b.order);

      setBasketItems(mappedItems);
    } catch {
      setBasketItems([]);
    }
  };

  useEffect(() => {
    if (!authResolved) return;

    if (!authEmail) {
      setBasketItems([]);
      return;
    }
    void loadBasket();
  }, [authResolved, authEmail]);

  const addCurrentToBasket = () => {
    if (!nodeContent) return;

    void (async () => {
      if (basketItems.some((item) => item.node_id === nodeContent.id)) {
        return;
      }

      const seq = formatSequenceDisplay(
        nodeContent.sequence_number ?? nodeContent.id,
        Boolean(nodeContent.has_content)
      ) || nodeContent.id;
      const title = `${formatValue(nodeContent.level_name) || "Level"} ${seq}`;
      const contentPreview =
        formatValue(nodeContent.content_data?.basic?.translation) ||
        formatValue(nodeContent.content_data?.translations?.english) ||
        formatValue(nodeContent.content_data?.basic?.transliteration) ||
        formatValue(nodeContent.content_data?.basic?.sanskrit) ||
        undefined;
      const fullPath = findPath(treeData, nodeContent.id) || breadcrumb;
      const breadcrumbPathParts = fullPath.map((node, index) => {
        const canonicalLevel = getSchemaMatchedLevelName(
          formatValue(node.level_name) || "",
          typeof node.level_order === "number" ? node.level_order : null
        );
        const levelRaw = canonicalLevel || formatValue(node.level_name) || "Level";
        const levelLabel = levelRaw
          .toString()
          .replace(/_/g, " ")
          .toLowerCase()
          .replace(/\b\w/g, (char) => char.toUpperCase());
        const isLeaf = index === fullPath.length - 1;
        const seq = formatSequenceDisplay(node.sequence_number || node.id, isLeaf);
        const levelWithSeq = seq ? `${levelLabel} ${seq}` : levelLabel;
        const preferred = getNodeBreadcrumbLabel(node).trim();
        const normalizedPreferred = preferred.toLowerCase();
        const normalizedLevelWithSeq = levelWithSeq.toLowerCase();
        const preferredHasSameSeq = Boolean(seq) && normalizedPreferred.includes(seq.toString());
        const levelHasSameSeq = Boolean(seq) && normalizedLevelWithSeq.includes(seq.toString());

        if (!preferred) return levelWithSeq;
        if (normalizedPreferred === levelLabel.toLowerCase()) return levelWithSeq;
        if (normalizedPreferred === normalizedLevelWithSeq) return preferred;
        if (preferredHasSameSeq && levelHasSameSeq) return preferred;
        return `${preferred}: ${levelWithSeq}`;
      });
      const breadcrumbParts = [
        currentBook?.book_name,
        ...breadcrumbPathParts,
      ].filter((part): part is string => Boolean(part && part.trim()));
      const breadcrumbText = breadcrumbParts.length > 0 ? breadcrumbParts.join(" / ") : undefined;

      try {
        const response = await fetch("/api/cart/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            item_id: nodeContent.id,
            item_type: "library_node",
            metadata: {
              title,
              content: contentPreview,
              breadcrumb: breadcrumbText,
              book_name: currentBook?.book_name,
              level_name: nodeContent.level_name,
            },
          }),
        });

        if (response.status === 409) {
          await loadBasket();
          return;
        }

        if (!response.ok) {
          return;
        }

        const item = (await response.json()) as {
          id: number;
          item_id: number;
          order: number;
          metadata?: {
            title?: string;
            content?: string;
            breadcrumb?: string;
            book_name?: string;
            level_name?: string;
          };
        };

        setBasketItems((prev) =>
          [
            ...prev,
            {
              cart_item_id: item.id,
              node_id: item.item_id,
              title: item.metadata?.title || title,
              content: item.metadata?.content || contentPreview,
              breadcrumb: item.metadata?.breadcrumb || breadcrumbText,
              book_name: item.metadata?.book_name || currentBook?.book_name,
              level_name: item.metadata?.level_name || nodeContent.level_name,
              order: item.order,
            },
          ].sort((a, b) => a.order - b.order)
        );
      } catch {
        // ignore basket add failures for now
      }
    })();
  };

  const addSelectedRangeToBasket = () => {
    const selectedTreeNode = selectedId ? findNodeById(treeData, selectedId) : null;
    if (!selectedTreeNode || !authEmail) {
      return;
    }

    void (async () => {
      const parsedStart = Number.parseInt(basketRangeStart.trim(), 10);
      const parsedEnd = Number.parseInt(basketRangeEnd.trim(), 10);

      if (!Number.isFinite(parsedStart) || !Number.isFinite(parsedEnd)) {
        setBasketRangeMessage("Enter valid start and end verse numbers.");
        return;
      }

      if (parsedStart <= 0 || parsedEnd <= 0) {
        setBasketRangeMessage("Verse numbers must be positive.");
        return;
      }

      if (parsedStart > parsedEnd) {
        setBasketRangeMessage("Start verse must be less than or equal to end verse.");
        return;
      }

      const directChildren = Array.isArray(selectedTreeNode.children)
        ? selectedTreeNode.children
        : [];
      const candidateVerses = directChildren
        .filter((node) => !node.children || node.children.length === 0)
        .map((node) => ({
          node,
          sequence: getSequenceSortValue(node),
        }))
        .filter((entry) => Number.isFinite(entry.sequence))
        .sort((a, b) => a.sequence - b.sequence)
        .filter((entry) => entry.sequence >= parsedStart && entry.sequence <= parsedEnd)
        .map((entry) => entry.node);

      if (candidateVerses.length === 0) {
        setBasketRangeMessage(
          `No direct verses found in this section for range ${parsedStart}-${parsedEnd}.`
        );
        return;
      }

      if (candidateVerses.length > 250) {
        setBasketRangeMessage("Range is too large. Please use a smaller span (max 250 verses).");
        return;
      }

      setBasketRangeSubmitting(true);
      setBasketRangeMessage(null);

      let addedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;
      const basketNodeIds = new Set(basketItems.map((item) => item.node_id));

      try {
        for (const verseNode of candidateVerses) {
          if (basketNodeIds.has(verseNode.id)) {
            skippedCount += 1;
            continue;
          }

          const isLeaf = !verseNode.children || verseNode.children.length === 0;
          const sequenceDisplay =
            formatSequenceDisplay(verseNode.sequence_number || verseNode.id, isLeaf) || verseNode.id;
          const levelLabel = formatValue(verseNode.level_name) || "Level";
          const titleLabel = getNodeBreadcrumbLabel(verseNode).trim();
          const title = titleLabel || `${levelLabel} ${sequenceDisplay}`;
          const fullPath = findPath(treeData, verseNode.id) || breadcrumb;
          const breadcrumbPathParts = fullPath.map((node, index) => {
            const canonicalLevel = getSchemaMatchedLevelName(
              formatValue(node.level_name) || "",
              typeof node.level_order === "number" ? node.level_order : null
            );
            const levelRaw = canonicalLevel || formatValue(node.level_name) || "Level";
            const levelDisplay = levelRaw
              .toString()
              .replace(/_/g, " ")
              .toLowerCase()
              .replace(/\b\w/g, (char) => char.toUpperCase());
            const pathIsLeaf = index === fullPath.length - 1;
            const seq = formatSequenceDisplay(node.sequence_number || node.id, pathIsLeaf);
            const levelWithSeq = seq ? `${levelDisplay} ${seq}` : levelDisplay;
            const preferred = getNodeBreadcrumbLabel(node).trim();
            const normalizedPreferred = preferred.toLowerCase();
            const normalizedLevelWithSeq = levelWithSeq.toLowerCase();
            const preferredHasSameSeq = Boolean(seq) && normalizedPreferred.includes(seq.toString());
            const levelHasSameSeq = Boolean(seq) && normalizedLevelWithSeq.includes(seq.toString());

            if (!preferred) return levelWithSeq;
            if (normalizedPreferred === levelDisplay.toLowerCase()) return levelWithSeq;
            if (normalizedPreferred === normalizedLevelWithSeq) return preferred;
            if (preferredHasSameSeq && levelHasSameSeq) return preferred;
            return `${preferred}: ${levelWithSeq}`;
          });
          const breadcrumbParts = [currentBook?.book_name, ...breadcrumbPathParts].filter(
            (part): part is string => Boolean(part && part.trim())
          );
          const breadcrumbText = breadcrumbParts.length > 0 ? breadcrumbParts.join(" / ") : undefined;

          const response = await fetch("/api/cart/items", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              item_id: verseNode.id,
              item_type: "library_node",
              metadata: {
                title,
                breadcrumb: breadcrumbText,
                book_name: currentBook?.book_name,
                level_name: verseNode.level_name,
              },
            }),
          });

          if (response.status === 409) {
            skippedCount += 1;
            basketNodeIds.add(verseNode.id);
            continue;
          }

          if (!response.ok) {
            failedCount += 1;
            continue;
          }

          addedCount += 1;
          basketNodeIds.add(verseNode.id);
        }

        await loadBasket();
        const summaryParts = [
          `${addedCount} added`,
          `${skippedCount} skipped`,
          `${failedCount} failed`,
        ];
        setBasketRangeMessage(`Range ${parsedStart}-${parsedEnd}: ${summaryParts.join(", ")}.`);
      } catch {
        setBasketRangeMessage("Could not add range to basket. Please try again.");
      } finally {
        setBasketRangeSubmitting(false);
      }
    })();
  };

  const addPreviewBlockToBasket = useCallback(
    (nodeId: number, block: BookPreviewBlock) => {
      if (!authEmail) return;
      if (basketItems.some((item) => item.node_id === nodeId)) return;
      cancelledPreviewBasketAddsRef.current.delete(nodeId);

      const seq =
        formatSequenceDisplay(block.content.sequence_number ?? nodeId, true) || nodeId;
      const levelLabel = formatValue(block.content.level_name) || "Level";
      const title = block.title || `${levelLabel} ${seq}`;
      const contentPreview =
        (block.content.translations?.english) ||
        (typeof block.content.english === "string" ? block.content.english : undefined) ||
        (typeof block.content.transliteration === "string" ? block.content.transliteration : undefined) ||
        (typeof block.content.sanskrit === "string" ? block.content.sanskrit : undefined) ||
        undefined;
      const breadcrumbParts = [
        currentBook?.book_name,
        ...breadcrumb.map((n) => getNodeBreadcrumbLabel(n)),
      ].filter((p): p is string => Boolean(p?.trim()));
      const breadcrumbText = breadcrumbParts.length > 0 ? breadcrumbParts.join(" / ") : undefined;

      // Optimistically mark as added so the basket icon remains visible immediately.
      setBasketItems((prev) => {
        if (prev.some((item) => item.node_id === nodeId)) {
          return prev;
        }
        const nextOrder = prev.reduce((maxOrder, item) => Math.max(maxOrder, item.order), 0) + 1;
        return [
          ...prev,
          {
            node_id: nodeId,
            title,
            content: contentPreview,
            breadcrumb: breadcrumbText,
            book_name: currentBook?.book_name,
            level_name: block.content.level_name,
            order: nextOrder,
          },
        ].sort((a, b) => a.order - b.order);
      });

      void (async () => {
        try {
          const response = await fetch("/api/cart/items", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              item_id: nodeId,
              item_type: "library_node",
              metadata: {
                title,
                content: contentPreview,
                breadcrumb: breadcrumbText,
                book_name: currentBook?.book_name,
                level_name: block.content.level_name,
              },
            }),
          });

          if (response.status === 409) {
            await loadBasket();
            return;
          }
          if (!response.ok) {
            setBasketItems((prev) =>
              prev.filter((item) => !(item.node_id === nodeId && !item.cart_item_id))
            );
            setPreviewBasketUiOverrides((prev) => ({ ...prev, [nodeId]: false }));
            return;
          }

          const item = (await response.json()) as {
            id: number;
            item_id: number;
            order: number;
            metadata?: {
              title?: string;
              content?: string;
              breadcrumb?: string;
              book_name?: string;
              level_name?: string;
            };
          };

          if (cancelledPreviewBasketAddsRef.current.has(item.item_id)) {
            cancelledPreviewBasketAddsRef.current.delete(item.item_id);
            setBasketItems((prev) =>
              prev.filter((candidate) => !(candidate.node_id === item.item_id && !candidate.cart_item_id))
            );
            try {
              await fetch(`/api/cart/items/${item.id}`, {
                method: "DELETE",
                credentials: "include",
              });
            } catch {
              // ignore cleanup failures
            }
            return;
          }

          setBasketItems((prev) => {
            const filtered = prev.filter((candidate) => candidate.node_id !== item.item_id);
            return [
              ...filtered,
              {
                cart_item_id: item.id,
                node_id: item.item_id,
                title: item.metadata?.title || title,
                content: item.metadata?.content || contentPreview,
                breadcrumb: item.metadata?.breadcrumb || breadcrumbText,
                book_name: item.metadata?.book_name || currentBook?.book_name,
                level_name: item.metadata?.level_name || block.content.level_name,
                order: item.order,
              },
            ].sort((a, b) => a.order - b.order);
          });
        } catch {
          setBasketItems((prev) =>
            prev.filter((item) => !(item.node_id === nodeId && !item.cart_item_id))
          );
          setPreviewBasketUiOverrides((prev) => ({ ...prev, [nodeId]: false }));
        }
      })();
    },
    [authEmail, basketItems, breadcrumb, currentBook, loadBasket, setBasketItems]
  );

  const addPreviewRangeToBasket = () => {
    if (!authEmail || !bookPreviewArtifact) return;

    void (async () => {
      const parsedStart = Number.parseInt(basketRangeStart.trim(), 10);
      const parsedEnd = Number.parseInt(basketRangeEnd.trim(), 10);

      if (!Number.isFinite(parsedStart) || !Number.isFinite(parsedEnd)) {
        setBasketRangeMessage("Enter valid start and end verse numbers.");
        return;
      }
      if (parsedStart <= 0 || parsedEnd <= 0) {
        setBasketRangeMessage("Verse numbers must be positive.");
        return;
      }
      if (parsedStart > parsedEnd) {
        setBasketRangeMessage("Start verse must be less than or equal to end verse.");
        return;
      }

      const candidateBlocks = bookPreviewArtifact.sections.body.filter((block) => {
        if (!block.source_node_id) return false;
        const seq = parseSequenceNumber(block.content.sequence_number);
        return seq !== null && seq >= parsedStart && seq <= parsedEnd;
      });

      if (candidateBlocks.length === 0) {
        setBasketRangeMessage(
          `No verses found in preview for range ${parsedStart}-${parsedEnd}.`
        );
        return;
      }
      if (candidateBlocks.length > 250) {
        setBasketRangeMessage("Range is too large. Please use a smaller span (max 250 verses).");
        return;
      }

      setBasketRangeSubmitting(true);
      setBasketRangeMessage(null);

      let addedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;
      const basketNodeIds = new Set(basketItems.map((item) => item.node_id));

      try {
        for (const block of candidateBlocks) {
          const nodeId = block.source_node_id!;
          if (basketNodeIds.has(nodeId)) {
            skippedCount += 1;
            continue;
          }
          const seq =
            formatSequenceDisplay(block.content.sequence_number ?? nodeId, true) || nodeId;
          const levelLabel = formatValue(block.content.level_name) || "Level";
          const title = block.title || `${levelLabel} ${seq}`;
          const contentPreview =
            block.content.translations?.english ||
            (typeof block.content.english === "string" ? block.content.english : undefined) ||
            (typeof block.content.transliteration === "string" ? block.content.transliteration : undefined) ||
            (typeof block.content.sanskrit === "string" ? block.content.sanskrit : undefined) ||
            undefined;
          const breadcrumbParts = [
            currentBook?.book_name,
            ...breadcrumb.map((n) => getNodeBreadcrumbLabel(n)),
          ].filter((p): p is string => Boolean(p?.trim()));
          const breadcrumbText =
            breadcrumbParts.length > 0 ? breadcrumbParts.join(" / ") : undefined;

          const response = await fetch("/api/cart/items", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              item_id: nodeId,
              item_type: "library_node",
              metadata: {
                title,
                content: contentPreview,
                breadcrumb: breadcrumbText,
                book_name: currentBook?.book_name,
                level_name: block.content.level_name,
              },
            }),
          });

          if (response.status === 409) {
            skippedCount += 1;
            basketNodeIds.add(nodeId);
            continue;
          }
          if (!response.ok) {
            failedCount += 1;
            continue;
          }
          addedCount += 1;
          basketNodeIds.add(nodeId);
        }

        await loadBasket();
        setBasketRangeMessage(
          `Range ${parsedStart}-${parsedEnd}: ${addedCount} added, ${skippedCount} skipped, ${failedCount} failed.`
        );
      } catch {
        setBasketRangeMessage("Could not add range to basket. Please try again.");
      } finally {
        setBasketRangeSubmitting(false);
      }
    })();
  };

  const removeFromBasket = (item: BasketItem) => {
    const removeMatches = (candidate: BasketItem): boolean => {
      if (item.cart_item_id && candidate.cart_item_id) {
        return candidate.cart_item_id === item.cart_item_id;
      }
      return candidate.node_id === item.node_id && candidate.order === item.order;
    };

    // Optimistically hide/remove immediately so inactive-node taps reflect state instantly.
    setBasketItems((prev) => prev.filter((candidate) => !removeMatches(candidate)));

    void (async () => {
      if (!item.cart_item_id) {
        // If this is an optimistic preview add, cancel the in-flight create.
        cancelledPreviewBasketAddsRef.current.add(item.node_id);
        return;
      }

      cancelledPreviewBasketAddsRef.current.delete(item.node_id);

      try {
        const response = await fetch(`/api/cart/items/${item.cart_item_id}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (!response.ok && response.status !== 404) {
          // Roll back optimistic remove if delete failed server-side.
          setBasketItems((prev) => {
            if (prev.some((candidate) => removeMatches(candidate))) {
              return prev;
            }
            return [...prev, item].sort((a, b) => a.order - b.order);
          });
          return;
        }
      } catch {
        // Roll back optimistic remove on request failure.
        setBasketItems((prev) => {
          if (prev.some((candidate) => removeMatches(candidate))) {
            return prev;
          }
          return [...prev, item].sort((a, b) => a.order - b.order);
        });
      }
    })();
  };

  const removePreviewNodeFromBasket = useCallback(
    (nodeId: number) => {
      const matchingItems = basketItems.filter((item) => item.node_id === nodeId);
      if (matchingItems.length === 0) {
        return;
      }

      // Ensure any in-flight optimistic add for this node cannot re-appear.
      cancelledPreviewBasketAddsRef.current.add(nodeId);

      // Remove all node duplicates immediately so inactive-node toggle reflects instantly.
      setBasketItems((prev) => prev.filter((item) => item.node_id !== nodeId));

      const cartItemIds = matchingItems
        .map((item) => item.cart_item_id)
        .filter((id): id is number => typeof id === "number");
      if (cartItemIds.length === 0) {
        return;
      }

      void (async () => {
        let shouldReload = false;
        try {
          for (const cartItemId of cartItemIds) {
            const response = await fetch(`/api/cart/items/${cartItemId}`, {
              method: "DELETE",
              credentials: "include",
            });
            if (!response.ok && response.status !== 404) {
              shouldReload = true;
            }
          }
        } catch {
          shouldReload = true;
        } finally {
          cancelledPreviewBasketAddsRef.current.delete(nodeId);
          if (shouldReload) {
            await loadBasket();
            setPreviewBasketUiOverrides((prev) => {
              if (!(nodeId in prev)) {
                return prev;
              }
              const next = { ...prev };
              delete next[nodeId];
              return next;
            });
          }
        }
      })();
    },
    [basketItems, loadBasket]
  );

  const moveBasketItem = (item: BasketItem, direction: "up" | "down") => {
    void (async () => {
      if (isReorderingBasket) return;

      setIsReorderingBasket(true);
      const current = [...basketItems].sort((a, b) => a.order - b.order);
      const index = current.findIndex((candidate) => {
        if (item.cart_item_id && candidate.cart_item_id) {
          return candidate.cart_item_id === item.cart_item_id;
        }
        return candidate.node_id === item.node_id && candidate.order === item.order;
      });
      if (index === -1) {
        setIsReorderingBasket(false);
        return;
      }

      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.length) {
        setIsReorderingBasket(false);
        return;
      }

      const [moved] = current.splice(index, 1);
      current.splice(targetIndex, 0, moved);

      const reordered = current.map((item, idx) => ({ ...item, order: idx }));
      setBasketItems(reordered);

      const itemOrder = reordered
        .map((item) => item.cart_item_id)
        .filter((id): id is number => typeof id === "number");

      if (itemOrder.length !== reordered.length) {
        await loadBasket();
        return;
      }

      try {
        const response = await fetch("/api/cart/items/reorder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ item_order: itemOrder }),
        });

        if (!response.ok) {
          await loadBasket();
        }
      } catch {
        await loadBasket();
      } finally {
        setIsReorderingBasket(false);
      }
    })();
  };

  const clearBasket = () => {
    void (async () => {
      try {
        await fetch("/api/cart/me", {
          method: "DELETE",
          credentials: "include",
        });
      } finally {
        setBasketItems([]);
      }
    })();
  };

  return {
    basketItems,
    setBasketItems,
    basketRangeStart,
    setBasketRangeStart,
    basketRangeEnd,
    setBasketRangeEnd,
    basketRangeSubmitting,
    basketRangeMessage,
    setBasketRangeMessage,
    isReorderingBasket,
    loadBasket,
    addCurrentToBasket,
    addSelectedRangeToBasket,
    addPreviewBlockToBasket,
    addPreviewRangeToBasket,
    removeFromBasket,
    removePreviewNodeFromBasket,
    moveBasketItem,
    clearBasket,
  };
}
