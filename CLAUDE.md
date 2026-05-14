# Gem Factory — Claude Code Instructions

## What this project is

Gem Factory is a central registry for Google Gemini gem configurations,
branded as the **Schnucks Gem Registry** for Schnucks Markets. Users import
their personal gems into a shared catalog for discovery, dedup, and
promotion to Enterprise agents.

The system is **client-only**: there is no application server and no
relational database. Gem configurations live as JSON files in a Google
Cloud Storage bucket (`users/<email>/gems.json`). Both clients — the Chrome
extension that writes, and the SPA viewer that reads — talk to GCS directly
using the signed-in user's Google credentials. See ADR-0001 for the
rationale.

## Project structure

```
gem-factory/
  CLAUDE.md                 ← you are here
  Makefile                  ← project-level commands (help, spa-dev, spa-build, voicecode)
  docs/
    context/ARCH.md         ← architecture (extension + SPA + GCS bucket)
    decisions/              ← architecture decision records (ADRs)
      0001-replace-sql-and-api-server-with-direct-gcs-writes.md
    deployment/
      gcs-bucket-setup.md   ← bucket configuration runbook
    plans/                  ← implementation plans
    specs/                  ← feature specifications
  frontend/                 ← React SPA (TypeScript + Vite + Tailwind) — read-only viewer
    index.html              ← entry HTML, loads Google Identity Services
    package.json            ← React 19, React Router 7.5, Tailwind 4.1, Vite 6.3
    vite.config.ts          ← port 3000, build → frontend/dist/
    .env.development        ← VITE_GOOGLE_CLIENT_ID, VITE_GCS_BUCKET
    public/
      schnucks-logo.png     ← Schnucks Markets brand logo
    src/
      main.tsx              ← React DOM entry point
      App.tsx               ← routes: Dashboard (/), Registry (/registry), GemDetail (/gems/:id)
      config.ts             ← env-derived bucketName + oauthClientId (single source of truth)
      index.css             ← Tailwind v4 import + Schnucks brand theme
      pages/
        Dashboard.tsx       ← user's gems (filtered from the shared cache) + org stats
        Registry.tsx        ← full catalog with client-side search, owner filter, pagination
        GemDetail.tsx       ← single gem view (lookup in the shared cache)
        NotFound.tsx        ← 404 page
      components/
        Layout.tsx          ← header: Schnucks logo + nav + user profile
        GemTable.tsx        ← compact gem table (shared by Dashboard and Registry)
        SearchBar.tsx       ← debounced search input (300ms)
        Pagination.tsx      ← page controls with record range display
        EmptyState.tsx      ← empty state message
      api/
        gcsClient.ts        ← read-only GCS REST client (list + download + flatten)
        types.ts            ← Gem, KnowledgeFile, GemOwner
      data/
        GemsProvider.tsx    ← context that loads the catalog once and shares it
      auth/
        AuthProvider.tsx    ← Google Sign-In + GIS Token Client for GCS reads
        useAuth.ts          ← auth hook (user, idToken, accessToken, isAuthenticated, signOut)
        GoogleSignIn.tsx    ← sign-in button component
        gis.d.ts            ← Google Identity Services type declarations
  extension/                ← Chrome extension (Manifest V3) — gem extractor + GCS writer
    manifest.json           ← v0.12.0 — identity permission, oauth2 block, GCS host permission
    config.js               ← single source of truth: bucketName + oauthClientId
    background.js           ← service worker: local gem storage (no external messaging)
    content-script.js       ← FAB + overlay on gem edit pages
    page-script.js          ← MAIN world script (reserved for future use)
    gcs.js                  ← OAuth token + GCS REST (loadUserGems, saveUserGems)
    popup.html              ← browser-action popup (extension toolbar icon)
    popup.js                ← gem list + Save to Registry → direct GCS upload
    styles.css              ← FAB, modal overlay, knowledge list styles
    icons/                  ← placeholder PNGs (blue diamond)
  media/                    ← media assets (source logo files, etc.)
  voicecode-bbs/            ← separate project — VoiceCode BBS (Python curses app)
    CLAUDE.md               ← its own Claude Code instructions
  prompts/history/          ← prompt/response history from development sessions
```

## Key documents — read these first

- `docs/decisions/0001-replace-sql-and-api-server-with-direct-gcs-writes.md` — the architectural shift that produced the current design
- `docs/plans/gcs-direct-write-rewrite-PLAN.md` — implementation plan for the rewrite
- `docs/deployment/gcs-bucket-setup.md` — bucket configuration runbook (UBLA, versioning, CORS, IAM)
- `docs/context/ARCH.md` — current architecture (extension + SPA + GCS)
- `docs/specs/chrome-extension-gem-extractor-SPEC.md` — DOM extraction details
- `docs/specs/authentication-authorization-SPEC.md` — auth model (note: §3.2 SPA→extension push is deprecated; the extension now obtains its own OAuth token via `chrome.identity`)

## Configuration — switching buckets and OAuth clients

Two files configure environment-specific values:

- **`extension/config.js`** — `bucketName`, `oauthClientId`. The OAuth
  client ID **must also match** `extension/manifest.json`'s
  `oauth2.client_id` (Chrome reads the manifest, not config.js).
- **`frontend/src/config.ts`** — driven by `VITE_GCS_BUCKET` and
  `VITE_GOOGLE_CLIENT_ID` from `.env.development[.local]`.

Promoting from the test bucket (`gcs-gem-registry`) to a production bucket:

1. Apply the bucket settings in `docs/deployment/gcs-bucket-setup.md` to
   the new bucket (UBLA, versioning, CORS, IAM).
2. Update `extension/config.js` and `extension/manifest.json` with the new
   bucket name (and new OAuth client ID if the production extension has a
   different Chrome ID).
3. Update `frontend/.env.development` (or `.env.production.local`) with
   the new `VITE_GCS_BUCKET`.
4. Bump the extension version in `manifest.json`, reload it, re-run the
   SPA.

## Frontend SPA (`frontend/`)

**Status:** built and working. Read-only viewer that aggregates every
`users/<email>/gems.json` in the configured bucket into a single in-memory
catalog.

**Run locally:**

1. `make spa-install` — install npm dependencies (auto-runs if needed by
   `spa-dev`)
2. `make spa-dev` — start Vite dev server on port 3000
3. `make spa-build` — production build to `frontend/dist/`

**Pages and routing (`App.tsx`):**

| Path | Page | Description |
|------|------|-------------|
| `/` | Dashboard | My gems (filtered from the shared cache) + org stats |
| `/registry` | Registry | All gems with client-side search + owner filter |
| `/gems/:id` | GemDetail | Single gem detail |
| `*` | NotFound | 404 page |

**Auth flow:**

- Google Sign-In via Google Identity Services (GIS) yields an ID token
  (identity proof).
- A separate GIS Token Client mints an OAuth access token with
  `devstorage.read_only` scope for GCS reads. Refreshes ~60 s before
  expiry; on 401 from GCS, AuthProvider re-requests silently.
- Dev bypass: when `VITE_GOOGLE_CLIENT_ID` is empty, auto-authenticates as
  `dev@localhost`. The catalog will be empty unless you put a JSON file
  in the bucket manually (or use the extension to save one).

**GCS client (`src/api/gcsClient.ts`):**

- `setGcsAccessToken(token)` — called by AuthProvider when the access
  token rotates.
- `listUserObjects(bucket)` — lists `users/<email>/gems.json` under the
  bucket.
- `downloadObject(bucket, name)` — downloads a single document.
- `loadAllGems(bucket)` — list + download + flatten into a `Gem[]` for
  the UI.

## Chrome extension (`extension/`)

**Status:** built and working. v0.12.0 — writes directly to GCS using
`chrome.identity` for OAuth.

**To test:**

1. Apply `docs/deployment/gcs-bucket-setup.md` to the test bucket
   (`gcs-gem-registry`), including CORS with your extension's
   `chrome-extension://<id>` origin.
2. Register a Chrome-Extension-type OAuth client in Google Cloud Console
   with the extension's ID; copy the client ID into **both**
   `extension/config.js` and `extension/manifest.json`.
3. Go to `chrome://extensions`, enable Developer Mode, click
   "Load unpacked", select `extension/`.
4. Navigate to a gem edit page on `gemini.google.com`, click the FAB,
   then open the popup and click **Save to Registry**.
5. First save shows the Google consent dialog (for
   `devstorage.read_write` + `userinfo.email`).
6. Verify with `gcloud storage cat gs://gcs-gem-registry/users/<your-email>/gems.json`.

**Key conventions:**

- No build step, no npm, no bundler — pure browser APIs only.
- Manifest V3. `host_permissions` covers `gemini.google.com` and
  `storage.googleapis.com`.
- Bump `version` in `manifest.json` on each testable change.
- `page-script.js` runs in the `MAIN` world (reserved for future network
  interception); `content-script.js` runs in the isolated world.
- XSS prevention: use `textContent`, never `innerHTML`, for user-supplied
  data.
- The OAuth client ID lives in two places (config.js + manifest.json) and
  they MUST match — `chrome.identity` reads the manifest.

**Background script messages (`background.js`):**

Internal only. The extension is no longer addressable from any web origin
— `externally_connectable` was removed. The SPA no longer pushes auth or
queries the extension.

- `STORE_GEM` — append/replace by gem id, returns `{ totalGems, wasUpdate, allGems }`.
- `GET_ALL_GEMS` — returns the current local cache.
- `DELETE_GEM` — remove a gem from the local cache.

## Google Cloud Storage bucket

- **Test:** `gs://gcs-gem-registry` (the user's existing bucket).
- **Production:** TBD — configure per `docs/deployment/gcs-bucket-setup.md`.
- Object layout: `users/<email-lowercased>/gems.json`, one file per user.
- The bucket uses Uniform Bucket-Level Access + object versioning + CORS
  for browser origins.
- See `docs/deployment/gcs-bucket-setup.md` for the full setup checklist
  (UBLA, versioning, CORS, IAM bindings, optional lifecycle rules).

## Makefile

All commands: `make help`. Key targets:

- `make spa-install` — install SPA frontend npm dependencies
- `make spa-dev` — start SPA dev server on port 3000 (auto-installs if needed)
- `make spa-build` — production build to `frontend/dist/`
- `make voicecode` — launch the VoiceCode BBS app (separate project)

The Makefile uses `SHELL := /bin/bash`.

## voicecode-bbs/

A separate Python curses application that lives in this repo. It has its
own `CLAUDE.md` — read that file if working on VoiceCode. From the
gem-factory root, the only touchpoint is `make voicecode`.

## Conventions

- The SPA frontend is built and functional (`frontend/`) — read-only
  viewer against GCS.
- The Chrome extension is built and functional (`extension/`) — writes
  directly to GCS.
- There is no API server or database to run; the previous Express +
  Postgres tiers were retired in the GCS rewrite (see ADR-0001).
- Docs follow a type/frontmatter convention: `type: arch|spec|plan|adr|runbook`.
- Plans go in `docs/plans/`, specs in `docs/specs/`, architecture in
  `docs/context/`, decisions in `docs/decisions/`, runbooks in
  `docs/deployment/`.
