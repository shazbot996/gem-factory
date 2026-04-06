---
type: arch
title: Gem Factory — Central Gem Registry Architecture
scope: Full application (Phase 1 build, Phases 2–3 future-proofing)
date: 2026-04-05
---

## 1. Overview

Gem Factory is a central registry service for Google Gemini gem configurations across a corporate Google Cloud organization. It allows users to import their personal Gemini gems into a shared catalog, enabling the organization to discover what gems exist, eliminate duplicates, and identify candidates for promotion to full Gemini Enterprise agents. The system runs as a Cloud Run service with a browser-based Node.js frontend, authenticating users via corporate Google Cloud Identity.

**Architectural style:** Layered monolith deployed as a single Cloud Run service. The frontend is a single-page application (SPA) served by the same service that hosts the API. This keeps deployment simple for Phase 1 while the user base is the internal corporate org. The architecture uses a clean separation between the gem ingestion layer (which must cope with the absence of an official Gemini gems API) and the registry/catalog layer (standard CRUD + search).

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Browser (SPA)                       │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  Auth UI  │  │ Gem Import   │  │ Registry Browser  │  │
│  │  (GSIS)   │  │ Flow         │  │ & Search          │  │
│  └──────────┘  └──────────────┘  └───────────────────┘  │
│                        │                                 │
│  ┌─────────────────────┴───────────────────────────┐     │
│  │         Chrome Extension (Gem Extractor)         │     │
│  │  content script on gemini.google.com             │     │
│  └─────────────────────────────────────────────────┘     │
└────────────────────────┬────────────────────────────────┘
                         │ HTTPS (REST JSON)
┌────────────────────────▼────────────────────────────────┐
│                  Cloud Run Service                        │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Auth      │  │ Gem Ingestion│  │ Registry API      │  │
│  │ Middleware│──│ Service      │  │ (CRUD + Search)   │  │
│  └──────────┘  └──────┬───────┘  └────────┬──────────┘  │
│                        │                   │             │
│                ┌───────▼───────────────────▼──────┐      │
│                │         Data Access Layer         │      │
│                └───────────────┬──────────────────┘      │
└────────────────────────────────┬─────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │    Cloud SQL (PostgreSQL) │
                    │    or Firestore           │
                    └──────────────────────────┘
```

### Major components and their relationships

1. **Chrome Extension (Gem Extractor)** — Runs in the user's browser on `gemini.google.com`. Extracts gem configurations (name, instructions, metadata) from the Gemini web app's internal data structures. Communicates extracted data to the SPA via `chrome.runtime.sendMessage` or a shared `window.postMessage` channel.

2. **Frontend SPA** — Node.js/TypeScript application (React or similar). Handles authentication, presents the gem import flow, and provides the registry browsing/search interface. Served as static assets from the Cloud Run service.

3. **Cloud Run Backend API** — Express.js or Fastify server. Three logical layers:
   - **Auth middleware** — Validates Google Identity tokens, enforces corporate domain restrictions.
   - **Gem Ingestion Service** — Accepts gem payloads from the frontend, normalizes them, deduplicates, and stores them.
   - **Registry API** — CRUD operations on the gem catalog, search, filtering, user-scoped views.

4. **Database** — Stores gem definitions, ownership metadata, import history, and (future) review/workflow state.

### Dependency direction

Chrome Extension → SPA → Backend API → Database. No reverse dependencies. The backend never calls back to the extension or frontend.

## 3. Component Deep-Dive

### 3.1 Chrome Extension (Gem Extractor)

**Purpose:** Bridge the gap left by the absence of an official Gemini gems API. This is the critical piece that makes the entire system viable.

**Why a Chrome extension (and not alternatives):**

There is **no official Google API** for reading gem configurations. The Gemini app explicitly has no API. The options evaluated:

| Approach | Accesses gem instructions? | Viable? |
|----------|---------------------------|---------|
| Official Gemini API | No API exists | No |
| Google Drive API (MIME type filter) | Shared gems only; opaque format, no instructions | Metadata only |
| Reverse-engineered `gemini-webapi` Python library | Yes, but requires browser cookies, fragile | Server-side: impractical |
| Chrome extension intercepting Gemini web app | Yes, full gem data | **Best option** |
| Manual copy-paste by users | Yes, but terrible UX | Fallback only |

The Chrome extension is the recommended primary path because:
- It runs in the user's authenticated browser session — no credential forwarding needed.
- It can observe the Gemini web app's internal API calls (the `/_/BardChatUi` RPC endpoints) and extract gem data from responses.
- It can alternatively read gem data from the DOM when the user navigates to their gems management page.
- The user explicitly installs it and triggers extraction — transparent, no surveillance concern.
- If Google changes internal APIs, only the extension needs updating — the rest of the system is unaffected.

**Internal structure:**

- `manifest.json` — Manifest V3, permissions for `gemini.google.com`, `storage`, connection to the Gem Factory SPA origin.
- `content-script.js` — Injected on `gemini.google.com/gems`. Observes the page for gem data. Two extraction strategies:
  - **DOM extraction:** Parse gem cards from the gems management page (name, description visible in UI).
  - **Network interception:** Use a `chrome.webRequest` listener or injected `fetch` wrapper to capture internal API responses that contain full gem instruction text.
- `background.js` — Service worker. Manages communication between the content script and the Gem Factory web app. Stores extracted gems temporarily in `chrome.storage.local`.
- `popup.html` — Minimal UI showing extraction status and a "Send to Gem Factory" button.

**Dependencies:** None on the backend. Communicates with the SPA via `chrome.runtime.sendMessage` (if SPA triggers extraction) or by posting to a known Gem Factory URL with the extracted payload.

**Fallback path:** If the extension approach proves too fragile or adoption is low, the system also supports a **manual import** mode where users paste gem configurations (name + instructions) into a form in the SPA. The backend accepts the same payload shape regardless of source.

### 3.2 Frontend SPA

**Purpose:** The user-facing application for authentication, gem import, and registry browsing.

**Key entry points:**

- `/` — Landing page. If unauthenticated, shows sign-in. If authenticated, shows dashboard with user's imported gems and org-wide stats.
- `/import` — Gem import flow. Detects Chrome extension presence, triggers extraction, shows preview of discovered gems, allows user to confirm import (batch or selective).
- `/registry` — Browse all gems in the org. Search by keyword, filter by owner, function/intent, duplicate cluster.
- `/gems/:id` — Detail view for a single gem. Shows instructions, owner, import date, duplicate candidates.

**Internal structure (suggested directory layout):**

```
frontend/
  src/
    auth/           # Google Identity Services integration
    import/         # Gem import flow components
    registry/       # Browse/search/filter components
    api/            # Backend API client (fetch wrappers)
    extension/      # Chrome extension communication bridge
    components/     # Shared UI components
```

**Auth integration:** Uses Google Identity Services (GIS) library for browser-based OAuth 2.0. The SPA obtains an ID token scoped to the corporate domain, which is sent as a Bearer token on all API calls. No refresh tokens are stored client-side — GIS handles silent re-auth.

**Extension communication:** The SPA detects the extension via `chrome.runtime.sendMessage` to the known extension ID. If the extension is not installed, the import page falls back to the manual import form and shows a prompt to install the extension.

### 3.3 Backend API (Cloud Run Service)

**Purpose:** Serves the SPA static assets, hosts the REST API, and manages all persistent state.

**Key modules:**

- **`server.js`** — Application entry point. Configures Express/Fastify, mounts middleware, registers routes.
- **`middleware/auth.js`** — Validates Google ID tokens using the `google-auth-library` package. Verifies the token's `hd` (hosted domain) claim matches the corporate domain. Extracts user email and attaches it to the request context.
- **`routes/gems.js`** — REST endpoints for gem CRUD:
  - `POST /api/gems/import` — Batch import endpoint. Accepts an array of gem payloads.
  - `GET /api/gems` — List gems with pagination, search, and filters (owner, keyword, duplicate cluster).
  - `GET /api/gems/:id` — Single gem detail.
  - `PATCH /api/gems/:id` — Update gem metadata (admin or owner only).
  - `DELETE /api/gems/:id` — Remove a gem from the registry (owner only).
- **`routes/users.js`** — User-related endpoints:
  - `GET /api/users/me` — Current user profile and their gem count.
  - `GET /api/users` — List users who have contributed gems (admin view).
- **`services/ingestion.js`** — Business logic for processing incoming gem data: normalization (trim whitespace, standardize instruction formatting), fingerprinting for duplicate detection, ownership assignment.
- **`services/similarity.js`** — Duplicate/similarity detection. Computes a similarity score between gem instructions using a combination of exact-match fingerprinting (hash of normalized instructions) and fuzzy matching (TF-IDF or embedding-based cosine similarity for near-duplicates).
- **`services/search.js`** — Full-text search over gem names and instructions. Uses PostgreSQL `tsvector` full-text search or Firestore's built-in text search.
- **`db/`** — Data access layer. Repository pattern isolating database queries from business logic.

**Dependencies:** `google-auth-library`, `pg` (if PostgreSQL) or `@google-cloud/firestore`, `express` or `fastify`.

### 3.4 Database

**Purpose:** Persistent store for all gem data, user metadata, and (future) workflow state.

**Recommended: Cloud SQL for PostgreSQL.** Rationale:
- Gems are structured, relational data (gems belong to users, duplicates form clusters).
- Full-text search on instructions is a core requirement — PostgreSQL's `tsvector`/`tsquery` handles this natively.
- Phase 2 adds review workflows with state machines — relational integrity matters.
- Phase 3 needs transactional writes when promoting gems to Enterprise agents.
- Firestore would work for Phase 1 but becomes awkward for the relational queries in Phases 2–3.

**Schema (core tables):**

```sql
-- Users who have imported gems
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT UNIQUE NOT NULL,       -- corporate email
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
    instructions    TEXT NOT NULL,              -- the system prompt
    icon            TEXT,                       -- icon identifier
    source          TEXT NOT NULL DEFAULT 'extension', -- 'extension' | 'manual' | 'drive_api'
    instruction_hash TEXT NOT NULL,             -- SHA-256 of normalized instructions (exact dedup)
    status          TEXT NOT NULL DEFAULT 'imported', -- Phase 2: 'imported' | 'under_review' | 'approved' | 'promoted'
    imported_at     TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    -- Full-text search vector
    search_vector   TSVECTOR GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(instructions, '')), 'B')
    ) STORED
);

CREATE INDEX idx_gems_owner ON gems(owner_id);
CREATE INDEX idx_gems_hash ON gems(instruction_hash);
CREATE INDEX idx_gems_search ON gems USING GIN(search_vector);

-- Duplicate clusters (groups of similar gems)
CREATE TABLE duplicate_clusters (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    representative_gem_id UUID REFERENCES gems(id),
    gem_count       INT DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE duplicate_cluster_members (
    cluster_id      UUID REFERENCES duplicate_clusters(id),
    gem_id          UUID REFERENCES gems(id),
    similarity_score FLOAT,                    -- 0.0 to 1.0
    PRIMARY KEY (cluster_id, gem_id)
);

-- Phase 2: Review workflow (placeholder, not built in Phase 1)
-- CREATE TABLE reviews ( ... );

-- Phase 3: Promotion tracking (placeholder)
-- CREATE TABLE promotions ( ... );
```

### 3.5 Supplementary: Drive API Metadata Enrichment (Optional)

**Purpose:** Supplement extension-based extraction with metadata from the Google Drive API for shared gems.

Using a service account with domain-wide delegation, the backend can periodically query the Drive API for files with `mimeType='application/vnd.google-gemini.gem'` across the organization. This provides:
- Discovery of shared gems even if the user hasn't installed the extension.
- Metadata enrichment: sharing permissions, last modified timestamps, Drive file IDs.

This is a **complement** to extension-based extraction, not a replacement — Drive API cannot read gem instructions, only metadata. But it gives the system awareness of gems that exist even before users actively import them.

## 4. Data Flow

### 4.1 Primary Flow: Gem Import via Chrome Extension

```
User navigates to         User opens Gem Factory      Backend processes
gemini.google.com/gems    and clicks "Import"         and stores
        │                         │                        │
        ▼                         ▼                        ▼
┌──────────────┐    ┌──────────────────┐    ┌─────────────────────┐
│ Extension     │    │ SPA sends        │    │ Ingestion service:  │
│ content script│───▶│ extracted gems   │───▶│ 1. Normalize text   │
│ reads gem data│    │ to POST          │    │ 2. Hash instructions│
│ from page DOM │    │ /api/gems/import │    │ 3. Check duplicates │
│ or network    │    │                  │    │ 4. Assign to user   │
│ responses     │    │                  │    │ 5. Insert to DB     │
└──────────────┘    └──────────────────┘    │ 6. Update clusters  │
                                            └─────────────────────┘
```

**Step-by-step:**

1. User installs the Gem Factory Chrome Extension from the corporate Chrome Web Store.
2. User navigates to `gemini.google.com` and opens their gems page.
3. The extension's content script detects the gems page and extracts gem data (name, instructions) from the page's internal data structures or network responses.
4. The extension stores extracted gems in `chrome.storage.local` and shows a badge count.
5. User opens the Gem Factory SPA (`gem-factory.corp.example.com`).
6. SPA authenticates user via Google Identity Services (ID token).
7. SPA detects the extension and requests the extracted gem data via `chrome.runtime.sendMessage`.
8. SPA displays the gems in a preview screen. User confirms import (all or selected).
9. SPA sends `POST /api/gems/import` with the gem payloads and the user's Bearer token.
10. Backend validates the token, normalizes gem instructions, computes instruction hashes.
11. For each gem: check `instruction_hash` against existing gems. If exact match exists from the same user, skip. If match from another user, link to the existing duplicate cluster.
12. For near-duplicates: run similarity comparison against existing gems. If above threshold (e.g., 0.85), add to or create a duplicate cluster.
13. Insert new gems into the `gems` table. Update `duplicate_clusters` and `duplicate_cluster_members`.
14. Return import summary to the SPA (imported count, duplicate count, skipped count).

### 4.2 Secondary Flow: Manual Gem Import

For users who prefer not to install the extension:

1. User navigates to the Gem Factory SPA → `/import` → "Manual Import" tab.
2. User pastes gem name and instructions into a form (one gem at a time, or a structured JSON/YAML paste for batch).
3. SPA sends the same `POST /api/gems/import` payload.
4. Backend processes identically to the extension flow.

### 4.3 Registry Search Flow

1. User navigates to `/registry`.
2. SPA sends `GET /api/gems?q=<search>&owner=<email>&status=<status>&page=<n>`.
3. Backend executes a PostgreSQL full-text search query using `search_vector @@ plainto_tsquery(...)`.
4. Results are returned with pagination metadata, duplicate cluster IDs, and owner info.
5. SPA renders gem cards with duplicate indicators (e.g., "3 similar gems found").

## 5. Control Flow & Lifecycle

### 5.1 Application Startup

1. Cloud Run receives the first request (cold start) or scales from zero.
2. `server.js` initializes:
   - Loads environment configuration (`DATABASE_URL`, `GOOGLE_CLIENT_ID`, `ALLOWED_DOMAIN`).
   - Establishes a database connection pool (pg `Pool` with Cloud SQL connector).
   - Runs pending database migrations (using a lightweight migration tool like `node-pg-migrate`).
   - Mounts middleware: CORS, JSON body parser, auth middleware, request logging.
   - Mounts route handlers.
   - Serves SPA static files from `frontend/build/`.
   - Starts listening on `PORT` (Cloud Run sets this, typically 8080).

### 5.2 Request Handling Cycle

1. Incoming HTTPS request hits Cloud Run's load balancer.
2. Express/Fastify routes the request.
3. For `/api/*` routes: auth middleware validates the Bearer token. Rejects with 401 if invalid or wrong domain.
4. Route handler invokes the appropriate service function.
5. Service function interacts with the database via the data access layer.
6. Response is returned as JSON.
7. For non-API routes: serves the SPA's `index.html` (client-side routing handles the rest).

### 5.3 Background Processes

Phase 1 has no long-running background jobs. Two operations that could become background tasks as scale increases:

- **Similarity computation:** On each import, near-duplicate detection runs synchronously. If the gem catalog grows large (>10,000 gems), this should be moved to a Cloud Tasks queue or a periodic batch job.
- **Drive API metadata sync:** If implemented, this runs as a scheduled Cloud Run job (Cloud Scheduler → HTTP trigger) that queries the Drive API across the org and upserts metadata records.

### 5.4 Shutdown

Cloud Run handles graceful shutdown via SIGTERM. The server should:
1. Stop accepting new connections.
2. Drain in-flight requests (Cloud Run allows 10 seconds by default).
3. Close the database connection pool.

## 6. State Management

### 6.1 Where state lives

| State | Location | Lifetime |
|-------|----------|----------|
| Gem configurations | Cloud SQL (PostgreSQL) | Persistent |
| User profiles | Cloud SQL | Persistent |
| Duplicate clusters | Cloud SQL | Persistent, recomputed on import |
| Authentication tokens | Browser memory (GIS library) | Session |
| Extracted gems (pre-import) | `chrome.storage.local` (extension) | Until import or cleared |
| DB connection pool | In-memory (Cloud Run instance) | Instance lifetime |

### 6.2 Concurrency

- Cloud Run can run multiple instances concurrently. Each instance has its own database connection pool.
- PostgreSQL handles concurrent writes. The `instruction_hash` index prevents exact duplicates via a `ON CONFLICT` clause.
- Duplicate cluster computation uses advisory locks or a serializable transaction to prevent race conditions when two users import similar gems simultaneously.
- No shared in-memory state between instances. All coordination happens through the database.

## 7. External Interfaces

### 7.1 REST API

All endpoints are prefixed with `/api`. Authentication is required for all endpoints.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/gems/import` | Import one or more gems. Body: `{ gems: [{ name, instructions, icon?, source? }] }` |
| `GET` | `/api/gems` | List/search gems. Query params: `q`, `owner`, `status`, `cluster_id`, `page`, `limit` |
| `GET` | `/api/gems/:id` | Get single gem with full details and duplicate cluster info |
| `PATCH` | `/api/gems/:id` | Update gem metadata (owner or admin) |
| `DELETE` | `/api/gems/:id` | Remove gem from registry (owner only) |
| `GET` | `/api/users/me` | Current user profile |
| `GET` | `/api/users` | List users with gem counts |
| `GET` | `/api/stats` | Org-wide statistics (total gems, unique gems, top duplicate clusters) |

**Gem import payload shape:**

```json
{
  "gems": [
    {
      "name": "Code Reviewer",
      "instructions": "You are an expert code reviewer. When given code, analyze it for...",
      "icon": "code",
      "source": "extension"
    }
  ]
}
```

### 7.2 Chrome Extension ↔ SPA Communication

The SPA communicates with the extension using `chrome.runtime.sendMessage`:

```javascript
// SPA → Extension: Request extracted gems
chrome.runtime.sendMessage(EXTENSION_ID, { type: 'GET_GEMS' }, (response) => {
  // response: { gems: [...], extractedAt: '2026-04-05T...' }
});

// SPA → Extension: Clear stored gems after successful import
chrome.runtime.sendMessage(EXTENSION_ID, { type: 'CLEAR_GEMS' });
```

If the extension is not detected (API returns undefined), the SPA falls back to manual import.

### 7.3 External System Integrations

| System | Integration | Auth Method |
|--------|-------------|-------------|
| Google Cloud Identity | User authentication (ID token validation) | OAuth 2.0 / OIDC |
| Gemini web app (`gemini.google.com`) | Gem extraction via Chrome extension | User's browser session |
| Google Drive API (optional) | Shared gem metadata discovery | Service account with domain-wide delegation |
| Cloud SQL | Primary data store | Cloud SQL Auth Proxy / IAM DB auth |

### 7.4 Configuration & Environment

| Variable | Purpose |
|----------|---------|
| `PORT` | Server listen port (set by Cloud Run) |
| `DATABASE_URL` | PostgreSQL connection string |
| `GOOGLE_CLIENT_ID` | OAuth client ID for token validation |
| `ALLOWED_DOMAIN` | Corporate domain for `hd` claim check (e.g., `corp.example.com`) |
| `EXTENSION_ID` | Chrome extension ID for SPA ↔ extension messaging |
| `DRIVE_SYNC_ENABLED` | Feature flag for Drive API metadata sync |
| `SIMILARITY_THRESHOLD` | Float (0–1) for duplicate clustering, default 0.85 |

## 8. Key Design Decisions

### 8.1 Chrome Extension as the primary gem extraction mechanism

**Decision:** Use a Chrome extension rather than server-side API calls, web scraping, or iframes.

**Why:** Google provides no official API for reading gem configurations. The Drive API can find shared gems but cannot read their instructions. Server-side reverse engineering (e.g., `gemini-webapi` Python library) requires forwarding user cookies to a server — a security and trust problem for a corporate app. A Chrome extension runs entirely in the user's browser session, requires explicit user action, and keeps credentials local.

**Trade-off:** Extension maintenance burden. Google can change the Gemini web app's internal structure at any time, breaking extraction. Mitigated by: (a) making the extension the only fragile component — the rest of the system is stable, (b) supporting manual import as a fallback, (c) designing the extension with multiple extraction strategies (DOM + network interception) so one can fail while the other works.

### 8.2 PostgreSQL over Firestore

**Decision:** Use Cloud SQL for PostgreSQL instead of Firestore.

**Why:** The core operations — full-text search across gem instructions, relational joins for duplicate clusters, aggregate statistics — are naturally relational. Firestore is simpler to set up but would require composite indexes for every query pattern, cannot do full-text search natively, and makes the Phase 2 workflow state machine harder to implement correctly.

**Trade-off:** Cloud SQL requires managing a database instance (sizing, backups, connection pooling). Cloud Run + Cloud SQL Auth Proxy mitigates most operational burden.

### 8.3 Monolith over microservices

**Decision:** Single Cloud Run service for both SPA hosting and API.

**Why:** The user base is a single corporate org. The traffic pattern is low-volume (users importing gems periodically, browsing the registry). Splitting into multiple services adds deployment complexity, inter-service auth, and network latency — none of which is justified at this scale.

**Trade-off:** If the similarity computation becomes CPU-intensive at scale, it should be extracted to a separate Cloud Run job triggered by Cloud Tasks. The service boundary for this is already clean (the `services/similarity.js` module).

### 8.4 Instruction hashing for exact deduplication

**Decision:** SHA-256 hash of normalized instructions for fast exact-duplicate detection.

**Why:** Many users likely copy gem instructions from shared resources (blog posts, internal wikis). Exact-match detection is cheap (index lookup) and catches the most common duplication pattern. Fuzzy matching is layered on top for near-duplicates.

### 8.5 User-initiated import, not automated collection

**Decision:** Users explicitly choose to import their gems. The system does not silently discover or collect gems.

**Why:** Trust and messaging. The stated goal is efficiency, not surveillance. Users must see that they control what enters the registry. This also avoids the technical and policy problems of automated gem scraping.

## 9. Extension Points

### 9.1 Adding new gem extraction sources

The ingestion pipeline accepts a generic `{ name, instructions, icon?, source }` payload. To add a new extraction method:

1. Add a new `source` enum value (e.g., `'api'` when Google eventually ships one).
2. Build the extraction client (extension, API client, etc.).
3. Have it produce the same payload shape and call `POST /api/gems/import`.

No backend changes needed — the ingestion service is source-agnostic.

### 9.2 Phase 2: Review workflow

The schema already includes a `status` column on gems. To add the review workflow:

1. Add a `reviews` table (reviewer, decision, comments, timestamps).
2. Add state transition logic in a new `services/workflow.js` module.
3. Add API endpoints: `POST /api/gems/:id/review`, `GET /api/gems/pending-review`.
4. Add frontend routes for the review queue and decision UI.
5. Add role-based access control (reviewer vs. regular user) to the auth middleware.

### 9.3 Phase 3: Gem-to-Enterprise-Agent promotion

When Google provides an API for creating Enterprise agents (or if a reverse-engineered path becomes available):

1. Add a `promotions` table tracking which gems were promoted, by whom, and with what modifications.
2. Add a `services/promotion.js` module that transforms a gem's instructions into the Enterprise agent configuration format.
3. Add UI in the existing SPA under `/gems/:id/promote`.
4. The promotion service would call the Enterprise agent API (or guide the user through the manual steps if no API exists).

### 9.4 Improving duplicate detection

The similarity service is designed as a pluggable module. Options for improvement:

- **Phase 1:** TF-IDF cosine similarity on instruction text (simple, no external dependencies).
- **Future:** Use the Vertex AI text embedding API (`text-embedding-005`) to generate embeddings for gem instructions, store them, and compute cosine similarity. This would catch semantically similar gems even when wording differs significantly.
- The `duplicate_clusters` and `duplicate_cluster_members` tables already support any clustering algorithm.

### 9.5 Adding an official Google API (when available)

If Google ships a Gemini gems API:

1. The Chrome extension becomes optional (but can remain as a fallback).
2. Add a new extraction path in the SPA that calls the official API using the user's OAuth token.
3. The backend import endpoint doesn't change — it receives the same payload.
4. The Drive API metadata sync becomes redundant if the official API provides discovery.

This is the primary reason the architecture separates extraction (extension) from storage (backend): the extraction layer can be swapped entirely without touching the rest of the system.
