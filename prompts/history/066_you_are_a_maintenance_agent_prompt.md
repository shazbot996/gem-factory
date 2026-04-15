# Executed: 2026-04-15T09:37:31.639039

You are a maintenance agent performing an **Update** action — regenerating a root project context file so it accurately reflects the current codebase.

## Your task

Rewrite the context file at `CLAUDE.md` so every fact matches the live code. This file is read by AI coding agents (Claude, Gemini) as their primary orientation to the project, so accuracy is critical.

## Document to update

- **Path:** `CLAUDE.md`
- **Role:** Root project context file (read by AI agents via CLAUDE.md / GEMINI.md / AGENTS.md)

<document>
# Gem Factory — Claude Code Instructions

## What this project is

Gem Factory is a central registry for Google Gemini gem configurations across a corporate Google Cloud org. Users import their personal gems into a shared catalog for discovery, dedup, and promotion to Enterprise agents.

## Project structure

```
gem-factory/
  CLAUDE.md                 ← you are here
  Makefile                  ← project-level commands (help, db-init, api-start, etc.)
  docker-compose.yml        ← local dev: API server (port 9090) + PostgreSQL (port 5432)
  .db-config                ← local database credentials (gitignored, created by `make db-init`)
  .gitignore
  docs/
    context/ARCH.md         ← full system architecture (Cloud Run, SPA, extension, DB schema)
    specs/                  ← feature specifications
    plans/                  ← implementation plans
  server/                   ← Node.js (Express) REST API server
    server.js               ← entry point: Express app, middleware, route mounting, startup
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
        001_initial_schema.sql  ← users, gems, duplicate_clusters, duplicate_cluster_members
      gems.js               ← gem repository (CRUD + search queries)
      users.js              ← user repository (upsert, find, list with gem counts)
    test/                   ← Node.js built-in test runner (node --test)
  extension/                ← Chrome extension (Manifest V3) — gem extractor
    manifest.json           ← v0.8.1 — edit-page DOM extraction approach
    background.js           ← service worker: gem storage, message routing, SPA comms protocol
    content-script.js       ← FAB + overlay on gem edit pages, reads DOM fields (name, instructions, knowledge, tools)
    page-script.js          ← MAIN world script (stub — reserved for future network interception)
    styles.css              ← FAB and modal overlay styles
    icons/                  ← placeholder PNGs (blue diamond)
  voicecode-bbs/            ← separate project — VoiceCode BBS (Python curses app)
    CLAUDE.md               ← its own Claude Code instructions
  prompts/history/          ← prompt/response history from development sessions
```

## Key documents — read these first

- `docs/context/ARCH.md` — full architecture: Chrome extension, SPA, backend API, Cloud SQL schema, data flows, extension points
- `docs/specs/chrome-extension-gem-extractor-SPEC.md` — detailed spec for the Chrome extension
- `docs/specs/api-server-SPEC.md` — spec for the backend API server
- `docs/specs/spa-frontend-SPEC.md` — spec for the frontend SPA (not yet built)
- `docs/plans/chrome-extension-gem-extractor-PLAN.md` — implementation plan for the extension (partially executed)
- `docs/plans/api-server-PLAN.md` — implementation plan for the API server (executed)
- `docs/plans/spa-frontend-PLAN.md` — implementation plan for the SPA (not yet started)

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
- `server.js` → auth middleware → route handlers → services → db repositories
- Migrations run on startup via `db/migrate.js` (custom runner, tracks applied files in `schema_migrations` table)
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

**Current approach (v0.8.1):** Extract one gem at a time from the gem **edit** page.

- The FAB (floating action button) only appears on `/gems/edit/*` URLs
- Clicking the FAB reads the gem name from input fields, full instructions from the `.ql-editor` (Quill rich-text editor), knowledge file names from the "Knowledge" section, and enabled tools (Google Search, Python, etc.) from the "Tools" section directly in the DOM
- No API calls are made — all data comes from the rendered edit form
- The overlay shows the extracted gem as JSON with a "Copy to Clipboard" button
- Extracted gems accumulate in `chrome.storage.local` (keyed by gem ID, last extraction wins)

**Why this approach:** The Gemini internal `batchexecute` list API (`CNgdBe` RPC) truncates instructions at ~100 chars. The edit page is the only place the full instructions are reliably available in the browser.

**To test the extension:**
1. Go to `chrome://extensions`, enable Developer mode, click "Load unpacked", select `extension/`
2. Navigate to `gemini.google.com`, open a gem for editing
3. The blue FAB appears bottom-right — click to extract

**Key conventions:**
- No build step, no npm, no bundler — pure browser APIs only
- Manifest V3 with `host_permissions` on `gemini.google.com/*`
- Version in `manifest.json` should be bumped on each testable change
- `page-script.js` runs in the `MAIN` world (for future network interception); `content-script.js` runs in the isolated world
- XSS prevention: use `textContent`, never `innerHTML`, for user-supplied data

**SPA communication protocol (in `background.js`):**
The background script handles `GET_GEMS` and `CLEAR_GEMS` external messages via `chrome.runtime.onMessageExternal` per `ARCH.md` section 7.2. The manifest currently lacks `externally_connectable` — this must be added before the SPA can communicate with the extension.

## Database

- PostgreSQL 16 running on a separate server (`branch.local`), not in Docker
- Connection configured via `.db-config` (created by `make db-init`, gitignored — never commit credentials)
- `.db-config` format: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME` — sourced by Makefile to construct `DATABASE_URL`
- Schema applied automatically on server startup via `server/db/migrate.js`
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
- `ADMIN_EMAILS` — comma-separated admin email list (defaults to `charles.schiele@gmail.com`)

## Makefile

All commands: `make help`. Key targets:
- `make api-start` — start API server via Docker Compose, DB connection from `.db-config`
- `make api-stop` — stop the API container
- `make api-test` — run API tests inside container
- `make api-logs` — tail API server logs
- `make db-init` — interactive database config (standalone, non-Docker)
- `make db-test` — test database connection and check privileges
- `make voicecode` — launch the VoiceCode BBS app (separate project)

The Makefile uses `SHELL := /bin/bash` (required for `read -s` and config sourcing).

## voicecode-bbs/

A separate Python curses application that lives in this repo. It has its own `CLAUDE.md` — read that file if working on VoiceCode. From the gem-factory root, the only touchpoint is `make voicecode`.

## Conventions

- The SPA frontend is not yet built — see `docs/specs/spa-frontend-SPEC.md` and `docs/plans/spa-frontend-PLAN.md` for the planned React + TypeScript + Vite + Tailwind implementation
- The API server exists and is functional (`server/`)
- The Chrome extension exists and is functional (`extension/`)
- Docs follow a type/frontmatter convention: `type: arch|spec|plan|drift-report`
- Plans go in `docs/plans/`, specs in `docs/specs/`, architecture in `docs/context/`
</document>

## Instructions

1. **Read the actual code.** Use your tools to explore files, grep for patterns, and read implementations. Do not rely solely on the embedded content — verify every claim against the live codebase.

2. **Use git history for context.** Run `git log --oneline -30` and `git diff HEAD~10..HEAD --stat` to understand recent changes. This helps you identify what's new, what's been renamed, and what's been removed.

3. **Preserve structure and voice.** Keep the same section headings, organizational hierarchy, and writing style. The document should feel like a natural update, not a rewrite from scratch.

4. **Update all facts:**
   - File paths and directory structure
   - Module, class, and function names
   - Architecture descriptions and data flows
   - Configuration values and environment variables
   - Dependencies and integration points
   - UI descriptions and keyboard shortcuts

5. **Add missing coverage.** If new modules, features, or subsystems have been added since the last update and they fall within this document's scope, add them in the appropriate section following the existing style.

6. **Remove obsolete content.** If the document describes code or features that no longer exist, remove those references cleanly. Don't annotate removals — just take them out.

7. **Cross-reference sibling context files.** If this is AGENTS.md, ensure references to CLAUDE.md and GEMINI.md are accurate. If this is CLAUDE.md or GEMINI.md, ensure it complements (not duplicates) AGENTS.md.

## Output

Overwrite the file at `CLAUDE.md` with the updated content. Do not create a new file — write directly to the existing path. Git provides rollback if needed.

## Guidelines

- **Accuracy over completeness.** It's better to omit something than to include a wrong claim. AI agents will trust this file.
- **Be specific.** Reference actual file paths, class names, and module structure — vague descriptions are unhelpful for agents navigating the codebase.
- **Keep it maintainable.** Write at the right level of abstraction. Don't list every function — describe the architecture and key entry points.
- **Minimize churn.** Don't rewrite sections that are already accurate. Only change what needs changing so the git diff stays reviewable.

