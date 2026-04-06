-- Users who have imported gems
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT UNIQUE NOT NULL,
    display_name    TEXT,
    first_import_at TIMESTAMPTZ,
    last_import_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- Gem configurations
CREATE TABLE gems (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID REFERENCES users(id) NOT NULL,
    name            TEXT NOT NULL,
    instructions    TEXT NOT NULL,
    icon            TEXT,
    source          TEXT NOT NULL DEFAULT 'extension',
    instruction_hash TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'imported',
    imported_at     TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    search_vector   TSVECTOR GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(instructions, '')), 'B')
    ) STORED
);

CREATE INDEX idx_gems_owner ON gems(owner_id);
CREATE INDEX idx_gems_hash ON gems(instruction_hash);
CREATE INDEX idx_gems_search ON gems USING GIN(search_vector);
CREATE UNIQUE INDEX idx_gems_owner_hash ON gems(owner_id, instruction_hash);

-- Duplicate clusters (schema created for future use — no runtime logic in Phase 1)
CREATE TABLE duplicate_clusters (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    representative_gem_id UUID REFERENCES gems(id),
    gem_count             INT DEFAULT 0,
    created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE duplicate_cluster_members (
    cluster_id       UUID REFERENCES duplicate_clusters(id),
    gem_id           UUID REFERENCES gems(id),
    similarity_score FLOAT,
    PRIMARY KEY (cluster_id, gem_id)
);
