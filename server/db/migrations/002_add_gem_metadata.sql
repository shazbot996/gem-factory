-- Add fields captured by the Chrome extension v0.9.7+:
-- description, knowledge files, default tools, Gemini gem ID, extracted timestamp

ALTER TABLE gems ADD COLUMN description TEXT;
ALTER TABLE gems ADD COLUMN gemini_id TEXT;
ALTER TABLE gems ADD COLUMN knowledge_files JSONB DEFAULT '[]'::jsonb;
ALTER TABLE gems ADD COLUMN default_tools TEXT[] DEFAULT '{}';
ALTER TABLE gems ADD COLUMN extracted_at TIMESTAMPTZ;

-- Update search vector to include description (weight B, same as instructions)
-- Must drop and recreate because GENERATED ALWAYS columns can't be ALTERed
ALTER TABLE gems DROP COLUMN search_vector;
ALTER TABLE gems ADD COLUMN search_vector TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(instructions, '')), 'B')
) STORED;

-- Recreate the GIN index on the new search vector
DROP INDEX IF EXISTS idx_gems_search;
CREATE INDEX idx_gems_search ON gems USING GIN(search_vector);
