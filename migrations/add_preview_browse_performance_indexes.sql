CREATE INDEX IF NOT EXISTS idx_compilations_public_published_created_at
ON compilations(created_at DESC)
WHERE is_public = true AND status = 'published';

CREATE INDEX IF NOT EXISTS idx_content_nodes_book_parent
ON content_nodes(book_id, parent_node_id);

CREATE INDEX IF NOT EXISTS idx_content_nodes_book_level_order_id
ON content_nodes(book_id, level_order, id);

CREATE INDEX IF NOT EXISTS idx_media_files_node_id
ON media_files(node_id);