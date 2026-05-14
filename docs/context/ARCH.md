---
type: arch
title: Gem Factory — Direct-to-GCS Architecture
scope: Full application — Chrome extension + SPA viewer + GCS bucket
date: 2026-05-14
supersedes: docs/decisions/0001-replace-sql-and-api-server-with-direct-gcs-writes.md
---

## 1. Overview

Gem Factory is a central registry for Google Gemini gem configurations,
branded as the **Schnucks Gem Registry**. Users import their personal gems
into a shared catalog for discovery, dedup, and promotion to Enterprise
agents.

**Architectural style:** two-tier client-only application backed by Google
Cloud Storage. There is **no application server and no relational database**
— gem documents live as JSON files in a single GCS bucket, and both clients
(Chrome extension, SPA) talk to GCS directly using the signed-in user's
Google credentials.

This architecture is the result of ADR-0001 (accepted 2026-05-14), which
replaced a prior three-tier design with Express + Cloud SQL.

## 2. High-Level Architecture

```
┌──────────────────────────────────────────────┐
│           Browser — gemini.google.com         │
│  ┌────────────────────────────────────────┐  │
│  │  Chrome Extension (Gem Extractor)       │  │
│  │  - extracts gem data from edit page DOM │  │
│  │  - obtains OAuth token via              │  │
│  │    chrome.identity.getAuthToken         │  │
│  │  - writes users/<email>/gems.json       │  │
│  └────────────────┬────────────────────────┘  │
└───────────────────┼────────────────────────────┘
                    │  PUT (devstorage.read_write)
                    ▼
        ┌────────────────────────┐
        │  Google Cloud Storage  │
        │  gs://<bucket>/        │
        │    users/              │
        │      alice@.../gems.json│
        │      bob@.../gems.json │
        └────────────▲───────────┘
                     │  GET LIST (devstorage.read_only)
┌────────────────────┼────────────────────────────┐
│           Browser — registry SPA                 │
│  ┌─────────────────┴───────────────────────┐   │
│  │  React + Vite viewer                      │   │
│  │  - Google Sign-In (GIS ID token)          │   │
│  │  - GIS Token Client → access token        │   │
│  │  - Lists users/ prefix, downloads each    │   │
│  │  - Client-side search/filter/pagination   │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

There is no server-to-server path between the extension and the SPA. They
are independent clients of the same bucket.

## 3. Components

### 3.1 Chrome Extension (`extension/`)

Manifest V3 extension that runs on `gemini.google.com`. Key files:

- `manifest.json` — declares `identity` permission, `oauth2` block with the
  Chrome-Extension-type OAuth client ID and the
  `https://www.googleapis.com/auth/devstorage.read_write` scope, host
  permissions for `storage.googleapis.com`.
- `config.js` — single source of truth for `bucketName` and
  `oauthClientId`. Loaded as the first content script and via
  `importScripts` in the background service worker.
- `content-script.js` — FAB + overlay on gem edit pages; DOM-only gem
  extraction (name, description, instructions, knowledge files, default
  tools). Writes extracted gems to `chrome.storage.local` via the
  background service worker.
- `background.js` — accumulator for extracted gems (`STORE_GEM`,
  `GET_ALL_GEMS`, `DELETE_GEM`). No external messaging — the extension is
  not addressable from any web origin.
- `gcs.js` — token acquisition (`chrome.identity.getAuthToken`), identity
  discovery (`chrome.identity.getProfileUserInfo`), and the
  `loadUserGems` / `saveUserGems` REST calls against the Cloud Storage
  JSON API. Uses `If-Match` etags for optimistic concurrency on overwrite.
- `popup.js` / `popup.html` — gem list view + "Save to Registry" button.
  Reads `extractedGems` from local storage, merges by gem id with whatever
  is already in `users/<email>/gems.json`, and writes the merged document
  back.

### 3.2 SPA Viewer (`frontend/`)

React 19 + Vite 6 + Tailwind 4 single-page application. Read-only against
the bucket. Key files:

- `src/config.ts` — single source of truth: reads `VITE_GCS_BUCKET` and
  `VITE_GOOGLE_CLIENT_ID`.
- `src/auth/AuthProvider.tsx` — Google Sign-In for identity, plus a
  separate GIS Token Client that mints OAuth access tokens with the
  `devstorage.read_only` scope. Refreshes the access token 60 seconds
  before expiry; on a 401 from GCS the GcsClient calls back into
  AuthProvider to request a fresh token.
- `src/api/gcsClient.ts` — `listUserObjects` + `downloadObject` +
  `loadAllGems`; flattens per-user documents into a single `Gem[]` for
  the UI.
- `src/data/GemsProvider.tsx` — React context that loads the full catalog
  once per session and shares it with pages.
- `src/pages/Dashboard.tsx`, `Registry.tsx`, `GemDetail.tsx` — pages that
  consume the cached gem list. All search, filtering, and pagination are
  client-side over the loaded data.

### 3.3 Google Cloud Storage Bucket

The runtime state lives entirely in a single bucket:

- **Test bucket:** `gs://gcs-gem-registry` (current).
- **Production bucket:** TBD. Promotion requires updating two config files
  (`extension/config.js`, `frontend/.env.development` or
  `.env.production`) and reapplying the IAM + CORS settings from
  `docs/deployment/gcs-bucket-setup.md`.

Configuration:

- **Uniform Bucket-Level Access** enabled. All authorization comes from
  IAM bindings on the bucket — no per-object ACLs.
- **Object versioning** enabled. Each `users/<email>/gems.json` overwrite
  produces a non-current version retained for recovery / audit.
- **CORS** allows `http://localhost:3000` (SPA dev) and
  `chrome-extension://<id>` (extension popup) for `GET`, `PUT`, `POST`,
  `HEAD`.
- **IAM:** see `docs/deployment/gcs-bucket-setup.md`. For Phase 1 each
  authorized user is granted `storage.objectCreator` +
  `storage.objectViewer`; admins get `storage.objectAdmin`.

Object layout:

```
users/
  <user-email-lowercased>/
    gems.json       # single JSON document per user
```

The JSON document is described in §4.

## 4. Document Schema

`users/<email>/gems.json` shape (`schemaVersion: 1`):

```json
{
  "schemaVersion": 1,
  "owner": "alice@schnucks.example",
  "updatedAt": "2026-05-14T17:23:00.000Z",
  "gems": [
    {
      "id": "<gemini-edit-page-id>",
      "name": "Code Reviewer",
      "description": "Reviews PRs",
      "instructions": "<full text>",
      "knowledgeFiles": [
        { "name": "...", "type": "...", "mimeType": "...",
          "driveId": "...", "driveUrl": "..." }
      ],
      "defaultTools": ["..."],
      "source": "edit_page",
      "extractedAt": "2026-05-14T17:22:54.000Z"
    }
  ]
}
```

Readers must treat unknown fields as opaque and missing optional fields
(`description`, `knowledgeFiles`, `defaultTools`, `extractedAt`) as
empty. `schemaVersion` increments only on breaking changes.

## 5. Data Flow

### 5.1 Extension save flow (one user's gems)

1. User opens a gem edit page on `gemini.google.com`. The content script
   shows a floating action button.
2. User clicks the FAB. The content script extracts the gem from the DOM
   and stores it in `chrome.storage.local` via `STORE_GEM`.
3. User opens the extension popup and clicks **Save to Registry**.
4. Popup calls `chrome.identity.getAuthToken({ interactive: true })`. On
   first use, Chrome shows the Google consent screen for the
   `devstorage.read_write` and `userinfo.email` scopes.
5. Popup calls `chrome.identity.getProfileUserInfo` to obtain the
   signed-in email.
6. Popup `GET`s `users/<email>/gems.json` (404 ⇒ synthesize an empty
   document), merges the new gems by `id`, and `PUT`s the document back
   with `If-Match: <etag>`. On 412 it refetches and retries once.

### 5.2 SPA read flow

1. User loads the SPA at `localhost:3000`. `AuthProvider` initialises
   GIS, signs the user in (One Tap or button), and immediately requests
   an OAuth access token from the Token Client with the
   `devstorage.read_only` scope.
2. `GemsProvider` lists every object under `users/` in the configured
   bucket, downloads each `gems.json`, and flattens them into a single
   `Gem[]`.
3. Pages (Dashboard, Registry, GemDetail) consume the cached array.

## 6. State Management

| State | Location | Lifetime |
|-------|----------|----------|
| All gem documents | Cloud Storage bucket | Persistent (versioned) |
| Extracted-but-unsaved gems | `chrome.storage.local` | Until cleared / saved |
| ID token + user profile | SPA `localStorage` + memory | Until sign-out |
| OAuth access token (SPA) | SPA memory | 1 hour, auto-refreshed |
| OAuth access token (extension) | Chrome identity cache | Chrome-managed |

There are no shared in-memory caches and no server-side state.

## 7. External Interfaces

### 7.1 Cloud Storage JSON API

The only network surface besides GIS. Endpoints used:

- `GET https://storage.googleapis.com/storage/v1/b/{bucket}/o/{name}?alt=media`
  — download an object.
- `POST https://storage.googleapis.com/upload/storage/v1/b/{bucket}/o?uploadType=media&name={name}`
  — upload (or overwrite) an object. `If-Match: <etag>` enables
  optimistic concurrency.
- `GET https://storage.googleapis.com/storage/v1/b/{bucket}/o?prefix=users/`
  — list user object names.

### 7.2 Google Identity Services

- **SPA:** `https://accounts.google.com/gsi/client` — `google.accounts.id`
  for the ID token, `google.accounts.oauth2.initTokenClient` for the GCS
  access token.
- **Extension:** `chrome.identity.getAuthToken` reads the manifest's
  `oauth2` block and returns an access token for the signed-in Chrome
  profile.

### 7.3 Configuration

| Variable | Used by | Purpose |
|----------|---------|---------|
| `VITE_GOOGLE_CLIENT_ID` | SPA | OAuth client ID for sign-in + GCS access tokens |
| `VITE_GCS_BUCKET` | SPA | Bucket the SPA reads from |
| `bucketName` in `extension/config.js` | Extension | Bucket the extension writes to |
| `oauthClientId` in `extension/config.js` | Extension | Mirrors `manifest.json` for consistency |
| `client_id` in `extension/manifest.json` | Extension | Authoritative OAuth client ID read by `chrome.identity` |

## 8. Key Design Decisions (live)

See ADR-0001 for the rationale behind eliminating the server tier. Decisions
that flow from it and are still load-bearing:

1. **One JSON file per user.** Simplifies write-side concurrency (each user
   owns their own file). Cross-user dedup and search become read-side
   concerns.
2. **Chrome extension writes directly to GCS** using the user's own OAuth
   token, not a backend proxy. Requires CORS and a Chrome-Extension-type
   OAuth client; gives free audit logging.
3. **SPA is read-only.** No write-back from the SPA — all writes go through
   the extension. Avoids needing the SPA to hold a read-write GCS token.
4. **No server-side validation.** The SPA tolerates badly-shaped documents
   at parse time. The bucket trusts authorized writers.

## 9. Extension Points

- **Future Gemini Enterprise publisher** — a separate process that reads
  the bucket on a schedule, produces or updates Enterprise agents. Not yet
  wired up after the rewrite; see
  `docs/specs/gemini-enterprise-publish-SPEC.md` (needs to be redirected
  from the old SQL source).
- **Dedup / search indexer** — a periodic job that scans the bucket and
  writes `index.json` for the SPA to consume. Out of scope for Phase 1.
- **Per-user IAM isolation** — Phase 2 option to switch from group-wide
  bindings to one binding per user with a per-user
  `resource.name.startsWith` condition. Requires Terraform; see
  `docs/deployment/gcs-bucket-setup.md`.
