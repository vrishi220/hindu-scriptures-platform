CREATE INDEX IF NOT EXISTS idx_provenance_source_node_id
ON provenance_records(source_node_id);

CREATE INDEX IF NOT EXISTS idx_contributions_node_id
ON contributions(node_id);

CREATE INDEX IF NOT EXISTS idx_collection_items_node_id
ON collection_items(node_id);