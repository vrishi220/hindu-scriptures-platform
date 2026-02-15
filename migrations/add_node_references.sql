-- Add referenced_node_id to support content references
-- When a node is a reference, it points to the original node's content
-- This allows books to reference verses/chapters from other books without copying

ALTER TABLE content_nodes 
ADD COLUMN IF NOT EXISTS referenced_node_id INTEGER REFERENCES content_nodes(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_content_nodes_referenced ON content_nodes(referenced_node_id);

-- Add comment for documentation
COMMENT ON COLUMN content_nodes.referenced_node_id IS 
'Reference to another node. When set, this node is a reference/link to the original, displaying its content dynamically.';
