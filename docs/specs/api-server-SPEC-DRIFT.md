---
type: drift-report
source: "docs/specs/api-server-SPEC.md"
date: 2026-04-15
---

# API Server Spec — Drift Report

## Summary

The spec is **moderately drifted** — roughly 65% accurate. The core API design (endpoints, auth, ingestion pipeline, search) was implemented faithfully, but the infrastructure layer diverged significantly: PostgreSQL is external rather than Docker-managed, the Docker Compose file defines only one service instead of two, and the Makefile still uses `.db-config` as the primary database configuration mechanism rather than being superseded by Compose. Several planned files were never created (`services/similarity.js`, `db/clusters.js`), and a second migration (`002_add_gem_metadata.sql`) was added to support gem metadata fields (description, geminiId, knowledgeFiles, defaultTools, extractedAt) that the spec did not anticipate. The SPA is now built and serving, making the "deferred" static file serving section stale.

## Accurate

- **Section 1 (Problem Statement):** Still correct in motivation and framing.
- **Section 2 (Goals):** All stated goals are met. Non-goals remain accurate.
- **Section 3 (Proposed Solution):** Express choice, single-service architecture, layered monolith — all correct. Key workflow description is accurate.
- **Section 4.1 (Directory Structure):** Core structure is correct: `server.js`, `middleware/auth.js`, `routes/gems.js`, `routes/users.js`, `routes/stats.js`, `services/ingestion.js`, `services/search.js`, `db/pool.js`, `db/migrate.js`, `db/gems.js`, `db/users.js`, `db/migrations/001_initial_schema.sql` all exist at the documented paths.
- **Section 4.1.2 (Dockerfile):** Exactly matches the actual file.
- **Section 4.2 (Authentication):** Fully accurate — Bearer token extraction, `verifyIdToken()`, `hd` claim check, dev bypass with `X-Dev-User-Email`, 401/403 responses all implemented as specified.
- **Section 4.3 (Import Pipeline):** Normalization (trim, collapse blank lines, normalize line endings), SHA-256 hashing, `ON CONFLICT (owner_id, instruction_hash)` dedup — all implemented as specified in `services/ingestion.js` and `db/gems.js`.
- **Section 4.4 (Registry Endpoints):** `GET /api/gems` with q, owner, status, page, limit parameters — implemented. `GET /api/gems/:id` — implemented. `PATCH /api/gems/:id` — implemented with owner/admin authorization. `DELETE /api/gems/:id` — implemented as hard delete.
- **Section 4.5 (User Endpoints):** `GET /api/users/me` and `GET /api/users` — implemented as specified.
- **Section 4.6 (Statistics):** `GET /api/stats` — implemented, returns totalGems, uniqueGems, totalUsers, duplicateClusters (hardcoded 0), topClusters (hardcoded []).
- **Section 4.7 (Migration Runner):** Custom runner with `schema_migrations` table, reads `.sql` files sorted by prefix, applies in transaction, runs on startup — all correct.
- **Section 4.8 (Database Connection):** `db/pool.js` reads `DATABASE_URL` — correct.
- **Section 5 (UI/UX):** Accurate that no direct UI is in the server spec.
- **Section 6.1 (Extension → SPA → API):** Integration flow is correct.
- **Section 6.3 (Google Cloud Identity):** Correct — server only validates tokens.
- **Section 7.1 (Import Edge Cases):** Max 100 gems, 100KB instruction limit, ON CONFLICT dedup — all implemented.
- **Section 7.2 (Auth Edge Cases):** 401 for missing/invalid tokens, 403 for wrong domain, auto-create user — all correct.
- **Section 10 (Open Questions):** Q1 (Express), Q3 (exact hash only), Q4 (hard delete), Q5 (ADMIN_EMAILS env var) — all resolved as recommended.

## Stale

### S1: Docker Compose has no PostgreSQL service (Major)

**What the document says (Section 4.1.1):** Docker Compose defines two services — `db` (postgres:16-alpine on port 5432 with healthcheck and named volume) and `api`. The full YAML block shows both services including `gem_factory_pgdata` volume.

**What the code actually does:** `docker-compose.yml` defines a single `api` service. There is no `db` service, no PostgreSQL container, no `gem_factory_pgdata` volume, no healthcheck, and no `depends_on`. The database runs on a separate external server (e.g., `branch.local`), configured via `.db-config` and the Makefile.

### S2: DATABASE_URL is constructed by Makefile, not hardcoded in Compose (Major)

**What the document says (Section 4.1.1):** `DATABASE_URL` is set to `postgresql://gem_factory:gem_factory_dev@db:5432/gem_factory` in the Compose file, pointing to the internal `db` service.

**What the code actually does:** `docker-compose.yml` line 8 uses `DATABASE_URL: "${DATABASE_URL}"`, which is a passthrough from the host environment. The Makefile `api-start` target (line 92-93) sources `.db-config` and constructs `DATABASE_URL` dynamically: `postgresql://$$DB_USER:$$DB_PASS@$$DB_HOST:$$DB_PORT/$$DB_NAME`.

### S3: make api-start requires .db-config, not replaced by Compose (Major)

**What the document says (Section 4.1.3, 4.1.4):** `make api-start` simply runs `docker compose up -d --build`. Section 4.1.4 states the Compose setup "supersedes `make db-init` for API development."

**What the code actually does:** `make api-start` (Makefile line 87-99) first checks that `.db-config` exists (`if [ ! -f $(DB_CONFIG) ]`), sources it, constructs `DATABASE_URL`, then runs `docker compose up -d --build`. The `db-init`/`.db-config` workflow is still the primary database configuration mechanism, not superseded.

### S4: ADMIN_EMAILS env var not documented in Compose or env table (Moderate)

**What the document says (Section 4.1.1, 6.4):** The Compose environment lists `PORT`, `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `ALLOWED_DOMAIN`, `NODE_ENV`. The environment variables table in section 6.4 lists `PORT`, `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `ALLOWED_DOMAIN`, `SIMILARITY_THRESHOLD`, `NODE_ENV`.

**What the code actually does:** `docker-compose.yml` line 11 also passes `ADMIN_EMAILS: "${ADMIN_EMAILS:-charles.schiele@gmail.com}"`. The `middleware/admin.js` file reads this variable. It is not mentioned in the spec's Compose config or environment variable table.

### S5: admin.js middleware not documented (Moderate)

**What the document says (Section 4.1):** The directory structure lists only `middleware/auth.js`.

**What the code actually does:** `server/middleware/admin.js` exists and exports `isAdmin(email)` and `requireAdmin` middleware. It is used in `routes/gems.js` for PATCH (status changes) and DELETE authorization. The spec's section on PATCH mentions "admin only" for status but doesn't describe how admin is determined in the middleware layer.

### S6: Import response shape differs (Moderate)

**What the document says (Section 4.3):** Import returns `{ imported: N, skipped: N, duplicates: N }`.

**What the code actually does:** `routes/gems.js` returns `{ imported, updated, skipped, importedIds }`. There is no `duplicates` field. There is an `updated` field (for upserted existing gems) and `importedIds` array that the spec doesn't mention.

### S7: Upsert behavior differs from spec's skip-only dedup (Moderate)

**What the document says (Section 4.3, step 3c-d):** Same-user duplicates are "skipped" via `ON CONFLICT ... DO NOTHING`.

**What the code actually does:** `db/gems.js` uses `ON CONFLICT (owner_id, instruction_hash) DO UPDATE` — it updates name, description, icon, gemini_id, knowledge_files, default_tools, extracted_at, and updated_at. The `(xmax = 0) AS inserted` check distinguishes inserts from updates. This is an upsert, not a skip.

### S8: PATCH updatable fields differ (Minor)

**What the document says (Section 4.4):** Updatable fields are `name`, `icon`, `status` (admin only).

**What the code actually does:** `db/gems.js` update function whitelists `name`, `description`, `icon`, `status`. The `description` field is updatable but not mentioned in the spec.

### S9: services/similarity.js and db/clusters.js never created (Moderate)

**What the document says (Section 4.1):** Directory structure lists `services/similarity.js` ("Near-duplicate detection") and (implicitly through clustering milestones) `db/clusters.js`.

**What the code actually does:** Neither file exists. Duplicate clustering is fully deferred — `stats.js` hardcodes `duplicateClusters: 0` and `topClusters: []`, and `formatGem()` in `routes/gems.js` hardcodes `duplicateCluster: null`.

### S10: No cross-user duplicate cluster logic implemented (Moderate)

**What the document says (Section 4.3, step 3e):** "If the hash matches an existing gem from another user, add both to a duplicate cluster." Milestone 5 covers this.

**What the code actually does:** No cluster creation or update logic exists. The `duplicate_clusters` and `duplicate_cluster_members` tables exist in the schema but are never written to.

### S11: Second migration not documented (Minor)

**What the document says (Section 4.7):** References only `001_initial_schema.sql`.

**What the code actually does:** `002_add_gem_metadata.sql` exists and adds five columns to the gems table: `description`, `gemini_id`, `knowledge_files` (JSONB), `default_tools` (TEXT[]), `extracted_at` (TIMESTAMPTZ). It also recreates the search_vector to include description.

### S12: Gem response shape has additional fields (Moderate)

**What the document says (Section 4.4):** Gem response includes id, name, instructions, icon, source, status, owner, importedAt, duplicateCluster.

**What the code actually does:** `formatGem()` in `routes/gems.js` returns additional fields: `description`, `geminiId`, `knowledgeFiles`, `defaultTools`, `updatedAt`, `extractedAt`. These were added with the second migration.

### S13: SIMILARITY_THRESHOLD env var does not exist (Minor)

**What the document says (Section 6.4):** Lists `SIMILARITY_THRESHOLD` (default 0.85) as an environment variable.

**What the code actually does:** This variable is not read anywhere in the codebase. Near-duplicate detection was not implemented.

### S14: SPA static file serving is no longer deferred (Minor)

**What the document says (Section 4.9):** "Deferred until the SPA is built. For now, the server only exposes `/api/*` routes."

**What the code actually does:** `server.js` lines 45-55 serve static files from `public/` and implement SPA fallback (all non-API GET routes serve `index.html`). The SPA is built and deployed to `server/public/`.

### S15: `GET /` behavior differs (Minor)

**What the document says (Section 4.9):** `GET /` returns `{ "service": "gem-factory", "status": "ok" }`.

**What the code actually does:** If `public/` directory exists with `index.html`, it serves the SPA. Otherwise it returns `{ service: 'gem-factory-api', version: '0.1.0' }` — different field values than spec.

### S16: No database retry/backoff on startup (Minor)

**What the document says (Section 7.3):** "Database unreachable on startup — Retry connection with exponential backoff (3 attempts), then exit with error."

**What the code actually does:** `server.js` calls `migrate(pool)` on startup and if it fails, logs the error and calls `process.exit(1)` immediately — no retry logic.

### S17: No SELECT FOR UPDATE or advisory locks for cluster updates (Minor)

**What the document says (Section 7.4):** "Duplicate cluster updates use a `SELECT ... FOR UPDATE` or advisory lock."

**What the code actually does:** No cluster update logic exists at all, so no locking is needed or implemented.

### S18: Extension version reference outdated (Minor)

**What the document says (Section 3):** "User extracts gems via the Chrome extension (already built, v0.3.0)."

**What the code actually does:** Extension is at v0.10.0 per `extension/manifest.json`.

### S19: Additional Makefile targets not in spec (Minor)

**What the document says (Section 4.1.3):** Only `api-start` and `api-stop` described.

**What the code actually does:** Makefile also has `api-test`, `api-logs`, `spa-install`, `spa-dev`, `spa-build` targets.

### S20: Import payload accepts additional fields (Minor)

**What the document says (Section 4.3):** Payload is `{ gems: [{ name, instructions, icon?, source? }] }`.

**What the code actually does:** `routes/gems.js` and `services/ingestion.js` also accept `description`, `geminiId`, `knowledgeFiles`, `defaultTools`, `extractedAt` per gem.

### S21: cluster_id query param not implemented (Minor)

**What the document says (Section 4.4):** `GET /api/gems` supports `cluster_id` query parameter.

**What the code actually does:** `db/gems.js` list function handles `q`, `owner`, `status`, `page`, `limit` — no `cluster_id` filter.

### S22: search.js is unused (Minor)

**What the document says (Section 4.1):** `services/search.js` is the "Full-text search query builder."

**What the code actually does:** `search.js` exports `buildSearchClause()` but it is not imported or used anywhere. The search logic is implemented inline in `db/gems.js`.

## Missing

### M1: `middleware/admin.js` module
Exists at `server/middleware/admin.js`. Exports `isAdmin(email)` function and `requireAdmin` middleware. Reads `ADMIN_EMAILS` env var (default: `charles.schiele@gmail.com`). Used by `routes/gems.js` for PATCH and DELETE authorization. Not documented in the spec's directory structure or design sections.

### M2: `002_add_gem_metadata.sql` migration
Adds `description`, `gemini_id`, `knowledge_files` (JSONB), `default_tools` (TEXT[]), `extracted_at` columns to the gems table. Recreates the search_vector to include description at weight B. Not documented in the spec.

### M3: Gem metadata fields throughout the stack
The gem model now includes description, geminiId, knowledgeFiles, defaultTools, and extractedAt. These flow through import payload → ingestion service → database → API responses. The spec's data model predates these additions.

### M4: CORS middleware
`server.js` lines 20-31 implement CORS allowing `localhost:3000`, `localhost:5173`, and `chrome-extension://` origins. Not mentioned in the spec.

### M5: SPA fallback serving
`server.js` lines 45-55 serve static files from `public/` and implement SPA fallback routing. The SPA is built and functional. The spec marked this as deferred.

### M6: Test files
`server/test/` contains `api.test.js`, `auth.test.js`, `ingestion.test.js` using Node.js built-in test runner. Not documented in the spec.

### M7: `ADMIN_EMAILS` in Docker Compose
`docker-compose.yml` line 11 passes `ADMIN_EMAILS` with a default value. Not present in the spec's Compose configuration or environment variable table.

### M8: Global error handler
`server.js` has a global Express error handler middleware. Not documented in the spec's error handling section.

## Recommendations

### Priority 1 — Infrastructure section rewrite (High impact, paragraph rewrite)

Rewrite sections 4.1.1 (Docker Compose), 4.1.3 (Makefile), and 4.1.4 (relationship to db-init). The fundamental premise — that Compose manages its own PostgreSQL — is wrong. The actual architecture uses an external database configured via `.db-config` with the Makefile constructing `DATABASE_URL`. This is the single largest source of inaccuracy in the spec.

### Priority 2 — Add gem metadata fields (High impact, new subsection + updates across sections)

Add documentation for the five metadata columns (description, geminiId, knowledgeFiles, defaultTools, extractedAt), the second migration, the expanded import payload, and the expanded response shape. These fields are central to the application's current functionality and affect sections 4.3, 4.4, 4.7, and the response shapes throughout.

### Priority 3 — Update import pipeline behavior (Moderate impact, paragraph rewrite)

Section 4.3 should describe upsert (ON CONFLICT DO UPDATE) instead of skip (DO NOTHING). The response shape should document `{imported, updated, skipped, importedIds}` instead of `{imported, skipped, duplicates}`.

### Priority 4 — Document admin.js middleware (Moderate impact, new subsection)

Add `middleware/admin.js` to the directory structure and add a brief subsection describing the admin check mechanism (`ADMIN_EMAILS` env var, `isAdmin()`, `requireAdmin` middleware).

### Priority 5 — Remove phantom files and features (Low impact, line edits)

Remove `services/similarity.js` and `db/clusters.js` from the directory structure. Remove `SIMILARITY_THRESHOLD` from the environment variable table. Remove `cluster_id` from the GET /api/gems parameters. Update or remove Milestone 5 (duplicate clustering) to reflect that it was not implemented.

### Priority 6 — Update environment variable table (Low impact, table edit)

Add `ADMIN_EMAILS` to section 6.4. Remove `SIMILARITY_THRESHOLD`. Note that `NODE_ENV` is not actually read by any server code.

### Priority 7 — Mark SPA serving as implemented (Low impact, one-liner)

Update section 4.9 to note that static file serving and SPA fallback are now implemented, and remove it from the Deferred list in section 8.

### Priority 8 — Add CORS documentation (Low impact, new paragraph)

Add a brief note about the CORS middleware in server.js, listing allowed origins.

### Priority 9 — Update extension version reference (Low impact, one-liner)

Change "v0.3.0" to "v0.10.0" in section 3.
