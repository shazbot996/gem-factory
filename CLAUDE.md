# Gem Factory — Claude Code Instructions

> **Shared entry point is [AGENTS.md](./AGENTS.md).** The equivalent
> Gemini-framed file is [GEMINI.md](./GEMINI.md) — keep both in sync when
> editing project context.

## What this project is

Gem Factory is a central registry for Google Gemini gem configurations,
branded as the **Schnucks Gem Registry** for Schnucks Markets. Users import
their personal gems into a shared catalog for discovery, dedup, and
promotion to Enterprise agents.

The system is **client-only**: there is no application server and no
relational database. Each gem lives as its own immutable JSON object at
`users/<email>/gems/<gem-id>.json` in a Google Cloud Storage bucket. The
Chrome extension writes new objects; the SPA reads them and (admin-only)
deletes them. Both clients talk to GCS directly using the signed-in
user's Google credentials. See ADR-0001 for the rationale.

## Project structure

```
gem-factory/
  AGENTS.md                 ← shared entry point (routes to CLAUDE.md / GEMINI.md)
  CLAUDE.md                 ← you are here
  GEMINI.md                 ← Gemini CLI instructions (equivalent of this file)
  Makefile                  ← project-level commands (help, spa-dev, spa-build, voicecode)
  docs/
    context/ARCH.md         ← architecture (extension + SPA + GCS bucket)
    decisions/              ← architecture decision records (ADRs)
      0001-replace-sql-and-api-server-with-direct-gcs-writes.md
    deployment/
      gcs-bucket-setup.md   ← bucket configuration runbook
    plans/                  ← implementation plans
    specs/                  ← feature specifications
  frontend/                 ← React SPA (TypeScript + Vite + Tailwind) — admin list/view/delete tool
    index.html              ← entry HTML, loads Google Identity Services
    package.json            ← React 19, React Router 7.5, Tailwind 4.1, Vite 6.3
    vite.config.ts          ← port 3000, build → frontend/dist/
    .env.development        ← VITE_GOOGLE_CLIENT_ID, VITE_GCS_BUCKET
    public/
      schnucks-logo.png     ← Schnucks Markets brand logo
    src/
      main.tsx              ← React DOM entry point
      App.tsx               ← routes: Registry (/), GemDetail (/gems/:id), NotFound (*)
      config.ts             ← env-derived bucketName + oauthClientId (single source of truth)
      index.css             ← Tailwind v4 import + Schnucks brand theme
      pages/
        Registry.tsx        ← index route — flat list of every gem with reload + per-row delete
        GemDetail.tsx       ← single gem view + "Delete from bucket" action
        NotFound.tsx        ← 404 page
      components/
        Layout.tsx          ← header: Schnucks logo + Gem Registry label + user profile
        GemTable.tsx        ← compact gem table with delete column
        EmptyState.tsx      ← empty state message
      api/
        gcsClient.ts        ← GCS REST client (list, download, delete; per-gem objects only)
        types.ts            ← Gem (carries objectName for deletes), KnowledgeFile, GemOwner
      data/
        GemsProvider.tsx    ← context: loads the catalog once, exposes deleteGem(gem)
      auth/
        AuthProvider.tsx    ← Google Sign-In + GIS Token Client (devstorage.read_write)
        useAuth.ts          ← auth hook (user, idToken, accessToken, isAuthenticated, signOut, signInAsDev)
        GoogleSignIn.tsx    ← sign-in button component
        gis.d.ts            ← Google Identity Services type declarations
  extension/                ← Chrome extension (Manifest V3) — gem extractor + GCS writer
    manifest.json           ← v0.17.0 — storage/identity/activeTab perms, oauth2 block, GCS host permission
    config.js               ← single source of truth: bucketName + oauthClientId
    banner-config.js        ← admin-editable public-Gemini alert banner (enable, color, message, link)
    background.js           ← service worker: local "pending" gem storage (no external messaging)
    content-script.js       ← FAB + extraction overlay + public-Gemini alert banner
    page-script.js          ← MAIN world script (reserved for future use)
    gcs.js                  ← OAuth token + GCS REST (saveGem create-only, listUserGems full fetch)
    popup.html              ← browser-action popup (extension toolbar icon)
    popup.js                ← cloud-canonical popup: lists bucket gems + pending uploads; no Clear/delete
    styles.css              ← FAB, extraction overlay, knowledge list, banner styles
    icons/                  ← Schnucks logo PNG (FAB) + extension toolbar icons
  media/                    ← media assets (source logo files, etc.)
  voicecode-bbs/            ← separate project — VoiceCode BBS (Python curses app)
    AGENTS.md               ← its own shared entry point
    CLAUDE.md               ← its own Claude Code instructions
    GEMINI.md               ← its own Gemini CLI instructions
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

**Status:** built and working. **Admin-only** list/view/delete tool over
the configured bucket. Aggregates every `users/<email>/gems/<gem-id>.json`
object into a single in-memory catalog. Legacy `users/<email>/gems.json`
files are ignored.

**Run locally:**

1. `make spa-install` — install npm dependencies (auto-runs if needed by
   `spa-dev`)
2. `make spa-dev` — start Vite dev server on port 3000
3. `make spa-build` — production build to `frontend/dist/`

**Pages and routing (`App.tsx`):**

| Path | Page | Description |
|------|------|-------------|
| `/` | Registry | Flat list of every gem in the bucket with a per-row Delete + a Reload button |
| `/gems/:id` | GemDetail | Single gem detail + "Delete from bucket" action |
| `*` | NotFound | 404 page |

The `Registry` and `GemDetail` routes are nested under a `ProtectedRoutes`
wrapper that redirects unauthenticated visitors to a sign-in page.

**Auth flow:**

- Google Sign-In via Google Identity Services (GIS) yields an ID token
  (identity proof).
- A separate GIS Token Client mints an OAuth access token with
  `devstorage.read_write` scope (needed for DELETE on bucket objects).
  Refreshes ~60 s before expiry; on 401 from GCS, AuthProvider
  re-requests silently. The OAuth consent screen for
  `VITE_GOOGLE_CLIENT_ID` must list the `read_write` scope.
- Dev bypass: when `VITE_GOOGLE_CLIENT_ID` is empty, the sign-in page
  exposes a **"Continue as dev user"** button that signs in as
  `dev@localhost`. The catalog will be empty unless you put a JSON file
  in the bucket manually (or use the extension to save one).

**IAM (bucket side):** the signed-in user needs
`storage.objects.delete` to use the SPA's delete action. The simplest
grant is `roles/storage.objectUser` on the bucket (superset of
`objectViewer` + `objectCreator`, plus `delete` and bucket metadata read).
See `docs/deployment/gcs-bucket-setup.md`.

**GCS client (`src/api/gcsClient.ts`):**

- `setGcsAccessToken(token)` — called by AuthProvider when the access
  token rotates.
- `listUserObjects(bucket)` — lists per-gem objects
  (`users/<email>/gems/<gem-id>.json`) under the bucket.
- `downloadObject(bucket, name)` — downloads a single document.
- `deleteObject(bucket, name)` — DELETE a single object (treats 404 as
  success).
- `loadAllGems(bucket)` — list + download + flatten into a `Gem[]` for
  the UI; each `Gem` carries its source `objectName` so deletes know
  which object to target.

## Chrome extension (`extension/`)

**Status:** built and working. v0.17.0 — bucket-as-source-of-truth model.
The popup fetches `users/<email>/gems/*.json` from GCS and renders that
as the canonical list ("In cloud"). Newly extracted gems sit in
`chrome.storage.local` as "Pending upload" until the user clicks
**Upload N pending**, which calls GCS create-only (`ifGenerationMatch=0`)
and on success removes the local copy. There is **no Clear button and no
delete from the extension** — the SPA owns deletes.

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
   then open the popup and click **Upload N pending**.
5. First upload shows the Google consent dialog (for
   `devstorage.read_write` + `userinfo.email`).
6. Verify with `gcloud storage ls gs://gcs-gem-registry/users/<your-email>/gems/`.

**Public-Gemini alert banner (`banner-config.js`):** the content script
injects a fixed top banner on every `gemini.google.com` page nudging
corporate users to the private Gemini Enterprise instance.
Admin-editable fields: `enabled`, `backgroundColor`, `textColor`,
`message`, `linkLabel`, `enterpriseUrl`. Set `enabled: false` to hide
without removing the file.

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
- Object layout: `users/<email-lowercased>/gems/<gem-id>.json`, one
  immutable file per gem. Any legacy `users/<email>/gems.json` files left
  in the bucket are ignored by both clients — remove them with
  `gcloud storage rm` once the data is no longer needed.
- Writes use `ifGenerationMatch=0` (create-only): the extension never
  overwrites or deletes; re-uploading an already-existing gem is treated
  as "already in cloud" and the local pending copy is cleaned up.
- Deletes come from the **SPA only** (admin tool), via the GCS REST
  `DELETE` endpoint.
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
own `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` — read those if working on
VoiceCode. From the gem-factory root, the only touchpoint is `make
voicecode`.

## Conventions

- The SPA frontend (`frontend/`) is built and functional — an admin-only
  list/view/delete tool against GCS.
- The Chrome extension (`extension/`) is built and functional — uploads
  new gems to GCS and treats the bucket as the source of truth.
- There is no API server or database to run; the previous Express +
  Postgres tiers were retired in the GCS rewrite (see ADR-0001). When
  proposing edits, never reintroduce a server tier.
- Docs follow a type/frontmatter convention: `type: arch|spec|plan|adr|runbook`.
- Plans go in `docs/plans/`, specs in `docs/specs/`, architecture in
  `docs/context/`, decisions in `docs/decisions/`, runbooks in
  `docs/deployment/`.
