// One-pass index over a node tree. Lets the verse viewer answer "what's the
// parent of node X?", "is Y an ancestor of X?", "what's the next leaf after
// X?", and "how many leaves does subtree X contain?" in O(1) instead of
// re-walking the tree on every render.

export type TreeNodeShape = {
  id: number;
  children?: TreeNodeShape[] | null | undefined;
};

export type TreeIndexEntry<T extends TreeNodeShape> = {
  node: T;
  parentId: number | null;
  depth: number;
  isLeaf: boolean;
  leafIndex: number; // -1 if not a leaf
  firstLeafId: number; // own id when isLeaf
  leafCount: number; // 1 when isLeaf, else total leaves in subtree
};

export type TreeIndex<T extends TreeNodeShape> = {
  entries: Map<number, TreeIndexEntry<T>>;
  leaves: T[];
  rootIds: number[];
};

export function buildTreeIndex<T extends TreeNodeShape>(
  roots: T[]
): TreeIndex<T> {
  const entries = new Map<number, TreeIndexEntry<T>>();
  const leaves: T[] = [];

  function visit(
    node: T,
    parentId: number | null,
    depth: number
  ): { firstLeafId: number; leafCount: number } {
    const children = (node.children ?? []) as T[];
    if (children.length === 0) {
      const leafIndex = leaves.length;
      leaves.push(node);
      entries.set(node.id, {
        node,
        parentId,
        depth,
        isLeaf: true,
        leafIndex,
        firstLeafId: node.id,
        leafCount: 1,
      });
      return { firstLeafId: node.id, leafCount: 1 };
    }

    let firstLeafId = -1;
    let leafCount = 0;
    for (const child of children) {
      const r = visit(child, node.id, depth + 1);
      if (firstLeafId === -1) firstLeafId = r.firstLeafId;
      leafCount += r.leafCount;
    }
    entries.set(node.id, {
      node,
      parentId,
      depth,
      isLeaf: false,
      leafIndex: -1,
      firstLeafId,
      leafCount,
    });
    return { firstLeafId, leafCount };
  }

  for (const root of roots) visit(root, null, 0);

  return { entries, leaves, rootIds: roots.map((r) => r.id) };
}

export function getAncestorSet<T extends TreeNodeShape>(
  index: TreeIndex<T>,
  id: number | null
): Set<number> {
  const set = new Set<number>();
  let current = id;
  while (current !== null && current !== undefined) {
    set.add(current);
    current = index.entries.get(current)?.parentId ?? null;
  }
  return set;
}

export function getPath<T extends TreeNodeShape>(
  index: TreeIndex<T>,
  id: number
): T[] {
  const path: T[] = [];
  let current: number | null = id;
  while (current !== null) {
    const entry = index.entries.get(current);
    if (!entry) break;
    path.unshift(entry.node);
    current = entry.parentId;
  }
  return path;
}
