# Gem Factory — Claude Code Instructions

## What this project is

Gem Factory is a central registry for Google Gemini gem configurations, branded as the **Schnucks Gem Registry** for Schnucks Markets. Users import their personal gems into a shared catalog for discovery, dedup, and promotion to Enterprise agents.

## Project structure

```
gem-factory/
  CLAUDE.md                 ← you are here
  Makefile                  ← project-level commands (help, db-init, api-start, spa-dev, etc.)
  docker-compose.yml        ← local dev: API server (port 9090)
  .db-config                ← local database credentials (gitignored, created by `make db-init`)
  .gitignore
  docs/
    context/ARCH.md         ← full system architecture (Cloud Run, SPA, extension, DB schema)
    specs/                  ← feature specifications
    plans/                  ← implementation plans
  server/                   ← Node.js (Express) REST API server
    server.js               ← entry point: Express app, CORS, middleware, route mounting, SPA fallback
    Dockerfile              ← Node 20 Alpine container for Docker Compose
    package.json            ← ES modules, express + pg + google-auth-library
    middleware/
      auth.js               ← Google ID token validation (dev bypass when GOOGLE_CLIENT_ID empty)
      admin.js              ← admin check via ADMIN_EMAILS env var
    routes/
      gems.js               ← /api/gems/* — import, list/search, get, update, delete
      users.js              ← /api/users/* — current user profile, list users
      stats.js              ← /api/stats — org-wide gem counts
    services/
      ingestion.js          ← normalize instructions, SHA-256 hash, insert with dedup
      search.js             ← full-text search query builder (tsvector/tsquery)
    db/
      pool.js               ← pg Pool singleton (reads DATABASE_URL)
      migrate.js            ← lightweight migration runner (schema_migrations table)
      migrations/
        001_initial_schema.sql   ← users, gems, duplicate_clusters, duplicate_cluster_members
        002_add_gem_metadata.sql ← metadata column additions
      gems.js               ← gem repository (CRUD + search queries)
      users.js              ← user repository (upsert, find, list with gem counts)
    public/                 ← static assets (serves SPA production build)
    test/                   ← Node.js built-in test runner (node --test)
  frontend/                 ← React SPA (TypeScript + Vite + Tailwind) — Schnucks branded
    index.html              ← entry HTML ("Schnucks Gem Registry"), loads Google Identity Services
    package.json            ← React 19, React Router 7.5, Tailwind 4.1, Vite 6.3, TypeScript 5.7
    vite.config.ts          ← port 3000, /api proxy → localhost:9090, build → ../server/public/
    .env.development        ← VITE_GOOGLE_CLIENT_ID, VITE_EXTENSION_ID, VITE_API_BASE_URL
    public/
      schnucks-logo.png     ← Schnucks Markets brand logo
    src/
      main.tsx              ← React DOM entry point
      App.tsx               ← routes: Dashboard (/), Registry (/registry), GemDetail (/gems/:id)
      index.css             ← Tailwind v4 import + Schnucks brand theme (@theme)
      pages/
        Dashboard.tsx       ← user's gems (GemTable) + org stats cards
        Registry.tsx        ← full catalog with search, owner filter, pagination (50/page)
        GemDetail.tsx       ← single gem view: instructions, knowledge files, tools, delete
        NotFound.tsx        ← 404 page
      components/
        Layout.tsx          ← header: Schnucks logo + "Gem Registry", nav, user profile
        GemTable.tsx        ← compact table view of gems (shared by Dashboard and Registry)
        GemCard.tsx         ← card view component (legacy, not currently used)
        SearchBar.tsx       ← debounced search input (300ms)
        Pagination.tsx      ← page controls with record range display
        EmptyState.tsx      ← empty state message
      api/
        client.ts           ← HTTP client with Bearer token auth + 401 refresh
        gems.ts             ← importGems, listGems, getGem, deleteGem
        users.ts            ← listUsers
        stats.ts            ← getStats
        types.ts            ← Gem, KnowledgeFile, GemOwner, Stats, UserProfile, ExtractedGem
      auth/
        AuthProvider.tsx    ← Google Sign-In context provider with token refresh
        useAuth.ts          ← auth hook (user, token, isAuthenticated, signOut)
        GoogleSignIn.tsx    ← sign-in button component
        gis.d.ts            ← Google Identity Services type declarations
      extension/
        useExtension.ts     ← hook for Chrome extension messaging (GET_GEMS, CLEAR_GEMS)
        chrome.d.ts         ← Chrome runtime type declarations
  extension/                ← Chrome extension (Manifest V3) — gem extractor
    manifest.json           ← v0.10.0 — edit-page DOM extraction + silent Drive link capture
    background.js           ← service worker: gem storage, message routing, SPA comms protocol
    content-script.js       ← FAB + overlay on gem edit pages, reads DOM fields + captures Drive URLs
    page-script.js          ← MAIN world script (stub — reserved for future network interception)
    popup.html              ← browser-action popup (extension toolbar icon)
    popup.js                ← popup logic
    styles.css              ← FAB, modal overlay, and knowledge list styles
    icons/                  ← placeholder PNGs (blue diamond)
  media/                    ← media assets (source logo files, etc.)
  voicecode-bbs/            ← separate project — VoiceCode BBS (Python curses app)
    CLAUDE.md               ← its own Claude Code instructions
  prompts/history/          ← prompt/response history from development sessions
```

## Key documents — read these first

- `docs/context/ARCH.md` — full architecture: Chrome extension, SPA, backend API, Cloud SQL schema, data flows, extension points
- `docs/specs/chrome-extension-gem-extractor-SPEC.md` — detailed spec for the Chrome extension
- `docs/specs/api-server-SPEC.md` — spec for the backend API server
- `docs/specs/spa-frontend-SPEC.md` — spec for the frontend SPA
- `docs/specs/authentication-authorization-SPEC.md` — auth spec covering extension, API, and SPA
- `docs/plans/chrome-extension-gem-extractor-PLAN.md` — implementation plan for the extension (partially executed)
- `docs/plans/api-server-PLAN.md` — implementation plan for the API server (executed)
- `docs/plans/spa-frontend-PLAN.md` — implementation plan for the SPA

## Frontend SPA (`frontend/`)

**Status: Built and working.** React + TypeScript SPA branded as the Schnucks Gem Registry, using Vite for dev/build and Tailwind CSS v4 for styling.

**Schnucks branding:**
- Logo displayed in header nav and sign-in page (`public/schnucks-logo.png`)
- Custom Schnucks red theme defined in `index.css` via `@theme`: `--color-schnucks-red: #E31837`, `--color-schnucks-red-dark: #C41430`
- Active nav links, focus rings, and interactive text use Schnucks red
- Page title: "Schnucks Gem Registry"

**To run locally:**
1. `make spa-install` — install npm dependencies (auto-runs if needed by `spa-dev`)
2. `make spa-dev` — start Vite dev server on port 3000 (proxies `/api` to `localhost:9090`)
3. `make spa-build` — production build to `server/public/`

**Pages and routing (`App.tsx`):**

| Path | Page | Description |
|------|------|-------------|
| `/` | Dashboard | User's own gems in a compact table + org stats cards |
| `/registry` | Registry | All gems with search, owner filter, pagination (50/page) |
| `/gems/:id` | GemDetail | Single gem: instructions, knowledge files, tools, delete |
| `*` | NotFound | 404 page |

**Key components:**
- `Layout.tsx` — header with Schnucks logo, "Gem Registry" label, nav links (Dashboard, Registry), user avatar + sign-out
- `GemTable.tsx` — compact table view shared by Dashboard and Registry. Columns: Name, Owner, Description, Docs count, Tools, Import date. Responsive — columns hide progressively on smaller screens
- `SearchBar.tsx` — debounced search input (300ms delay)
- `Pagination.tsx` — page controls showing record range (e.g. "1–50 of 234")

**Auth flow:**
- Google Sign-In via Google Identity Services (GIS) library
- `AuthProvider.tsx` manages token lifecycle with auto-refresh 5 min before expiry
- Dev bypass: when `VITE_GOOGLE_CLIENT_ID` is empty, auto-authenticates as `dev@localhost`. Clicking "Sign out" in dev-bypass mode lands on a SignInPage with a "Continue as dev user" button that re-establishes the dev session.
- Protected routes redirect to sign-in page when unauthenticated

**Enabling real Google Sign-In (supports Schnucks org + personal Gmail):**
1. In Google Cloud Console → APIs & Services → Credentials, create an "OAuth 2.0 Client ID" of type "Web application".
2. Under "Authorized JavaScript origins," add `http://localhost:3000`.
3. Copy `frontend/.env.development.local.example` to `frontend/.env.development.local` (gitignored) and set `VITE_GOOGLE_CLIENT_ID` to the generated client ID.
4. Set the same value as `GOOGLE_CLIENT_ID` on the API server — either export it in your shell before `make api-start` (docker-compose passes it through) or add it to the Compose env block.
5. Restart both servers (`make api-start` and `make spa-dev`). The SignInPage now renders a real Google button; dev-bypass is disabled.

Identity acceptance is controlled by `ALLOWED_DOMAIN` (org match) and `ALLOW_GMAIL` (default `true`) on the API server — see `docs/specs/authentication-authorization-SPEC.md` §3.3.

**API client (`api/client.ts`):**
- `apiRequest<T>()` — fetch wrapper with Bearer token, JSON content type, 401 refresh handling
- Functions: `importGems()`, `listGems()`, `getGem()`, `deleteGem()`, `listUsers()`, `getStats()`

**Extension integration (`extension/useExtension.ts`):**
- Sends `GET_GEMS` / `CLEAR_GEMS` messages to the Chrome extension via `chrome.runtime.sendMessage`
- Extension ID configured via `VITE_EXTENSION_ID` env var

**Key conventions:**
- Tailwind v4 with `@tailwindcss/vite` plugin (no separate config file — theme defined in `index.css` via `@theme`)
- React 19, React Router 7.5, TypeScript 5.7, Vite 6.3
- ES modules throughout (`"type": "module"` in `package.json`)
- Build output goes to `../server/public/` for the API server to serve as static files

## API server (`server/`)

**Status: Built and working.** Express.js REST API running via Docker Compose, connecting to an external PostgreSQL database.

**To run locally:**
1. `make db-init` — configure database connection (writes `.db-config`, gitignored). The database runs on a separate server (e.g., `branch.local`), not in Docker.
2. `make api-start` — builds and starts the API server via Docker Compose, reading `.db-config` to construct `DATABASE_URL`
3. API available at `http://localhost:9090`
4. `make api-stop` — stops the API container
5. `make api-test` — runs tests inside the container
6. `make api-logs` — tail server logs

**Architecture:**
- `server.js` → CORS middleware → auth middleware → route handlers → services → db repositories
- CORS allows `localhost:3000`, `localhost:5173`, and `chrome-extension://` origins
- Migrations run on startup via `db/migrate.js` (custom runner, tracks applied files in `schema_migrations` table)
- SPA fallback: serves `public/index.html` for non-API routes (when production build is present)
- ES modules throughout (`"type": "module"` in `package.json`)
- Dependencies: `express`, `pg`, `google-auth-library`

**API endpoints (all under `/api`, auth required except `/api/health`):**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check (no auth) |
| `POST` | `/api/gems/import` | Import gems — normalizes, hashes, deduplicates |
| `GET` | `/api/gems` | List/search gems (params: `q`, `owner`, `status`, `page`, `limit`) |
| `GET` | `/api/gems/:id` | Single gem detail with owner info |
| `PATCH` | `/api/gems/:id` | Update gem name/icon (owner) or status (admin) |
| `DELETE` | `/api/gems/:id` | Hard delete (owner or admin) |
| `GET` | `/api/users/me` | Current user profile + gem count |
| `GET` | `/api/users` | List all users with gem counts |
| `GET` | `/api/stats` | Org-wide stats (total gems, unique gems, contributors) |

**Auth:**
- Production: validates Google ID tokens via `google-auth-library`, checks `hd` (hosted domain) claim against `ALLOWED_DOMAIN`
- Dev bypass: when `GOOGLE_CLIENT_ID` is empty (default in Docker Compose), auto-authenticates as `dev@localhost`. Use `X-Dev-User-Email` header to simulate different users.
- Admin: `ADMIN_EMAILS` env var (comma-separated, defaults to `charles.schiele@gmail.com`)

**Key conventions:**
- Import payload: `{ gems: [{ name, instructions, icon?, source? }] }` — max 100 gems, instructions max 100KB
- Exact-duplicate detection via SHA-256 hash of normalized instructions (`ON CONFLICT (owner_id, instruction_hash) DO NOTHING`)
- Full-text search uses PostgreSQL `tsvector` / `tsquery` with `ts_rank` ordering
- Duplicate cluster tables exist in the schema but clustering logic is deferred

## Chrome extension (`extension/`)

**Current approach (v0.10.0):** Extract one gem at a time from the gem **edit** page, with silent Drive link capture for knowledge documents.

**What it extracts (all from DOM — no API calls):**
- **Gem name** — from the first `<input>` field on the edit page
- **Description** — from `#gem-description-input` textarea
- **Instructions** — full text from the `.ql-editor` (Quill rich-text editor)
- **Knowledge files** — file names, types, and mime types from `uploader-file-preview` elements inside `.knowledge-container`; mime type parsed from the Drive icon image URL
- **Knowledge file Drive URLs** — captured silently by programmatically opening the Google Drive viewer (hidden via inline styles), reading `#drive-active-item-info` JSON (`{id, title, mimeType}`), then closing the viewer via Escape key dispatch; produces `driveId` and canonical `driveUrl` (e.g. `https://docs.google.com/spreadsheets/d/{id}`)
- **Enabled tools** — from `bots-creation-default-tool-section` dropdown label

**Overlay UI** (shown after clicking the FAB):
- Success/update confirmation banner
- Instructions preview (first 300 chars)
- Knowledge documents list with "Capture All Links" button — silently captures Drive URLs for all files sequentially, showing per-item status (hourglass → checkmark/X); previously captured links are preserved across overlay reopens
- Running gem collection list (all extracted gems, newest first)
- "Copy JSON" footer button (includes `driveId`/`driveUrl` when captured)

**Why this approach:** The Gemini internal `batchexecute` list API (`CNgdBe` RPC) truncates instructions at ~100 chars. The edit page is the only place the full instructions are reliably available in the browser. Knowledge file Drive IDs only appear when the Drive viewer opens — they are not present in the edit page DOM otherwise.

**To test the extension:**
1. Go to `chrome://extensions`, enable Developer mode, click "Load unpacked", select `extension/`
2. Navigate to `gemini.google.com`, open a gem for editing
3. The blue FAB appears bottom-right — click to extract
4. In the overlay, click "Capture All Links" to silently grab Drive URLs for knowledge files

**Key conventions:**
- No build step, no npm, no bundler — pure browser APIs only
- Manifest V3 with `host_permissions` on `gemini.google.com/*`, `localhost:9090/*`, and `*.run.app/*`
- Version in `manifest.json` should be bumped on each testable change
- `page-script.js` runs in the `MAIN` world (for future network interception); `content-script.js` runs in the isolated world
- XSS prevention: use `textContent`, never `innerHTML`, for user-supplied data
- Drive viewer close uses Escape key dispatch + close button click — never force-remove the viewer DOM (corrupts Angular's component state and breaks subsequent viewer opens)

**Background script messages (`background.js`):**
- Internal (from content script): `STORE_GEM`, `GET_ALL_GEMS`, `DELETE_GEM`
- External (from SPA via `chrome.runtime.onMessageExternal`): `GET_GEMS`, `CLEAR_GEMS`
- `externally_connectable` is configured in the manifest for `http://localhost:3000/*`

## Database

- PostgreSQL 16 running on a separate server (`branch.local`), not in Docker
- Connection configured via `.db-config` (created by `make db-init`, gitignored — never commit credentials)
- `.db-config` format: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME` — sourced by Makefile to construct `DATABASE_URL`
- Schema applied automatically on server startup via `server/db/migrate.js`
- Migrations: `001_initial_schema.sql` (users, gems, duplicate_clusters, duplicate_cluster_members), `002_add_gem_metadata.sql` (metadata columns)
- Tables: `users`, `gems` (with generated `tsvector` search column), `duplicate_clusters`, `duplicate_cluster_members`
- Key indexes: `idx_gems_owner`, `idx_gems_hash`, `idx_gems_search` (GIN), `idx_gems_owner_hash` (unique, enables upsert dedup)
- `make db-init` — interactive database config (saves to `.db-config`)
- `make db-test` — test database connection and check privileges

## Docker Compose (`docker-compose.yml`)

Single service for local development:
- **`api`** — builds from `./server`, port 9090, `node --watch server.js` for live reload, bind-mount `./server:/app`
- `DATABASE_URL` is constructed from `.db-config` and passed in by the Makefile at startup

Environment variables passed from host (empty defaults for dev bypass):
- `GOOGLE_CLIENT_ID` — OAuth client ID for token validation
- `ALLOWED_DOMAIN` — corporate domain restriction
- `ALLOW_GMAIL` — accept personal Gmail accounts (default `true`)
- `ADMIN_EMAILS` — comma-separated admin email list (defaults to `charles.schiele@gmail.com`)

## Server → Google Cloud credentials (ADC)

When the API server calls Google Cloud APIs (future: Cloud Logging, Cloud Storage, BigQuery, Vertex AI, etc.), it uses **Application Default Credentials** via the standard Google Cloud client libraries. No credential files are committed to the repo, and user ID tokens are never used for server-to-Google-Cloud calls.

- **Local dev:** run `gcloud auth application-default login` once on the host. Then uncomment the commented-out volume in `docker-compose.yml` that bind-mounts `~/.config/gcloud` read-only into the container. Google Cloud client libraries pick up the credentials automatically.
- **Cloud Run (production):** attach a service account to the Cloud Run service. ADC resolves to that service account automatically — no env vars or key files needed. IAM roles on the service account determine what Google Cloud resources the server can access.

See `docs/specs/authentication-authorization-SPEC.md` §3.4 for the full description.

## Makefile

All commands: `make help`. Key targets:
- `make api-start` — start API server via Docker Compose, DB connection from `.db-config`
- `make api-stop` — stop the API container
- `make api-test` — run API tests inside container
- `make api-logs` — tail API server logs
- `make db-init` — interactive database config (standalone, non-Docker)
- `make db-test` — test database connection and check privileges
- `make spa-install` — install SPA frontend npm dependencies
- `make spa-dev` — start SPA dev server on port 3000 (auto-installs if needed)
- `make spa-build` — production build SPA to `server/public/`
- `make voicecode` — launch the VoiceCode BBS app (separate project)

The Makefile uses `SHELL := /bin/bash` (required for `read -s` and config sourcing).

## voicecode-bbs/

A separate Python curses application that lives in this repo. It has its own `CLAUDE.md` — read that file if working on VoiceCode. From the gem-factory root, the only touchpoint is `make voicecode`.

## Conventions

- The SPA frontend is built and functional (`frontend/`) — branded as the Schnucks Gem Registry
- The API server is built and functional (`server/`)
- The Chrome extension is built and functional (`extension/`)
- Docs follow a type/frontmatter convention: `type: arch|spec|plan|drift-report`
- Plans go in `docs/plans/`, specs in `docs/specs/`, architecture in `docs/context/`
