---
type: plan
title: "API Server — Implementation Plan"
spec: docs/specs/api-server-SPEC.md
scope: Express REST API server with Docker Compose local dev, PostgreSQL migrations, auth, gem CRUD, search, and stats
date: 2026-04-05
---

## 1. Goal

Build the Gem Factory backend API server — an Express.js REST service that accepts gem imports, stores them in PostgreSQL, and serves them via CRUD and search endpoints. The server runs locally via Docker Compose (`make api-start` / `make api-stop`), applies database migrations on startup, authenticates requests via Google ID tokens (with a dev bypass mode), and provides full-text search over the gem registry. Deduplication logic (duplicate clusters) is deferred — the schema tables exist but no clustering code runs. Admin access is controlled by a hard-coded email list.

Spec: [`docs/specs/api-server-SPEC.md`](../specs/api-server-SPEC.md)

## 2. Context & Prior Art

### Existing codebase

- **`docs/context/ARCH.md`** — Defines the full schema (section 3.4), API surface (section 7.1), environment variables (section 7.4), and layered monolith architecture (section 3.3). The schema includes `users`, `gems`, `duplicate_clusters`, and `duplicate_cluster_members` tables.
- **`extension/background.js`** — Already implements `GET_GEMS` and `CLEAR_GEMS` external message handlers. The gem payload shape from the extension includes `id`, `name`, `instructions`, and other fields.
- **`Makefile`** — Uses `SHELL := /bin/bash`, has `help`, `db-init`, `db-test`, `voicecode` targets. New `api-start` and `api-stop` targets will follow the same pattern (comment-based help via `##`).
- **`.gitignore`** — Currently only ignores `.db-config`. Will need entries for `node_modules/` and Docker volumes.
- **`docs/plans/chrome-extension-gem-extractor-PLAN.md`** — Existing plan document showing the frontmatter and section conventions to follow.

### Dependencies & libraries

| Package | Purpose |
|---------|---------|
| `express` | HTTP framework |
| `pg` | PostgreSQL client |
| `google-auth-library` | Google ID token verification |
| `crypto` (built-in) | SHA-256 instruction hashing |

### Key decisions (from spec open questions)

1. **Framework:** Express.
2. **Migration tool:** Minimal custom runner (~50 lines, reads `.sql` files, tracks in `schema_migrations` table).
3. **Deduplication:** Eliminated from this build. Schema tables for clusters are created but no clustering code runs. Import pipeline skips cluster logic entirely.
4. **Deletion:** Hard delete (row removal).
5. **Admin auth:** Hard-coded `admin_emails` array in server config. `charles.schiele@gmail.com` is the primary admin.

## 3. Implementation Steps

### Phase A: Project Skeleton & Docker Compose

#### Step 1 — Create `server/package.json`

- **What:** New file — Node.js project manifest with dependencies.
- **Where:** `server/package.json`
- **How:**
```json
{
  "name": "gem-factory-api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "test": "node --test test/"
  },
  "dependencies": {
    "express": "^4.21.0",
    "pg": "^8.13.0",
    "google-auth-library": "^9.14.0"
  }
}
```
- **Why:** ES modules (`"type": "module"`) for modern `import` syntax. `node --test` is Node 20's built-in test runner — minimal, no extra dependency.

#### Step 2 — Create `server/Dockerfile`

- **What:** New file — Docker image definition for the API server.
- **Where:** `server/Dockerfile`
- **How:**
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
EXPOSE 9090
CMD ["node", "server.js"]
```
- **Why:** Matches spec section 4.1.2 exactly. Alpine for small image size.

#### Step 3 — Create `docker-compose.yml`

- **What:** New file — defines `db` (PostgreSQL 16) and `api` (Express server) services.
- **Where:** `docker-compose.yml` (project root)
- **How:** Replicate the spec's section 4.1.1 configuration verbatim. Key points:
  - `db` service: `postgres:16-alpine`, healthcheck with `pg_isready`, named volume `gem_factory_pgdata`.
  - `api` service: builds from `./server`, port 9090, `DATABASE_URL` pointing to `db`, `node --watch server.js` as command, bind-mount `./server:/app` with anonymous volume for `node_modules`.
  - Pass `GOOGLE_CLIENT_ID`, `ALLOWED_DOMAIN`, and `ADMIN_EMAILS` from host env with empty defaults.
  - Add `ADMIN_EMAILS: "${ADMIN_EMAILS:-charles.schiele@gmail.com}"` to the api environment block.

#### Step 4 — Add Makefile targets

- **What:** Edit existing file — add `api-start` and `api-stop` targets.
- **Where:** `Makefile`
- **How:** Add before the `.PHONY` line:
```makefile
api-start: ## Start the API server and database (Docker Compose)
	docker compose up -d --build
	@echo ""
	@echo "Gem Factory API running at http://localhost:9090"
	@echo "PostgreSQL running at localhost:5432"
	@echo "  Stop with: make api-stop"
	@echo "  Logs with: docker compose logs -f api"

api-stop: ## Stop the API server and database
	docker compose down
```
  Add `api-start` and `api-stop` to the `.PHONY` list.

#### Step 5 — Update `.gitignore`

- **What:** Edit existing file — add Node.js and Docker entries.
- **Where:** `.gitignore`
- **How:** Append:
```
node_modules/
server/node_modules/
```

#### Step 6 — Create `server/server.js` (entry point)

- **What:** New file — Express app setup, middleware mounting, route registration, startup sequence.
- **Where:** `server/server.js`
- **How:**
  1. Import Express, the db pool, the migration runner, and route modules.
  2. Create the Express app. Configure `express.json({ limit: '1mb' })`.
  3. Mount auth middleware on `/api/*` routes (excluding `/api/health`).
  4. Mount route handlers: `gems`, `users`, `stats`.
  5. Add `GET /api/health` returning `{ status: "ok" }`.
  6. Add `GET /` returning `{ service: "gem-factory", status: "ok" }`.
  7. Startup function: run migrations, then `app.listen(PORT)`.
  8. Handle startup failure (migration or DB connection) by logging and exiting with code 1.

### Phase B: Database Layer

#### Step 7 — Create `server/db/pool.js`

- **What:** New file — PostgreSQL connection pool singleton.
- **Where:** `server/db/pool.js`
- **How:**
```js
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export default pool;
```
  Export the pool. All repository modules import from here.

#### Step 8 — Create `server/db/migrate.js`

- **What:** New file — lightweight migration runner.
- **Where:** `server/db/migrate.js`
- **How:**
  1. Create `schema_migrations` table if it doesn't exist: `CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())`.
  2. Read all `.sql` files from `db/migrations/` sorted by filename.
  3. Query `schema_migrations` for already-applied filenames.
  4. For each unapplied migration: read file, execute SQL in a transaction, insert filename into `schema_migrations`.
  5. Log each applied migration.
  6. Export a single `async function migrate(pool)`.

#### Step 9 — Create `server/db/migrations/001_initial_schema.sql`

- **What:** New file — the full database schema from ARCH.md section 3.4.
- **Where:** `server/db/migrations/001_initial_schema.sql`
- **How:** Include all tables from the architecture doc:
  - `users` — with `id`, `email` (unique), `display_name`, `first_import_at`, `last_import_at`, `created_at`.
  - `gems` — with `id`, `owner_id` (FK), `name`, `instructions`, `icon`, `source`, `instruction_hash`, `status`, `imported_at`, `updated_at`, `search_vector` (generated tsvector column).
  - `duplicate_clusters` — with `id`, `representative_gem_id` (FK), `gem_count`, `created_at`.
  - `duplicate_cluster_members` — with `cluster_id` (FK), `gem_id` (FK), `similarity_score`, composite PK.
  - Indexes: `idx_gems_owner`, `idx_gems_hash`, `idx_gems_search` (GIN), `idx_gems_owner_hash` (unique, for upsert).
- **Why:** Schema tables for clusters are created even though clustering logic is deferred — this avoids a future migration just to add tables, and the FK references from gems list/detail responses can return `null` cluster info cleanly.

#### Step 10 — Create `server/db/gems.js` (gem repository)

- **What:** New file — database query functions for the `gems` table.
- **Where:** `server/db/gems.js`
- **How:** Export async functions:
  - `insertGem(pool, { ownerId, name, instructions, icon, source, instructionHash })` — `INSERT ... ON CONFLICT (owner_id, instruction_hash) DO NOTHING RETURNING *`. Returns the inserted row or `null` if conflict.
  - `findById(pool, id)` — `SELECT` with JOIN on `users` for owner info. No cluster join (deferred).
  - `list(pool, { q, owner, status, page, limit })` — Paginated query. When `q` is present, filter by `search_vector @@ plainto_tsquery('english', $q)` and order by `ts_rank`. Otherwise order by `imported_at DESC`. Include total count for pagination.
  - `update(pool, id, fields)` — `UPDATE gems SET ... WHERE id = $1 RETURNING *`. Only allow `name`, `icon`, `status` fields. Use a dynamic field builder that only sets provided fields.
  - `remove(pool, id)` — `DELETE FROM gems WHERE id = $1`. Hard delete.
  - `countByOwner(pool, ownerId)` — `SELECT COUNT(*) FROM gems WHERE owner_id = $1`.

#### Step 11 — Create `server/db/users.js` (user repository)

- **What:** New file — database query functions for the `users` table.
- **Where:** `server/db/users.js`
- **How:** Export async functions:
  - `upsertUser(pool, { email, displayName })` — `INSERT INTO users (email, display_name) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET display_name = COALESCE(EXCLUDED.display_name, users.display_name) RETURNING *`.
  - `updateLastImport(pool, userId)` — Updates `last_import_at` and sets `first_import_at` if null.
  - `findByEmail(pool, email)` — `SELECT * FROM users WHERE email = $1`.
  - `findById(pool, id)` — `SELECT * FROM users WHERE id = $1`.
  - `listWithGemCounts(pool)` — `SELECT u.*, COUNT(g.id) as gem_count FROM users u LEFT JOIN gems g ON g.owner_id = u.id GROUP BY u.id ORDER BY gem_count DESC`.

### Phase C: Authentication Middleware

#### Step 12 — Create `server/middleware/auth.js`

- **What:** New file — Express middleware for Google ID token validation with dev bypass.
- **Where:** `server/middleware/auth.js`
- **How:**
  1. Import `OAuth2Client` from `google-auth-library`.
  2. Read `GOOGLE_CLIENT_ID` and `ALLOWED_DOMAIN` from env.
  3. **Dev bypass mode** (when `GOOGLE_CLIENT_ID` is empty):
     - Set `req.user = { email: 'dev@localhost', name: 'Dev User' }`.
     - If `X-Dev-User-Email` header is present, use that as `req.user.email`.
     - Call `next()`.
  4. **Production mode** (when `GOOGLE_CLIENT_ID` is set):
     - Extract Bearer token from `Authorization` header. Return 401 if missing.
     - Call `client.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })`.
     - Check `hd` claim against `ALLOWED_DOMAIN` if set. Return 403 if mismatch.
     - Set `req.user = { email: payload.email, name: payload.name }`.
     - Return 401 on verification failure (expired, invalid).
  5. Export the middleware function.

#### Step 13 — Create `server/middleware/admin.js`

- **What:** New file — middleware that checks if the authenticated user is an admin.
- **Where:** `server/middleware/admin.js`
- **How:**
  1. Read `ADMIN_EMAILS` from env (comma-separated string), parse into an array. Default to `['charles.schiele@gmail.com']`.
  2. Export a middleware function that checks `req.user.email` against the list. Returns 403 if not admin.
  3. Also export a helper `isAdmin(email)` function for use in route handlers where admin status affects behavior but doesn't gate access (e.g., PATCH allowing admin to change `status`).
- **Why:** Separated from auth.js to keep concerns clean — auth verifies identity, admin checks authorization.

### Phase D: Services Layer

#### Step 14 — Create `server/services/ingestion.js`

- **What:** New file — gem import business logic (normalize, hash, insert).
- **Where:** `server/services/ingestion.js`
- **How:** Export `async function importGems(pool, { userId, gems })`:
  1. Initialize counters: `imported = 0`, `skipped = 0`, `importedIds = []`.
  2. For each gem in the array:
     a. **Normalize:** `instructions.trim()`, collapse `\r\n` to `\n`, collapse 3+ consecutive newlines to 2.
     b. **Hash:** `crypto.createHash('sha256').update(normalizedInstructions).digest('hex')`.
     c. **Insert:** Call `gems.insertGem(pool, { ownerId: userId, name, instructions: normalizedInstructions, icon, source: source || 'extension', instructionHash })`.
     d. If insert returned a row, increment `imported` and collect the ID. If null (conflict), increment `skipped`.
  3. Update user's `last_import_at` (and `first_import_at` if first time).
  4. Return `{ imported, skipped, importedIds }`.
- **Why:** Deduplication cluster logic is intentionally omitted per decision. The `ON CONFLICT` on `(owner_id, instruction_hash)` still prevents same-user exact duplicates at the database level, which is essential for idempotent imports.

#### Step 15 — Create `server/services/search.js`

- **What:** New file — builds SQL query fragments for full-text search.
- **Where:** `server/services/search.js`
- **How:** Export `function buildSearchClause(q)`:
  - If `q` is provided: return `{ where: 'search_vector @@ plainto_tsquery(\'english\', $N)', orderBy: 'ts_rank(search_vector, plainto_tsquery(\'english\', $N)) DESC', params: [q] }`.
  - If not: return `{ where: null, orderBy: 'imported_at DESC', params: [] }`.
  This keeps query building logic out of the repository layer while keeping it simple. The repository's `list` function consumes these fragments.

### Phase E: Route Handlers

#### Step 16 — Create `server/routes/gems.js`

- **What:** New file — Express router for all `/api/gems/*` endpoints.
- **Where:** `server/routes/gems.js`
- **How:** Create an Express `Router` and define:

  **`POST /import`** — Gem import endpoint.
  1. Validate request body: `gems` must be a non-empty array, max 100 items. Each gem must have `name` (string, non-empty) and `instructions` (string, non-empty, max 100KB).
  2. Upsert user via `users.upsertUser(pool, { email: req.user.email, name: req.user.name })`.
  3. Call `ingestion.importGems(pool, { userId: user.id, gems: body.gems })`.
  4. Return `{ imported, skipped, importedIds }` with status 200.

  **`GET /`** — List/search gems.
  1. Parse query params: `q`, `owner`, `status`, `page` (default 1), `limit` (default 20, max 100).
  2. Call `gems.list(pool, { q, owner, status, page, limit })`.
  3. Return `{ gems: [...], pagination: { page, limit, total } }`.
  4. Each gem in the response includes an `owner` object with `id`, `email`, `displayName`.
  5. `duplicateCluster` is always `null` (clustering deferred).

  **`GET /:id`** — Single gem detail.
  1. Call `gems.findById(pool, id)`. Return 404 if not found.
  2. Return the gem with owner info. `duplicateCluster: null`.

  **`PATCH /:id`** — Update gem metadata.
  1. Fetch the gem. Return 404 if not found.
  2. Check authorization: the request user must be the gem owner OR an admin (use `isAdmin(req.user.email)`).
  3. Validate update fields: `name` and `icon` allowed for owner/admin. `status` allowed for admin only.
  4. If non-admin tries to set `status`, return 403.
  5. Call `gems.update(pool, id, validatedFields)`. Return updated gem.

  **`DELETE /:id`** — Hard delete a gem.
  1. Fetch the gem. Return 404 if not found.
  2. Check authorization: request user must be the gem owner. (Admins could also delete — include admin check for safety.)
  3. Call `gems.remove(pool, id)`. Return 204 No Content.

#### Step 17 — Create `server/routes/users.js`

- **What:** New file — Express router for `/api/users/*` endpoints.
- **Where:** `server/routes/users.js`
- **How:**

  **`GET /me`** — Current user profile.
  1. Find user by `req.user.email`. If not found, return `{ email: req.user.email, name: req.user.name, gemCount: 0, firstImportAt: null, lastImportAt: null }` (user exists in auth but hasn't imported yet).
  2. If found, include gem count via `gems.countByOwner`.

  **`GET /`** — List all users with gem counts.
  1. Call `users.listWithGemCounts(pool)`.
  2. Return `{ users: [...] }`.

#### Step 18 — Create `server/routes/stats.js`

- **What:** New file — Express router for `/api/stats`.
- **Where:** `server/routes/stats.js`
- **How:**

  **`GET /`** — Org-wide statistics.
  1. Run queries for: `COUNT(*) FROM gems` (totalGems), `COUNT(DISTINCT instruction_hash) FROM gems` (uniqueGems), `COUNT(*) FROM users` (totalUsers).
  2. `duplicateClusters` and `topClusters` return `0` and `[]` respectively (clustering deferred).
  3. Return the stats object.
- **Why:** Even with clustering deferred, the stats endpoint is useful for total counts. The unique gem count (distinct hashes) gives visibility into duplication levels without cluster logic.

### Phase F: Wire Everything Together

#### Step 19 — Complete `server/server.js` wiring

- **What:** Edit — finalize the entry point with all imports and middleware chain.
- **Where:** `server/server.js`
- **How:**
  1. Import: `express`, `pool` from `db/pool.js`, `migrate` from `db/migrate.js`, `authMiddleware` from `middleware/auth.js`, route modules.
  2. `app.use(express.json({ limit: '1mb' }))`.
  3. `app.get('/api/health', (req, res) => res.json({ status: 'ok' }))` — before auth middleware.
  4. `app.use('/api', authMiddleware)`.
  5. `app.use('/api/gems', gemsRouter)`.
  6. `app.use('/api/users', usersRouter)`.
  7. `app.use('/api/stats', statsRouter)`.
  8. `app.get('/', (req, res) => res.json({ service: 'gem-factory', status: 'ok' }))`.
  9. Global error handler: `app.use((err, req, res, next) => ...)` — logs error, returns 500.
  10. Startup: `await migrate(pool)`, then `app.listen(process.env.PORT || 9090)`.

### Phase G: Testing

#### Step 20 — Create test files using Node.js built-in test runner

- **What:** New files — minimal test suite using `node:test` and `node:assert`.
- **Where:** `server/test/`
- **How:** Create the following test files:

  **`server/test/ingestion.test.js`** — Unit tests for normalization and hashing logic.
  1. Test that whitespace normalization works (trailing spaces, CRLF, multiple blank lines).
  2. Test that SHA-256 hashing is deterministic (same input = same hash).
  3. Test that different instructions produce different hashes.

  **`server/test/auth.test.js`** — Unit tests for the auth middleware.
  1. Test dev bypass mode: when `GOOGLE_CLIENT_ID` is empty, `req.user` is set to default dev user.
  2. Test `X-Dev-User-Email` header override in dev mode.
  3. Test that missing Authorization header returns 401 (when `GOOGLE_CLIENT_ID` is set — mock `verifyIdToken`).

  **`server/test/gems.test.js`** — Integration tests for gem routes (requires running database).
  1. Test `POST /api/gems/import` with valid payload returns correct counts.
  2. Test duplicate import (same instructions) returns `skipped: 1`.
  3. Test `GET /api/gems` returns imported gems with pagination.
  4. Test `GET /api/gems?q=keyword` returns only matching gems.
  5. Test `DELETE /api/gems/:id` removes the gem.

  These integration tests connect to the Compose PostgreSQL. Add a `server/test/setup.js` that:
  - Creates a test-specific schema or uses a `gem_factory_test` database.
  - Runs migrations before tests.
  - Truncates tables between tests.

  Add a Makefile target:
  ```makefile
  api-test: ## Run API server tests (requires running database)
  	docker compose exec api node --test test/
  ```

#### Step 21 — Add `api-test` and `api-logs` Makefile targets

- **What:** Edit — add convenience targets.
- **Where:** `Makefile`
- **How:**
```makefile
api-test: ## Run API server tests (requires running containers)
	docker compose exec api node --test test/

api-logs: ## Tail API server logs
	docker compose logs -f api
```
  Add to `.PHONY`.

## 4. Data Model / Schema Changes

### New tables (in `001_initial_schema.sql`)

All four tables from ARCH.md section 3.4:

- **`users`** — `id` (UUID PK), `email` (unique), `display_name`, `first_import_at`, `last_import_at`, `created_at`.
- **`gems`** — `id` (UUID PK), `owner_id` (FK→users), `name`, `instructions`, `icon`, `source`, `instruction_hash`, `status`, `imported_at`, `updated_at`, `search_vector` (generated tsvector).
- **`duplicate_clusters`** — `id` (UUID PK), `representative_gem_id` (FK→gems), `gem_count`, `created_at`. Created but unused in this build.
- **`duplicate_cluster_members`** — `cluster_id` (FK), `gem_id` (FK), `similarity_score`, composite PK. Created but unused in this build.

### New indexes

- `idx_gems_owner` on `gems(owner_id)`
- `idx_gems_hash` on `gems(instruction_hash)`
- `idx_gems_search` GIN on `gems(search_vector)`
- `idx_gems_owner_hash` UNIQUE on `gems(owner_id, instruction_hash)` — enables `ON CONFLICT` upsert

### Configuration

- **`ADMIN_EMAILS`** environment variable — comma-separated list of admin email addresses. Defaults to `charles.schiele@gmail.com` in `docker-compose.yml` and in the middleware code.

## 5. Integration Points

### Chrome Extension → (future SPA) → API Server

The import endpoint `POST /api/gems/import` accepts the same payload shape that the extension produces. The extension's `background.js` stores gems with `id`, `name`, `instructions` fields — the import endpoint expects `name` and `instructions` (plus optional `icon` and `source`). The extension's `id` field (Gemini's internal gem ID) is not stored as a primary key — the server generates its own UUIDs. A future SPA will bridge these two.

### Database

Connects via `DATABASE_URL` env var to the Compose PostgreSQL service. The `pg` Pool handles connection lifecycle. Migrations run before the server accepts traffic.

### Makefile

New targets `api-start`, `api-stop`, `api-test`, `api-logs` integrate with the existing Makefile pattern (comment-based `## help` strings, `.PHONY` declarations).

### Existing `db-init` / `db-test`

These remain functional. When the Compose stack is running, `db-test` works against `localhost:5432` with the `gem_factory` credentials if `.db-config` is configured to match.

## 6. Edge Cases & Risks

### Import validation

- Empty `gems` array → 400.
- Gem missing `name` or `instructions` → 400 with field-level error message.
- Instructions exceeding 100KB → 400.
- More than 100 gems in one request → 400.
- Same user importing identical instructions → `ON CONFLICT DO NOTHING`, counted as `skipped`. No error.

### Auth edge cases

- Missing `Authorization` header → 401 `{ error: "Authentication required" }`.
- Invalid/expired token → 401 `{ error: "Invalid or expired token" }`.
- Valid token, wrong domain → 403 `{ error: "Access restricted to <domain>" }`.
- Dev mode with no `GOOGLE_CLIENT_ID` → bypass, uses `dev@localhost` (or `X-Dev-User-Email` header).

### Database resilience

- DB unreachable on startup → migration fails, server exits with code 1. Docker Compose will not auto-restart by default — this is intentional for development (fail loudly).
- DB unreachable during request → `pg` Pool throws, global error handler returns 503.
- Migration failure (bad SQL) → server refuses to start, logs the failing migration filename and error.

### Generated tsvector column

- PostgreSQL's `GENERATED ALWAYS AS ... STORED` tsvector column requires PostgreSQL 12+. The Compose config uses PostgreSQL 16, so this is fine. Worth noting as a compatibility constraint if someone tries to use an older PG.

### `node --watch` limitations

- Node.js `--watch` restarts on any file change in the watched directory. Adding/removing files in `server/` may cause a restart during test runs executed via `docker compose exec`. This is cosmetic — tests complete before the restart takes effect.

### Hard delete caveat

- `DELETE /api/gems/:id` permanently removes the row. If the gem was the `representative_gem_id` of a cluster (future), the FK would break. Since clustering is deferred and no cluster rows will exist, this is safe for now. When clustering is added, delete logic must update or remove the cluster.

## 7. Verification

### Manual verification (step by step)

1. **`make api-start`** — Both containers start. `docker compose ps` shows `db` (healthy) and `api` (running).
2. **`curl http://localhost:9090/api/health`** → `{ "status": "ok" }`.
3. **`curl http://localhost:9090/`** → `{ "service": "gem-factory", "status": "ok" }`.
4. **Import a gem:**
   ```bash
   curl -X POST http://localhost:9090/api/gems/import \
     -H 'Content-Type: application/json' \
     -d '{"gems":[{"name":"Test Gem","instructions":"You are a helpful test assistant."}]}'
   ```
   → `{ "imported": 1, "skipped": 0, "importedIds": ["<uuid>"] }`.
5. **Import the same gem again** → `{ "imported": 0, "skipped": 1, "importedIds": [] }`.
6. **List gems:** `curl http://localhost:9090/api/gems` → paginated response with the test gem.
7. **Search:** `curl 'http://localhost:9090/api/gems?q=helpful'` → returns the test gem.
8. **Get by ID:** `curl http://localhost:9090/api/gems/<uuid>` → full gem detail.
9. **Update:** `curl -X PATCH http://localhost:9090/api/gems/<uuid> -H 'Content-Type: application/json' -d '{"name":"Renamed Gem"}'` → updated gem.
10. **Delete:** `curl -X DELETE http://localhost:9090/api/gems/<uuid>` → 204.
11. **User profile:** `curl http://localhost:9090/api/users/me` → dev user with gem count.
12. **Stats:** `curl http://localhost:9090/api/stats` → `{ "totalGems": 0, "uniqueGems": 0, ... }`.
13. **Multi-user test:** `curl -H 'X-Dev-User-Email: other@test.com' http://localhost:9090/api/users/me` → different user.
14. **`make api-stop`** then `make api-start` — data persists (named volume).
15. **`make api-test`** — all tests pass.

### Automated tests (from Step 20)

- Normalization produces consistent output for various whitespace inputs.
- Hashing is deterministic.
- Dev bypass sets correct `req.user`.
- Import endpoint returns correct counts.
- Duplicate detection via `ON CONFLICT` works.
- Search returns relevant results.
- Delete removes the row.

### Acceptance criteria (from spec section 9)

| # | Criterion | How verified |
|---|-----------|-------------|
| 1 | Import accepts valid payload, inserts gems, returns summary | Manual step 4 + integration test |
| 2 | Same-user duplicate is skipped | Manual step 5 + integration test |
| 3 | Cross-user duplicate detection | **Deferred** (clustering eliminated from build) |
| 4 | Search with `?q=keyword` returns matching gems | Manual step 7 + integration test |
| 5 | Gem detail with cluster info | Detail works; cluster info is `null` (deferred) |
| 6 | Auth returns 401/403 | Auth unit tests |
| 7 | Schema applied on startup | Verified by successful import (tables must exist) |
| 8 | `make api-start` + health check works | Manual steps 1-2 |
| 9 | `make api-stop` preserves data | Manual step 14 |

## 8. Open Questions

### Resolved (decisions incorporated above)

- **Framework** → Express.
- **Migration tool** → Custom minimal runner.
- **Deduplication** → Deferred. Schema tables created, no runtime logic.
- **Deletion** → Hard delete.
- **Admin auth** → Hard-coded email list, `charles.schiele@gmail.com` default.

### Remaining

- **`GOOGLE_CLIENT_ID` for local testing with real auth:** If you want to test Google token validation locally (not just dev bypass), you'll need to create an OAuth client ID in Google Cloud Console and set the env var before running `make api-start`. This is optional — dev bypass mode is sufficient for development.
- **CORS configuration:** The spec doesn't mention CORS. When the SPA is built and served from a different dev port (e.g., Vite on port 5173), the API will need CORS headers. This can be added later — for now, all requests go directly to port 9090 (same origin or curl).
- **Rate limiting:** Not addressed in the spec. For an internal corporate tool the risk is low, but worth considering before any external exposure.
