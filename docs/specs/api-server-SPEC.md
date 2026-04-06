---
type: spec
title: "Gem Factory API Server"
scope: Node.js backend API — authentication, gem ingestion, registry CRUD, search, deduplication, local Docker Compose development
date: 2026-04-05
---

## 1. Problem Statement

Gem Factory has a Chrome extension that extracts gem configurations from the Gemini web app (see `docs/specs/chrome-extension-gem-extractor-SPEC.md`), and a database schema designed for storing gems, users, and duplicate clusters (see `docs/context/ARCH.md` section 3.4). What's missing is the backend service that connects these two: an API server that accepts imported gems, normalizes and deduplicates them, stores them in PostgreSQL, and serves them to the future SPA for browsing and search.

Without the API server:
- Extracted gems stay in `chrome.storage.local` with no way to share them across users or persist them centrally.
- There is no search, no duplicate detection, and no organizational visibility into what gems exist.
- The entire value proposition of Gem Factory — a shared, searchable gem registry — is unrealized.

The API server is the bridge between extraction (browser-side) and the registry (database-side). It is the next critical-path component after the Chrome extension.

## 2. Goals & Non-Goals

### Goals

- Accept gem imports from the SPA (and eventually directly from the extension) via a REST endpoint, process them (normalize, hash, deduplicate), and store them in PostgreSQL.
- Authenticate all requests using Google ID tokens, restricting access to the corporate domain.
- Provide CRUD endpoints for gems and users, with full-text search and filtering.
- Detect exact duplicates via instruction hashing (SHA-256) and group near-duplicates into clusters.
- Serve the SPA's static assets alongside the API from a single service (deferred until SPA is built).
- Run locally via Docker Compose with `make api-start` / `make api-stop`.
- Apply the database schema on startup via a migration mechanism.

### Non-Goals

- **Building the SPA.** The frontend is a separate spec. This spec covers only the API and the static file serving.
- **Review workflows (Phase 2).** The `status` column exists in the schema but no review state transitions are built here.
- **Gem-to-Enterprise-Agent promotion (Phase 3).** Entirely out of scope.
- **Drive API metadata enrichment.** Optional per the architecture; not included in Phase 1.
- **Embedding-based semantic similarity.** Phase 1 uses SHA-256 exact-match hashing and optionally TF-IDF for near-duplicates. Vertex AI embeddings are a future enhancement.
- **Production deployment (Cloud Run, CI/CD).** This spec covers local development only. Production infrastructure is a separate concern.

## 3. Proposed Solution

Build a Node.js (Express) REST API server structured as a layered monolith per `ARCH.md` section 3.3. For local development, the server and its PostgreSQL database run via Docker Compose, controlled through Makefile targets.

**Why Express over Fastify:** Express has a larger ecosystem for middleware (especially Google auth libraries), wider team familiarity in corporate Node.js environments, and the performance difference is negligible at this traffic volume (internal corporate tool, periodic imports, casual browsing).

**Why Docker Compose for local dev:** It provides a self-contained, reproducible environment — PostgreSQL and the API server start together with a single command. Developers don't need to install Node.js or PostgreSQL locally. The existing `make db-init` / `.db-config` workflow is replaced by Compose's environment configuration for the API service, though the Makefile remains the primary interface.

**Why a single service:** Per `ARCH.md` section 8.3, splitting the API and SPA serving adds deployment complexity with no benefit at the expected scale. If similarity computation becomes expensive later, it can be extracted to a worker without changing the API surface.

### Key workflow

1. User extracts gems via the Chrome extension (already built, v0.3.0).
2. User opens the Gem Factory SPA, authenticates via Google Identity Services.
3. SPA requests gems from the extension via `chrome.runtime.sendMessage` (`GET_GEMS`).
4. SPA displays a preview. User confirms import.
5. SPA sends `POST /api/gems/import` with the gems array and a Bearer ID token.
6. Server validates the token, upserts the user, normalizes gem text, hashes instructions, checks for duplicates, inserts gems, updates clusters, and returns an import summary.
7. User browses the registry via `GET /api/gems` with search and filter parameters.

## 4. Technical Design

### 4.1 Directory Structure

```
gem-factory/
  docker-compose.yml          # Local dev: API server + PostgreSQL
  server/
    Dockerfile                # Node.js container for the API server
    package.json
    server.js                 # Entry point — configures Express, mounts routes
    middleware/
      auth.js                 # Google ID token validation, domain check
    routes/
      gems.js                 # /api/gems/* endpoints
      users.js                # /api/users/* endpoints
      stats.js                # /api/stats endpoint
    services/
      ingestion.js            # Normalize, hash, deduplicate, store
      similarity.js           # Near-duplicate detection (Phase 1: exact hash only)
      search.js               # Full-text search query builder
    db/
      pool.js                 # pg Pool setup (reads DATABASE_URL)
      migrate.js              # Lightweight migration runner
      migrations/
        001_initial_schema.sql
      gems.js                 # Gem repository (queries)
      users.js                # User repository (queries)
      clusters.js             # Duplicate cluster repository (queries)
```

### 4.1.1 Docker Compose Configuration

The `docker-compose.yml` at the project root defines two services:

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: gem_factory
      POSTGRES_PASSWORD: gem_factory_dev
      POSTGRES_DB: gem_factory
    ports:
      - "5432:5432"
    volumes:
      - gem_factory_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U gem_factory"]
      interval: 3s
      timeout: 3s
      retries: 10

  api:
    build: ./server
    ports:
      - "9090:9090"
    environment:
      PORT: "9090"
      DATABASE_URL: "postgresql://gem_factory:gem_factory_dev@db:5432/gem_factory"
      GOOGLE_CLIENT_ID: "${GOOGLE_CLIENT_ID:-}"
      ALLOWED_DOMAIN: "${ALLOWED_DOMAIN:-}"
      NODE_ENV: development
    depends_on:
      db:
        condition: service_healthy
    volumes:
      - ./server:/app
      - /app/node_modules
    command: node --watch server.js

volumes:
  gem_factory_pgdata:
```

Key design decisions:

- **Port 9090** for the API — a high port that avoids conflicts with common local services (3000, 5000, 8080). The SPA (when built) will proxy API calls to this port during development.
- **Port 5432** for PostgreSQL — exposed to the host so developers can connect with `psql` or a GUI tool for debugging. This also means the existing `make db-test` still works against the Compose database.
- **Named volume** (`gem_factory_pgdata`) — database data persists across `docker compose down` / `up` cycles. Only `docker compose down -v` destroys data.
- **`node --watch`** — Node.js 18+ built-in file watcher restarts the server on code changes. No dependency on `nodemon`.
- **Bind-mount `./server:/app`** — source code changes are reflected immediately in the container without rebuilding.
- **`/app/node_modules` anonymous volume** — prevents the host's `node_modules` (if any) from clobbering the container's installed dependencies.
- **`GOOGLE_CLIENT_ID` and `ALLOWED_DOMAIN`** are passed through from the host environment. In local development without Google auth configured, the auth middleware should have a bypass mode (see section 4.2).

### 4.1.2 Server Dockerfile

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
EXPOSE 9090
CMD ["node", "server.js"]
```

Minimal — no multi-stage build needed for a development image. Production deployment (future) may use a leaner image.

### 4.1.3 Makefile Targets

The Makefile at the project root gains two new targets:

**`make api-start`** — Builds (if needed) and starts the API server and database in the background.

```makefile
api-start: ## Start the API server and database (Docker Compose)
	docker compose up -d --build
	@echo ""
	@echo "Gem Factory API running at http://localhost:9090"
	@echo "PostgreSQL running at localhost:5432"
	@echo "  Stop with: make api-stop"
	@echo "  Logs with: docker compose logs -f api"
```

**`make api-stop`** — Stops the containers (preserves database data).

```makefile
api-stop: ## Stop the API server and database
	docker compose down
```

Both are added to the `.PHONY` list. The `api-start` target uses `--build` so that `Dockerfile` or `package.json` changes are picked up automatically without a separate build step.

### 4.1.4 Relationship to Existing `db-init` / `db-test`

The Docker Compose setup provides its own PostgreSQL instance with pre-configured credentials. This supersedes `make db-init` for API development. However, `db-init` and `db-test` remain useful for connecting to external databases (e.g., a shared staging instance or the developer's own PostgreSQL installation).

When the Compose stack is running, `make db-test` works against it if `.db-config` contains:
```
DB_HOST=localhost
DB_PORT=5432
DB_USER=gem_factory
DB_PASS=gem_factory_dev
DB_NAME=gem_factory
```

### 4.2 Authentication

All `/api/*` endpoints (except `/api/health`) require authentication.

The `middleware/auth.js` module:
1. Extracts the Bearer token from the `Authorization: Bearer <token>` header.
2. Verifies it using `google-auth-library`'s `OAuth2Client.verifyIdToken()` with the configured `GOOGLE_CLIENT_ID`.
3. Checks the `hd` (hosted domain) claim matches `ALLOWED_DOMAIN`.
4. Extracts `email` and `name` from the token payload, attaches them to `req.user`.
5. Returns 401 for missing/invalid tokens, 403 for wrong domain.

**Development bypass mode:** When `GOOGLE_CLIENT_ID` is empty (the default in the Docker Compose config), the auth middleware skips token validation and uses a default dev user (`req.user = { email: 'dev@localhost', name: 'Dev User' }`). This allows testing the API with `curl` or any HTTP client without configuring Google OAuth. A header `X-Dev-User-Email` can optionally override the dev email for testing multi-user scenarios.

### 4.3 Gem Import Pipeline (`POST /api/gems/import`)

This is the most complex endpoint. The ingestion flow:

1. **Validate payload.** Expect `{ gems: [{ name, instructions, icon?, source? }] }`. Reject if `gems` is empty or any gem is missing `name` or `instructions`. Max 100 gems per request.
2. **Upsert user.** Find or create the user by email (from the auth token). Update `last_import_at`.
3. **For each gem:**
   a. **Normalize instructions.** Trim whitespace, collapse multiple blank lines, normalize line endings to `\n`.
   b. **Hash instructions.** SHA-256 of the normalized text → `instruction_hash`.
   c. **Check exact duplicate.** Query `gems` by `instruction_hash` AND `owner_id`. If found, skip (already imported by this user). If found from a different user, note as a cross-user duplicate.
   d. **Insert gem.** Insert into `gems` table with the user's `owner_id`. Use `ON CONFLICT` on `(owner_id, instruction_hash)` to skip same-user duplicates atomically.
   e. **Update duplicate clusters.** If the hash matches an existing gem from another user, add both to a duplicate cluster (create one if none exists). This is Phase 1's duplicate detection — exact matches only.
4. **Return summary.** `{ imported: N, skipped: N, duplicates: N }` with the list of imported gem IDs.

### 4.4 Registry Endpoints

**`GET /api/gems`** — List and search gems.

Query parameters:
| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Full-text search across name and instructions |
| `owner` | string | Filter by owner email |
| `status` | string | Filter by status (default: all) |
| `cluster_id` | UUID | Filter by duplicate cluster |
| `page` | int | Page number (default: 1) |
| `limit` | int | Results per page (default: 20, max: 100) |

Full-text search uses PostgreSQL's `search_vector @@ plainto_tsquery('english', $q)` with `ts_rank` ordering.

Response shape:
```json
{
  "gems": [
    {
      "id": "uuid",
      "name": "Code Reviewer",
      "instructions": "You are an expert...",
      "icon": "code",
      "source": "extension",
      "status": "imported",
      "owner": { "id": "uuid", "email": "user@corp.com", "displayName": "..." },
      "importedAt": "2026-04-05T...",
      "duplicateCluster": { "id": "uuid", "gemCount": 3 }
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 142 }
}
```

**`GET /api/gems/:id`** — Single gem with full details, including duplicate cluster members.

**`PATCH /api/gems/:id`** — Update gem metadata. Only the owner or an admin may update. Updatable fields: `name`, `icon`, `status` (admin only). Instructions are immutable after import (changing them changes the gem's identity).

**`DELETE /api/gems/:id`** — Soft or hard delete. Owner only. Removes from duplicate clusters.

### 4.5 User Endpoints

**`GET /api/users/me`** — Current user profile (email, display name, gem count, first/last import timestamps).

**`GET /api/users`** — List all users who have imported gems, with gem counts. Useful for the registry UI's owner filter dropdown.

### 4.6 Statistics Endpoint

**`GET /api/stats`** — Org-wide numbers:
```json
{
  "totalGems": 347,
  "uniqueGems": 298,
  "totalUsers": 42,
  "duplicateClusters": 23,
  "topClusters": [
    { "id": "uuid", "representativeName": "Code Reviewer", "gemCount": 8 }
  ]
}
```

### 4.7 Database Schema & Migrations

The schema is defined in `ARCH.md` section 3.4 and should be applied as a migration (`001_initial_schema.sql`). The migration runner:
1. Creates a `schema_migrations` table if it doesn't exist.
2. Reads `.sql` files from `db/migrations/`, sorted by numeric prefix.
3. Applies any migrations not yet recorded in `schema_migrations`.
4. Runs on server startup before accepting requests.

An additional unique index is needed for the upsert logic:
```sql
CREATE UNIQUE INDEX idx_gems_owner_hash ON gems(owner_id, instruction_hash);
```

### 4.8 Database Connection

`db/pool.js` reads the `DATABASE_URL` environment variable, which Docker Compose sets to `postgresql://gem_factory:gem_factory_dev@db:5432/gem_factory`. This is the standard `pg` connection string format.

No fallback to `.db-config` is needed in the server code — environment variables are the single mechanism. Docker Compose handles environment configuration for local dev; a future production deployment will set `DATABASE_URL` via Cloud Run environment config or Secret Manager.

### 4.9 Static File Serving

Deferred until the SPA is built. For now, the server only exposes `/api/*` routes. A `GET /` can return a simple JSON message (`{ "service": "gem-factory", "status": "ok" }`) confirming the server is running.

## 5. UI / UX

No direct UI is built in this spec — the API server is headless. The SPA spec (future document) will define the user-facing interface. However, the API design directly shapes the SPA's UX:

- The import endpoint returns structured summaries so the SPA can show "3 imported, 1 skipped (duplicate), 1 matched an existing gem."
- The search endpoint supports full-text search so the SPA can offer a search box.
- The gems list endpoint supports pagination and filtering so the SPA can offer browse/filter views.

## 6. Integration Points

### 6.1 Chrome Extension → SPA → API Server

The extension stores gems in `chrome.storage.local`. The SPA retrieves them via `chrome.runtime.sendMessage(EXTENSION_ID, { type: 'GET_GEMS' })` (already implemented in `extension/background.js`). After the user confirms import, the SPA sends `POST /api/gems/import`. After successful import, the SPA clears the extension storage via `{ type: 'CLEAR_GEMS' }`.

### 6.2 Database

The server connects to PostgreSQL via the `pg` npm package using the `DATABASE_URL` environment variable. In the Docker Compose local dev setup, this connects to the `db` service over the Compose network. Future production deployment will use Cloud SQL Auth Proxy or IAM database authentication.

### 6.3 Google Cloud Identity

The `google-auth-library` npm package validates ID tokens. The server never initiates OAuth flows — that's the SPA's job. The server only validates tokens it receives.

### 6.4 Environment Variables

Per `ARCH.md` section 7.4:

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `PORT` | Yes | 9090 | Server listen port (set by Compose, or Cloud Run in prod) |
| `DATABASE_URL` | Yes | Set by Compose | PostgreSQL connection string |
| `GOOGLE_CLIENT_ID` | No (dev) / Yes (prod) | — | OAuth client ID for token validation. If empty in dev, auth middleware runs in bypass mode |
| `ALLOWED_DOMAIN` | No (dev) / Yes (prod) | — | Corporate domain for `hd` claim check. If empty in dev, domain check is skipped |
| `SIMILARITY_THRESHOLD` | No | 0.85 | Float for duplicate clustering |
| `NODE_ENV` | No | development | Controls auth bypass and logging verbosity |

## 7. Edge Cases & Error Handling

### 7.1 Import Edge Cases

| Condition | Behavior |
|-----------|----------|
| Gem with empty instructions | Reject with 400: "Instructions must not be empty" |
| Gem with very long instructions (>100KB) | Reject with 400: "Instructions exceed maximum length" |
| Duplicate gem (same user, same instruction hash) | Skip silently, count in `skipped` |
| Duplicate gem (different user, same hash) | Import for the new user, add both to a duplicate cluster |
| Import request with >100 gems | Reject with 400: "Maximum 100 gems per import" |
| User imports the same gem twice in rapid succession | `ON CONFLICT` handles this atomically — no race condition |

### 7.2 Auth Edge Cases

| Condition | Behavior |
|-----------|----------|
| Missing `Authorization` header | 401 with `{ error: "Authentication required" }` |
| Expired token | 401 with `{ error: "Token expired" }` |
| Valid token, wrong domain | 403 with `{ error: "Access restricted to <ALLOWED_DOMAIN>" }` |
| Valid token, user not in `users` table | Auto-create user on first authenticated request |

### 7.3 Database Errors

| Condition | Behavior |
|-----------|----------|
| Database unreachable on startup | Retry connection with exponential backoff (3 attempts), then exit with error |
| Database unreachable during request | Return 503 with `{ error: "Service temporarily unavailable" }` |
| Migration fails | Server refuses to start, logs the error |
| Constraint violation (unexpected) | Return 500, log full error server-side, return generic error to client |

### 7.4 Concurrency

- In production, multiple instances may run concurrently. All state is in PostgreSQL — no in-memory coordination needed. (Locally, Docker Compose runs a single API instance.)
- The `ON CONFLICT` clause on `(owner_id, instruction_hash)` prevents duplicate inserts without locking.
- Duplicate cluster updates use a `SELECT ... FOR UPDATE` or advisory lock to prevent two concurrent imports from creating duplicate clusters for the same hash.

## 8. Scope & Milestones

### Milestone 1: Server skeleton with Docker Compose

- `docker-compose.yml`, `server/Dockerfile`, `server/package.json`.
- Express app, health check endpoint (`GET /api/health`), auth middleware (with dev bypass).
- Database connection pool via `DATABASE_URL`.
- Makefile targets: `make api-start`, `make api-stop`.
- Server starts, connects to the Compose PostgreSQL, and responds to health checks.

### Milestone 2: Schema migration and user management

- Migration runner, `001_initial_schema.sql` applied on startup.
- `GET /api/users/me` and auto-create user on first request.
- `GET /api/users` listing.

### Milestone 3: Gem import

- `POST /api/gems/import` with validation, normalization, hashing, dedup.
- `GET /api/gems` with pagination.
- `GET /api/gems/:id`.

### Milestone 4: Search and filtering

- Full-text search via `search_vector`.
- Query parameter filtering (owner, status, cluster).
- `GET /api/stats`.

### Milestone 5: Duplicate clustering

- On import, detect exact-hash matches across users.
- Create / update duplicate clusters.
- Return cluster info in gem list and detail responses.

### Milestone 6: Update and delete

- `PATCH /api/gems/:id` (owner/admin).
- `DELETE /api/gems/:id` (owner only, with cluster cleanup).

### Deferred

- Near-duplicate detection via TF-IDF or embeddings (Phase 1 uses exact hash only).
- Review workflow endpoints (Phase 2).
- SPA static file serving (depends on SPA being built).
- Production deployment (Cloud Run, Dockerfile optimization, `cloudbuild.yaml`).

## 9. Success Criteria

### Must pass

1. `POST /api/gems/import` accepts a well-formed payload with a valid Bearer token, inserts gems into the database, and returns an import summary with correct counts.
2. Importing the same gem twice (same user, same instructions) does not create a duplicate row — it is counted as `skipped`.
3. Importing a gem whose instructions match another user's gem creates a duplicate cluster linking both.
4. `GET /api/gems` returns gems with pagination, and `?q=keyword` returns only gems matching the search term.
5. `GET /api/gems/:id` returns full gem details including duplicate cluster information.
6. All `/api/*` endpoints return 401 for unauthenticated requests and 403 for wrong-domain tokens.
7. The database schema is applied automatically on server startup if not already present.
8. `make api-start` brings up both PostgreSQL and the API server, and `curl http://localhost:9090/api/health` returns a success response.
9. `make api-stop` stops both containers, and data persists across stop/start cycles.

### Should pass

10. `GET /api/stats` returns correct org-wide counts.
11. `PATCH /api/gems/:id` allows the owner to update name/icon but not instructions.
12. `DELETE /api/gems/:id` removes the gem and updates the duplicate cluster's count.
13. The server handles database connection failures gracefully (503, not crash).
14. Import of 100 gems completes in under 5 seconds.
15. Code changes in `server/` are reflected immediately via `node --watch` without restarting containers.

## 10. Open Questions

### Q1: Express vs. Fastify

The spec recommends Express for ecosystem compatibility. If the team has strong Fastify preferences, the architecture supports either — the choice is in `server.js` setup only. All business logic is framework-agnostic.

**Recommendation:** Express.

### Q2: Migration tool

Should we use a library (`node-pg-migrate`, `knex`) or a minimal custom runner? A custom runner (read `.sql` files, track applied in a table) is ~50 lines and avoids a dependency. A library adds rollback support and a CLI for creating migrations.

**Recommendation:** Custom minimal runner for Phase 1. Switch to `node-pg-migrate` if rollback or team migration tooling becomes important.

### Q3: Near-duplicate detection in Phase 1

The architecture calls for TF-IDF cosine similarity, but this adds complexity. Phase 1 could ship with exact-hash-only dedup and add near-duplicate detection later.

**Recommendation:** Exact hash only in Phase 1. The duplicate cluster tables are in place and ready for near-duplicate matching when it's added.

### Q4: Soft delete vs. hard delete

Should `DELETE /api/gems/:id` mark the gem as deleted (soft) or remove the row (hard)? Soft delete preserves history but complicates queries. Hard delete is simpler but irreversible.

**Recommendation:** Hard delete for Phase 1. The import data originates from the user's Gemini account and can always be re-imported.

### Q5: Admin role

Some endpoints (user listing, status changes) may need admin-only access. How is admin determined? Options: hardcoded email list in env var, a column in the `users` table, or a Google Groups membership check.

**Recommendation:** Hardcoded `ADMIN_EMAILS` env var for Phase 1. Add a proper role system in Phase 2 with the review workflow.
