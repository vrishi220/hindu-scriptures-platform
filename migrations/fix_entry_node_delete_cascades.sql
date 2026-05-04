ALTER TABLE word_meaning_entries
DROP CONSTRAINT IF EXISTS word_meaning_entries_node_id_fkey,
ADD CONSTRAINT word_meaning_entries_node_id_fkey
FOREIGN KEY (node_id) REFERENCES content_nodes(id)
ON DELETE CASCADE;

ALTER TABLE commentary_entries
DROP CONSTRAINT IF EXISTS commentary_entries_node_id_fkey,
ADD CONSTRAINT commentary_entries_node_id_fkey
FOREIGN KEY (node_id) REFERENCES content_nodes(id)
ON DELETE CASCADE;

ALTER TABLE translation_entries
DROP CONSTRAINT IF EXISTS translation_entries_node_id_fkey,
ADD CONSTRAINT translation_entries_node_id_fkey
FOREIGN KEY (node_id) REFERENCES content_nodes(id)
ON DELETE CASCADE;
