-- Make the self-referential parent_node_id FK on content_nodes DEFERRABLE so the
-- constraint is checked at COMMIT time rather than per-row.  Without this,
-- a single "DELETE FROM content_nodes WHERE book_id = X" triggers O(n²)
-- constraint checks — ~199 s for 11,675 nodes (Rigveda).  With DEFERRABLE the
-- whole batch is validated once at the end of the transaction, dropping the
-- delete to well under 1 s.

ALTER TABLE content_nodes
    DROP CONSTRAINT content_nodes_parent_node_id_fkey,
    ADD CONSTRAINT content_nodes_parent_node_id_fkey
        FOREIGN KEY (parent_node_id)
        REFERENCES content_nodes(id)
        ON DELETE CASCADE
        DEFERRABLE INITIALLY DEFERRED;

-- Add missing index on referenced_node_id so DELETE FROM content_nodes
-- does not do a full table scan per row to check the self-referential
-- referenced_node_id FK (the actual O(n²) bottleneck).
CREATE INDEX IF NOT EXISTS idx_content_nodes_referenced_node_id
    ON content_nodes(referenced_node_id);
