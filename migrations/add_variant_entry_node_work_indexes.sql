CREATE INDEX IF NOT EXISTS idx_commentary_entries_node_work
ON commentary_entries(node_id, work_id);

CREATE INDEX IF NOT EXISTS idx_translation_entries_node_work
ON translation_entries(node_id, work_id);
