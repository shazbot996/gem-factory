---
type: spec
title: "Gem Factory API Server"
scope: Node.js backend API — authentication, gem ingestion, registry CRUD, search, deduplication, local Docker Compose development
date: 2026-04-15
---

## 1. Problem Statement

Gem Factory has a Chrome extension that extracts gem configurations from the Gemini web app (see `docs/specs/chrome-extension-gem-extractor-SPEC.md`), and a database schema designed for storing gems, users, and duplicate clusters (see `docs/context/ARCH.md` section 3.4). The backend service that connects these two is the API server: it accepts imported gems, normalizes and deduplicates them, stores them in PostgreSQL, and serves them to the SPA for browsing and search.

Without the API server:
- Extracted gems stay in `chrome.storage.local` with no way to share them across users or persist them centrally.
- There is no search, no duplicate detection, and no organizational visibility into what gems exist.
- The entire value proposition of Gem Factory — a shared, searchable gem registry — is unrealized.

The API server is the bridge between extraction (browser-side) and the registry (database-side).

## 2. Goals & Non-Goals

### Goals

- Accept gem imports from the SPA (and eventually directly from the extension) via a REST endpoint, process them (normalize, hash, deduplicate), and store them in PostgreSQL.
- Authenticate all requests using Google ID tokens, restricting access to the corporate domain.
- Provide CRUD endpoints for gems and users, with full-text search and filtering.
- Detect exact duplicates via instruction hashing (SHA-256). Near-duplicate clustering tables exist in the schema but clustering logic is deferred.
- Serve the SPA's static assets alongside the API from a single service.
- Run locally via Docker Compose with `make api-start` / `make api-stop`.
- Apply the database schema on startup via a migration mechanism.

### Non-Goals

- **Building the SPA.** The frontend is a separate spec. This spec covers only the API and the static file serving.
- **Review workflows (Phase 2).** The `status` column exists in the schema but no review state transitions are built here.
- **Gem-to-Enterprise-Agent promotion (Phase 3).** Entirely out of scope.
- **Drive API metadata enrichment.** Optional per the architecture; not included in Phase 1.
- **Embedding-based semantic similarity.** Phase 1 uses SHA-256 exact-match hashing only. Near-duplicate clustering and Vertex AI embeddings are future enhancements.
- **Production deployment (Cloud Run, CI/CD).** This spec covers local development only. Production infrastructure is a separate concern.

## 3. Proposed Solution

Build a Node.js (Express) REST API server structured as a layered monolith per `ARCH.md` section 3.3. For local development, the server runs via Docker Compose and connects to an external PostgreSQL database, controlled through Makefile targets.

**Why Express over Fastify:** Express has a larger ecosystem for middleware (especially Google auth libraries), wider team familiarity in corporate Node.js environments, and the performance difference is negligible at this traffic volume (internal corporate tool, periodic imports, casual browsing).

**Why Docker Compose for local dev:** It provides a reproducible container environment for the API server with `node --watch` live reload. The `make db-init` / `.db-config` workflow configures the external database connection, and the Makefile constructs `DATABASE_URL` from these credentials before passing it to Docker Compose.

**Why a single service:** Per `ARCH.md` section 8.3, splitting the API and SPA serving adds deployment complexity with no benefit at the expected scale. If similarity computation becomes expensive later, it can be extracted to a worker without changing the API surface.

### Key workflow

1. User extracts gems via the Chrome extension (v0.10.0).
2. User opens the Gem Factory SPA, authenticates via Google Identity Services.
3. SPA requests gems from the extension via `chrome.runtime.sendMessage` (`GET_GEMS`).
4. SPA displays a preview. User confirms import.
5. SPA sends `POST /api/gems/import` with the gems array and a Bearer ID token.
6. Server validates the token, upserts the user, normalizes gem text, hashes instructions, inserts or updates gems, and returns an import summary.
7. User browses the registry via `GET /api/gems` with search and filter parameters.

## 4. Technical Design

### 4.1 Directory Structure

```
gem-factory/
  docker-compose.yml          # Local dev: API server (single service)
  server/
    Dockerfile                # Node.js container for the API server
    package.json
    server.js                 # Entry point — configures Express, CORS, mounts routes, SPA fallback
    middleware/
      auth.js                 # Google ID token validation, domain check, dev bypass
      admin.js                # Admin email check via ADMIN_EMAILS env var
    routes/
      gems.js                 # /api/gems/* endpoints
      users.js                # /api/users/* endpoints
      stats.js                # /api/stats endpoint
    services/
      ingestion.js            # Normalize, hash, upsert, store
      search.js               # Full-text search query builder (unused — search is inline in db/gems.js)
    db/
      pool.js                 # pg Pool setup (reads DATABASE_URL)
      migrate.js              # Lightweight migration runner
      migrations/
        001_initial_schema.sql  # users, gems, duplicate_clusters, duplicate_cluster_members
        002_add_gem_metadata.sql  # description, gemini_id, knowledge_files, default_tools, extracted_at
      gems.js                 # Gem repository (queries)
      users.js                # User repository (queries)
    test/
      api.test.js             # API endpoint tests
      auth.test.js            # Auth middleware tests
      ingestion.test.js       # Ingestion service tests
    public/                   # SPA production build (output of `make spa-build`)
```

### 4.1.1 Docker Compose Configuration

The `docker-compose.yml` at the project root defines a single `api` service. PostgreSQL runs on a separate external server (e.g., `branch.local`), not inside Docker.

```yaml
services:
  api:
    build: ./server
    ports:
      - "9090:9090"
    environment:
      PORT: "9090"
      DATABASE_URL: "${DATABASE_URL}"
      GOOGLE_CLIENT_ID: "${GOOGLE_CLIENT_ID:-}"
      ALLOWED_DOMAIN: "${ALLOWED_DOMAIN:-}"
      ADMIN_EMAILS: "${ADMIN_EMAILS:-charles.schiele@gmail.com}"
      NODE_ENV: development
    volumes:
      - ./server:/app
      - /app/node_modules
    command: node --watch server.js
```

Key design decisions:

- **Port 9090** for the API — a high port that avoids conflicts with common local services (3000, 5000, 8080). The SPA proxies API calls to this port during development.
- **External PostgreSQL** — the database runs on a separate server, configured via `make db-init` and `.db-config`. The Makefile constructs `DATABASE_URL` from `.db-config` and passes it to Docker Compose.
- **`node --watch`** — Node.js 18+ built-in file watcher restarts the server on code changes. No dependency on `nodemon`.
- **Bind-mount `./server:/app`** — source code changes are reflected immediately in the container without rebuilding.
- **`/app/node_modules` anonymous volume** — prevents the host's `node_modules` (if any) from clobbering the container's installed dependencies.
- **`GOOGLE_CLIENT_ID`, `ALLOWED_DOMAIN`, and `ADMIN_EMAILS`** are passed through from the host environment. In local development without Google auth configured, the auth middleware runs in bypass mode (see section 4.2).

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

The Makefile at the project root includes these API-related targets:

**`make api-start`** — Reads `.db-config`, constructs `DATABASE_URL`, then builds and starts the API container.

```makefile
api-start: ## Start the API server (Docker Compose, DB via .db-config)
	@if [ ! -f $(DB_CONFIG) ]; then \
	   echo "Error: $(DB_CONFIG) not found. Run 'make db-init' first."; \
	   exit 1; \
	 fi
	@. $(DB_CONFIG) && \
	 export DATABASE_URL="postgresql://$$DB_USER:$$DB_PASS@$$DB_HOST:$$DB_PORT/$$DB_NAME" && \
	 docker compose up -d --build
```

**`make api-stop`** — Stops the API container.

```makefile
api-stop: ## Stop the API server
	docker compose down
```

Additional targets:
- **`make api-test`** — `docker compose exec api node --test test/`
- **`make api-logs`** — `docker compose logs -f api`

All are in the `.PHONY` list. The `api-start` target uses `--build` so that `Dockerfile` or `package.json` changes are picked up automatically.

### 4.1.4 Database Configuration via `db-init`

The `make db-init` target interactively collects database connection parameters and saves them to `.db-config` (gitignored). The `make api-start` target sources this file and constructs `DATABASE_URL` from it. This allows connecting to any PostgreSQL instance — a local installation, a remote server, or a cloud database.

`make db-test` verifies connectivity and privileges against the configured database.

### 4.2 Authentication

All `/api/*` endpoints (except `/api/health`) require authentication.

The `middleware/auth.js` module:
1. Extracts the Bearer token from the `Authorization: Bearer <token>` header.
2. Verifies it using `google-auth-library`'s `OAuth2Client.verifyIdToken()` with the configured `GOOGLE_CLIENT_ID`.
3. Checks the `hd` (hosted domain) claim matches `ALLOWED_DOMAIN` (if set).
4. Extracts `email` and `name` from the token payload, attaches them to `req.user`.
5. Returns 401 for missing/invalid tokens, 403 for wrong domain.

**Development bypass mode:** When `GOOGLE_CLIENT_ID` is empty (the default in the Docker Compose config), the auth middleware skips token validation and uses a default dev user (`req.user = { email: 'dev@localhost', name: 'Dev User' }`). This allows testing the API with `curl` or any HTTP client without configuring Google OAuth. A header `X-Dev-User-Email` can optionally override the dev email for testing multi-user scenarios.

**Admin middleware (`middleware/admin.js`):** Reads `ADMIN_EMAILS` from the environment (default: `charles.schiele@gmail.com`), a comma-separated list. Exports `isAdmin(email)` (used by `routes/gems.js` for inline authorization checks) and `requireAdmin` middleware (for protecting entire routes). Admin status controls who can change gem status and who can delete gems they don't own.

### 4.3 Gem Import Pipeline (`POST /api/gems/import`)

This is the most complex endpoint. The ingestion flow:

1. **Validate payload.** Expect `{ gems: [{ name, instructions, description?, icon?, source?, geminiId?, knowledgeFiles?, defaultTools?, extractedAt? }] }`. Reject if `gems` is empty or any gem is missing `name` or `instructions`. Max 100 gems per request. Instructions max 100KB.
2. **Upsert user.** Find or create the user by email (from the auth token). Update `display_name` if provided.
3. **For each gem:**
   a. **Normalize instructions.** Trim whitespace, collapse multiple blank lines (3+ newlines → 2), normalize line endings to `\n`.
   b. **Hash instructions.** SHA-256 of the normalized text → `instruction_hash`.
   c. **Upsert gem.** Insert into `gems` table with `ON CONFLICT (owner_id, instruction_hash) DO UPDATE` — this updates name, description, icon, gemini_id, knowledge_files, default_tools, extracted_at, and updated_at if the gem already exists. The `(xmax = 0) AS inserted` return value distinguishes new inserts from updates.
4. **Update timestamps.** If any gems were imported or updated, set `last_import_at` (and `first_import_at` if null) on the user.
5. **Return summary.** `{ imported: N, updated: N, skipped: N, importedIds: [...] }`.

### 4.4 Registry Endpoints

**`GET /api/gems`** — List and search gems.

Query parameters:
| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Full-text search across name, description, and instructions |
| `owner` | string | Filter by owner email |
| `status` | string | Filter by status (default: all) |
| `page` | int | Page number (default: 1) |
| `limit` | int | Results per page (default: 20, max: 100) |

Full-text search uses PostgreSQL's `search_vector @@ plainto_tsquery('english', $q)` with `ts_rank` ordering. Without a search query, results are ordered by `imported_at DESC`.

Response shape:
```json
{
  "gems": [
    {
      "id": "uuid",
      "name": "Code Reviewer",
      "description": "Reviews code for quality",
      "instructions": "You are an expert...",
      "icon": "code",
      "source": "extension",
      "status": "imported",
      "geminiId": "abc123",
      "knowledgeFiles": [{ "name": "style-guide.pdf", "type": "pdf", "mimeType": "application/pdf", "driveId": "...", "driveUrl": "..." }],
      "defaultTools": ["Code execution"],
      "owner": { "id": "uuid", "email": "user@corp.com", "displayName": "..." },
      "importedAt": "2026-04-05T...",
      "updatedAt": "2026-04-05T...",
      "extractedAt": "2026-04-05T...",
      "duplicateCluster": null
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 142 }
}
```

Note: `duplicateCluster` is always `null` — clustering logic is deferred.

**`GET /api/gems/:id`** — Single gem with full details.

**`PATCH /api/gems/:id`** — Update gem metadata. Only the owner or an admin may update. Updatable fields: `name`, `description`, `icon`, `status` (admin only). Instructions are immutable after import (changing them changes the gem's identity).

**`DELETE /api/gems/:id`** — Hard delete. Owner or admin only. Returns 204 on success.

### 4.5 User Endpoints

**`GET /api/users/me`** — Current user profile (email, display name, gem count, first/last import timestamps). If the user has not yet imported any gems, returns basic info from the auth token with `gemCount: 0`.

**`GET /api/users`** — List all users who have imported gems, with gem counts. Sorted by gem count descending. Useful for the registry UI's owner filter dropdown.

### 4.6 Statistics Endpoint

**`GET /api/stats`** — Org-wide numbers, computed via three parallel SQL queries:
```json
{
  "totalGems": 347,
  "uniqueGems": 298,
  "totalUsers": 42,
  "duplicateClusters": 0,
  "topClusters": []
}
```

Note: `duplicateClusters` is hardcoded to `0` and `topClusters` to `[]` — clustering logic is deferred. `uniqueGems` counts distinct `instruction_hash` values.

### 4.7 Database Schema & Migrations

Two migrations exist:

**`001_initial_schema.sql`** — Creates the core tables:
- `users` — id (UUID), email (UNIQUE), display_name, first_import_at, last_import_at, created_at.
- `gems` — id (UUID), owner_id (FK → users), name, instructions, icon, source, instruction_hash, status, imported_at, updated_at, search_vector (TSVECTOR, GENERATED ALWAYS, STORED).
- `duplicate_clusters` — schema created for future use, no runtime logic in Phase 1.
- `duplicate_cluster_members` — schema created for future use.
- Indexes: `idx_gems_owner`, `idx_gems_hash`, `idx_gems_search` (GIN), `idx_gems_owner_hash` (UNIQUE — enables the upsert).

**`002_add_gem_metadata.sql`** — Adds columns captured by Chrome extension v0.9.7+:
- `description` (TEXT), `gemini_id` (TEXT), `knowledge_files` (JSONB, default `'[]'`), `default_tools` (TEXT[], default `'{}'`), `extracted_at` (TIMESTAMPTZ).
- Recreates `search_vector` to include `description` at weight B alongside `instructions`.
- Recreates the GIN index on the new search vector.

The migration runner (`db/migrate.js`):
1. Creates a `schema_migrations` table if it doesn't exist.
2. Reads `.sql` files from `db/migrations/`, sorted by filename.
3. Applies any migrations not yet recorded in `schema_migrations`, each wrapped in a transaction.
4. Runs on server startup before accepting requests. If a migration fails, the server exits.

### 4.8 Database Connection

`db/pool.js` reads the `DATABASE_URL` environment variable. For local development, the Makefile constructs this from `.db-config` (created by `make db-init`) and passes it to Docker Compose. A future production deployment will set `DATABASE_URL` via Cloud Run environment config or Secret Manager.

No fallback to `.db-config` is needed in the server code — environment variables are the single mechanism.

### 4.9 Static File Serving and CORS

**SPA serving:** If the `server/public/` directory exists (populated by `make spa-build`), `server.js` serves it as static files and implements SPA fallback — all non-API GET routes return `index.html`. If no `public/` directory exists, `GET /` returns `{ service: 'gem-factory', status: 'ok' }`.

**CORS:** `server.js` includes inline CORS middleware allowing these origins:
- `http://localhost:3000` (SPA dev server)
- `http://localhost:5173` (Vite default port)
- `chrome-extension://*` (Chrome extension)

Allowed methods: GET, POST, PATCH, DELETE, OPTIONS. Allowed headers: Content-Type, Authorization, X-Dev-User-Email.

## 5. UI / UX

No direct UI is built in this spec — the API server is headless. The SPA spec (`docs/specs/spa-frontend-SPEC.md`) defines the user-facing interface. However, the API design directly shapes the SPA's UX:

- The import endpoint returns structured summaries so the SPA can show "3 imported, 2 updated, 1 skipped."
- The search endpoint supports full-text search so the SPA can offer a search box.
- The gems list endpoint supports pagination and filtering so the SPA can offer browse/filter views.

## 6. Integration Points

### 6.1 Chrome Extension → SPA → API Server

The extension stores gems in `chrome.storage.local`. The SPA retrieves them via `chrome.runtime.sendMessage(EXTENSION_ID, { type: 'GET_GEMS' })` (implemented in `extension/background.js`). After the user confirms import, the SPA sends `POST /api/gems/import`. After successful import, the SPA clears the extension storage via `{ type: 'CLEAR_GEMS' }`.

### 6.2 Database

The server connects to PostgreSQL via the `pg` npm package using the `DATABASE_URL` environment variable. In local development, this connects to an external PostgreSQL server configured via `.db-config`. Future production deployment will use Cloud SQL Auth Proxy or IAM database authentication.

### 6.3 Google Cloud Identity

The `google-auth-library` npm package validates ID tokens. The server never initiates OAuth flows — that's the SPA's job. The server only validates tokens it receives.

### 6.4 Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `PORT` | Yes | 9090 | Server listen port (set by Compose, or Cloud Run in prod) |
| `DATABASE_URL` | Yes | Constructed by Makefile from `.db-config` | PostgreSQL connection string |
| `GOOGLE_CLIENT_ID` | No (dev) / Yes (prod) | — | OAuth client ID for token validation. If empty in dev, auth middleware runs in bypass mode |
| `ALLOWED_DOMAIN` | No (dev) / Yes (prod) | — | Corporate domain for `hd` claim check. If empty in dev, domain check is skipped |
| `ADMIN_EMAILS` | No | `charles.schiele@gmail.com` | Comma-separated list of admin email addresses |
| `NODE_ENV` | No | development | Set by Docker Compose |

## 7. Edge Cases & Error Handling

### 7.1 Import Edge Cases

| Condition | Behavior |
|-----------|----------|
| Gem with empty instructions | Reject with 400: "instructions must not be empty" |
| Gem with very long instructions (>100KB) | Reject with 400: "instructions exceed maximum length" |
| Same-user re-import (same instruction hash) | Upsert — updates metadata fields (name, description, icon, etc.), counted in `updated` |
| Import request with >100 gems | Reject with 400: "Maximum 100 gems per import" |
| User imports the same gem twice in rapid succession | `ON CONFLICT DO UPDATE` handles this atomically — no race condition |

### 7.2 Auth Edge Cases

| Condition | Behavior |
|-----------|----------|
| Missing `Authorization` header | 401 with `{ error: "Authentication required" }` |
| Invalid or expired token | 401 with `{ error: "Invalid or expired token" }` |
| Valid token, wrong domain | 403 with `{ error: "Access restricted to <ALLOWED_DOMAIN>" }` |
| Valid token, user not in `users` table | Auto-create user on first import via upsert |

### 7.3 Database Errors

| Condition | Behavior |
|-----------|----------|
| Database unreachable on startup | Migration fails, server logs error and exits (`process.exit(1)`) |
| Database unreachable during request | Return 500 with `{ error: "Internal server error" }` |
| Migration fails | Server refuses to start, logs the error |
| Constraint violation (unexpected) | Return 500, log full error server-side, return generic error to client |

A global error handler in `server.js` catches unhandled errors and returns 500.

### 7.4 Concurrency

- In production, multiple instances may run concurrently. All state is in PostgreSQL — no in-memory coordination needed. (Locally, Docker Compose runs a single API instance.)
- The `ON CONFLICT` clause on `(owner_id, instruction_hash)` prevents duplicate inserts without locking.

## 8. Scope & Milestones

### Milestone 1: Server skeleton with Docker Compose ✓

- `docker-compose.yml`, `server/Dockerfile`, `server/package.json`.
- Express app, health check endpoint (`GET /api/health`), auth middleware (with dev bypass), CORS middleware.
- Database connection pool via `DATABASE_URL`.
- Makefile targets: `make api-start`, `make api-stop`, `make api-test`, `make api-logs`.
- Server starts, connects to PostgreSQL, and responds to health checks.

### Milestone 2: Schema migration and user management ✓

- Migration runner, `001_initial_schema.sql` and `002_add_gem_metadata.sql` applied on startup.
- `GET /api/users/me` and auto-create user on first import.
- `GET /api/users` listing with gem counts.

### Milestone 3: Gem import ✓

- `POST /api/gems/import` with validation, normalization, hashing, upsert.
- `GET /api/gems` with pagination.
- `GET /api/gems/:id`.

### Milestone 4: Search and filtering ✓

- Full-text search via `search_vector`.
- Query parameter filtering (owner, status).
- `GET /api/stats`.

### Milestone 5: Update and delete ✓

- `PATCH /api/gems/:id` (owner/admin, with admin-only status changes).
- `DELETE /api/gems/:id` (owner or admin, hard delete).

### Milestone 6: SPA static file serving ✓

- Serve `server/public/` as static files with SPA fallback.
- Production build via `make spa-build` outputs to `server/public/`.

### Deferred

- Near-duplicate detection and duplicate clustering (tables exist, logic not implemented).
- Review workflow endpoints (Phase 2).
- Production deployment (Cloud Run, Dockerfile optimization, `cloudbuild.yaml`).

## 9. Success Criteria

### Must pass

1. `POST /api/gems/import` accepts a well-formed payload with a valid Bearer token, inserts gems into the database, and returns an import summary with correct counts (`imported`, `updated`, `skipped`, `importedIds`).
2. Importing the same gem twice (same user, same instructions) upserts — updating metadata fields and counting in `updated`.
3. `GET /api/gems` returns gems with pagination, and `?q=keyword` returns only gems matching the search term.
4. `GET /api/gems/:id` returns full gem details including metadata fields (description, knowledgeFiles, defaultTools, extractedAt).
5. All `/api/*` endpoints return 401 for unauthenticated requests and 403 for wrong-domain tokens.
6. The database schema is applied automatically on server startup if not already present.
7. `make api-start` brings up the API server, and `curl http://localhost:9090/api/health` returns a success response.
8. `make api-stop` stops the container.

### Should pass

9. `GET /api/stats` returns correct org-wide counts (totalGems, uniqueGems, totalUsers).
10. `PATCH /api/gems/:id` allows the owner to update name/description/icon but not instructions. Only admins can change status.
11. `DELETE /api/gems/:id` removes the gem (hard delete). Owner or admin only.
12. Import of 100 gems completes in under 5 seconds.
13. Code changes in `server/` are reflected immediately via `node --watch` without restarting containers.

## 10. Open Questions (Resolved)

### Q1: Express vs. Fastify

**Resolved:** Express. Implemented in `server.js`.

### Q2: Migration tool

**Resolved:** Custom minimal runner (`db/migrate.js`, ~50 lines). Reads `.sql` files, tracks applied in `schema_migrations` table, wraps each in a transaction.

### Q3: Near-duplicate detection in Phase 1

**Resolved:** Exact hash only. The `duplicate_clusters` and `duplicate_cluster_members` tables exist in the schema but no runtime logic uses them. `duplicateCluster` is returned as `null` in all gem responses.

### Q4: Soft delete vs. hard delete

**Resolved:** Hard delete (`DELETE FROM gems WHERE id = $1`). The import data originates from the user's Gemini account and can always be re-imported.

### Q5: Admin role

**Resolved:** `ADMIN_EMAILS` env var (comma-separated, default: `charles.schiele@gmail.com`). Implemented in `middleware/admin.js`. The `isAdmin(email)` function is used inline in `routes/gems.js` for PATCH and DELETE authorization.
