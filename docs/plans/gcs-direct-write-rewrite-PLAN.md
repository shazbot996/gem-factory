---
type: plan
title: "Gem Factory — Direct-to-GCS Extension Rewrite"
spec: docs/decisions/0001-replace-sql-and-api-server-with-direct-gcs-writes.md
scope: Chrome extension, SPA viewer, server/database retirement, configuration model for bucket targeting
date: 2026-05-14
---

## 1. Goal

Implement the architecture proposed in `docs/decisions/0001-replace-sql-and-api-server-with-direct-gcs-writes.md`: collapse Gem Factory's three-tier deployment (extension + Express API + Cloud SQL) into a single client tier. The Chrome extension will write one JSON file per user directly to a Google Cloud Storage bucket using the user's own OAuth credentials; the SPA becomes a read-only viewer that lists and renders those files. The Express server and Postgres database are retired.

The work targets the existing test bucket `gcs-gem-registry` with `charles.schiele@gmail.com` already granted read + object-write IAM on it. Bucket name and OAuth client ID are concentrated in single config sites so the production bucket swap is a one-line change.

## 2. Context & Prior Art

**Existing extension structure** (`extension/`, currently v0.11.0):

- `manifest.json` — Manifest V3, permissions `storage` + `activeTab`, host permissions for `gemini.google.com`, `localhost:9090`, `*.run.app`. `externally_connectable` exposed to `http://localhost:3000/*` for SPA → extension messaging.
- `background.js` — gem accumulator (`STORE_GEM`/`GET_ALL_GEMS`/`DELETE_GEM`), plus auth piggyback handlers (`SET_AUTH`/`CLEAR_AUTH`) that store an `authSession` pushed by the SPA.
- `content-script.js` — FAB + overlay on the gem edit page; DOM extraction; Drive viewer link capture.
- `popup.js` / `popup.html` — gem list view + "Save to Gem Factory" button. Reads `authSession` and `Authorization: Bearer <token>` POSTs to `/api/gems/import`. Settings: `apiUrl` only.

**Existing SPA structure** (`frontend/src/`):

- `auth/AuthProvider.tsx` — Google Identity Services (GIS) ID-token sign-in, refresh 5 min before expiry, pushes `SET_AUTH` to the extension after sign-in/refresh.
- `api/client.ts` — `apiRequest<T>` wrapper that attaches `Authorization: Bearer <id_token>` and refreshes on 401.
- `api/gems.ts` / `api/users.ts` / `api/stats.ts` / `api/enterpriseSettings.ts` — REST clients for the API endpoints.
- `pages/Dashboard.tsx`, `pages/Registry.tsx`, `pages/GemDetail.tsx`, `pages/EnterpriseSettings.tsx` — consumers of those clients.

**Existing API server + DB** (`server/`): the entire tree is being retired. Reference only — no edits land here except deletion.

**Conventions to preserve:**

- Extension: no build step, no npm, plain browser APIs only (per `CLAUDE.md` § Chrome extension conventions). `textContent` not `innerHTML` for user-supplied data.
- SPA: ES modules, React 19, TypeScript 5.7, Vite 6.3, Tailwind 4.1.
- Versioning: bump `manifest.json` version on each testable change.

**Cloud APIs and libraries:**

- Cloud Storage JSON API — `https://storage.googleapis.com/storage/v1/b/{bucket}/o` for list/get; `https://storage.googleapis.com/upload/storage/v1/b/{bucket}/o?uploadType=media&name={path}` for upload.
- OAuth scope: `https://www.googleapis.com/auth/devstorage.read_write` (extension), `https://www.googleapis.com/auth/devstorage.read_only` (SPA viewer).
- Extension auth: `chrome.identity.getAuthToken` with the manifest `"oauth2"` block.
- SPA auth: GIS Token Client (`google.accounts.oauth2.initTokenClient`) — separate from the existing ID-token flow.
- Identity discovery in the extension: `chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' })` returns `{ email, id }` for the signed-in profile.

## 3. Implementation Steps

### 3.1 Bucket configuration — test bucket and production-swap path

Bucket settings to verify (or apply) on `gcs-gem-registry` via `gcloud` or the Cloud Console. These steps are not code changes — they define the operational shape the extension and SPA expect.

1. **Uniform Bucket-Level Access** enabled. Confirm with `gcloud storage buckets describe gs://gcs-gem-registry --format="value(iamConfig.uniformBucketLevelAccess.enabled)"`. UBLA ensures all permissions flow through IAM (no per-object ACLs).
2. **Object versioning** enabled. `gcloud storage buckets update gs://gcs-gem-registry --versioning`. This gives us free history of every user's gem set (per ADR Consequences).
3. **CORS** configured to allow browser writes from the extension popup origin and the SPA origin. Apply via `gcloud storage buckets update gs://gcs-gem-registry --cors-file=cors.json` where `cors.json` is:
   ```json
   [{
     "origin": ["http://localhost:3000", "chrome-extension://<extension-id>"],
     "method": ["GET", "PUT", "POST", "HEAD"],
     "responseHeader": ["Content-Type", "Authorization", "ETag", "If-Match", "x-goog-meta-*"],
     "maxAgeSeconds": 3600
   }]
   ```
   The `<extension-id>` is the stable ID Chrome assigns the unpacked extension (visible at `chrome://extensions`). Production deployment will add the production SPA origin and the Web-Store-assigned extension ID.
4. **IAM for the test user** (already in place per the user's note): `charles.schiele@gmail.com` has read + object-write. For production, replace this with:
   - Group `gem-importers@<customer-org>` → `roles/storage.objectCreator` + `roles/storage.objectViewer` (group binding, no condition).
   - Admin principals → `roles/storage.objectAdmin`.
   - **Note on per-user prefix isolation:** Cloud Storage IAM Conditions do not support `request.auth.claims.email`. Per-user write isolation requires one IAM binding per user with a per-user `resource.name.startsWith(...)` condition. For Phase 1 we accept group-wide write access and rely on Cloud Audit Logs + object versioning. A follow-up ADR can revisit if this proves insufficient.
5. **Lifecycle rule (optional, recommended for prod):** delete noncurrent versions older than 90 days to bound storage cost.

Document this list in a new `docs/deployment/gcs-bucket-setup.md` so the prod cutover is a checklist, not a recall exercise. Include the `cors.json` snippet and the `gcloud` commands inline.

### 3.2 Register OAuth client for the extension

A Chrome-extension-type OAuth 2.0 client is required so `chrome.identity.getAuthToken` works.

1. In Google Cloud Console (project hosting the bucket) → **APIs & Services → Credentials → Create credentials → OAuth client ID → Chrome Extension**.
2. Set **Application ID** to the extension's Chrome ID (found at `chrome://extensions` after loading unpacked). Capture the resulting client ID.
3. Add the same scope to the OAuth consent screen: `https://www.googleapis.com/auth/devstorage.read_write`. Mark the app as "Internal" if testing inside a Workspace org; otherwise add the test user to the consent screen's allow-list.

This is a one-time configuration step. Capture the client ID in the extension config file in step 3.4.

### 3.3 Add a single `config.js` to the extension

**New file:** `extension/config.js`. Holds the only two values that change between test and prod:

```javascript
// Single source of truth for environment-specific values.
// Swap these when promoting from test to production.
window.GEM_FACTORY_CONFIG = {
  bucketName: 'gcs-gem-registry',
  oauthClientId: '<from step 3.2>.apps.googleusercontent.com',
};
```

Load it as the first script in `popup.html` (`<script src="config.js"></script>` before `popup.js`). In `background.js` and `content-script.js`, use `importScripts('config.js')` (background service worker) or include via a `content_scripts` entry in `manifest.json` so the same object is accessible everywhere.

**Why a window-global instead of a JSON file:** the extension has no build step. A `.js` file that sets a global is the simplest form that all three execution contexts (popup, background service worker, content script) can read with a single line.

### 3.4 Update `manifest.json` for OAuth and storage

**File:** `extension/manifest.json`.

1. Bump `version` to `0.12.0` (next testable change per convention).
2. Add `"identity"` to `permissions`. (`storage` stays; `activeTab` stays.)
3. Add an `"oauth2"` block:
   ```json
   "oauth2": {
     "client_id": "<from step 3.2>.apps.googleusercontent.com",
     "scopes": ["https://www.googleapis.com/auth/devstorage.read_write"]
   }
   ```
   The client ID here must match `config.js`. Manifest requires it inline — we duplicate the value but the manifest is the authoritative declaration.
4. Replace `host_permissions` for `localhost:9090` and `*.run.app` with `https://storage.googleapis.com/*`. Keep `https://gemini.google.com/*`.
5. Remove the `externally_connectable` entry — the SPA no longer pushes auth to the extension (the extension gets its own token via `chrome.identity`).
6. Include `config.js` as a content script (`run_at: document_start`) so the content script sees `GEM_FACTORY_CONFIG`, and load it first in `popup.html`.

### 3.5 Rewrite extension save flow: GCS upload module

**New file:** `extension/gcs.js`. Pure functions for the GCS interactions. Loaded in `popup.html` before `popup.js`.

Exports (attached to `window.GemFactoryGCS`):

- `getAccessToken()` — wraps `chrome.identity.getAuthToken({ interactive: true })` in a Promise, returning the OAuth access token.
- `getUserEmail()` — wraps `chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' })` in a Promise, returning `email`.
- `objectPath(email)` — returns `users/${encodeURIComponent(email)}/gems.json`. Encoding `@` is unnecessary in URL paths but consistent encoding avoids edge cases.
- `loadUserGems(bucket, email, token)` — GET `https://storage.googleapis.com/storage/v1/b/{bucket}/o/{encoded-path}?alt=media`. Returns the parsed JSON, or `{ schemaVersion: 1, owner: email, updatedAt: null, gems: [] }` on 404.
- `saveUserGems(bucket, email, token, document, etag)` — PUT to the upload URL. Use `If-Match: ${etag}` when an etag is supplied for optimistic concurrency; omit it on first write.

GCS endpoints used:

- **GET (download):** `https://storage.googleapis.com/storage/v1/b/{bucket}/o/{urlEncodedPath}?alt=media`. Captures `ETag` from response headers.
- **PUT (upload, simple/media):** `https://storage.googleapis.com/upload/storage/v1/b/{bucket}/o?uploadType=media&name={urlEncodedPath}`. `Content-Type: application/json`. `Authorization: Bearer ${token}`.

Code sketch for the upload path:

```javascript
async function saveUserGems(bucket, email, token, document, etag) {
  const name = `users/${encodeURIComponent(email)}/gems.json`;
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(name)}`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
  if (etag) headers['If-Match'] = etag;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(document) });
  if (!res.ok) throw new Error(`GCS upload failed: ${res.status} ${await res.text()}`);
  return res;
}
```

Note: the JSON API uses `POST` to the `/upload/...` endpoint with `uploadType=media` for the "simple upload" pattern (despite this conceptually being a PUT-by-name).

### 3.6 Rewrite `popup.js` save handler

**File:** `extension/popup.js`.

1. Delete the `currentSession` / `loadAuthSession` / `isSessionUsable` / `renderAuthStatus` block. Delete the `chrome.storage.onChanged` listener — no more SPA-pushed sessions.
2. Replace with `currentEmail` (string, populated from `getUserEmail()` on popup load) and a corresponding `renderAuthStatus(email)` that shows "Signed in as: `email`" once known, or "Click 'Save' to authorize" before the first save.
3. Replace `apiUrl` setting with `bucketName` setting (read-only display from `GEM_FACTORY_CONFIG.bucketName`; we keep it visible for transparency but no longer editable through the UI — config.js is the source of truth).
4. Rewrite `saveToServer(gems, btn)` as `saveToGCS(gems, btn)`:
   ```javascript
   async function saveToGCS(gems, btn) {
     btn.disabled = true;
     btn.textContent = 'Saving…';
     try {
       const bucket = window.GEM_FACTORY_CONFIG.bucketName;
       const token = await window.GemFactoryGCS.getAccessToken();
       const email = currentEmail || await window.GemFactoryGCS.getUserEmail();
       currentEmail = email;
       renderAuthStatus(email);

       const { document: existing, etag } = await window.GemFactoryGCS.loadUserGems(bucket, email, token);

       const merged = mergeGems(existing.gems || [], gems);
       const next = {
         schemaVersion: 1,
         owner: email,
         updatedAt: new Date().toISOString(),
         gems: merged,
       };

       await window.GemFactoryGCS.saveUserGems(bucket, email, token, next, etag);
       showStatus(`Saved ${gems.length} gem${gems.length === 1 ? '' : 's'} to ${bucket}`, 'success');
     } catch (err) {
       showStatus('Error: ' + err.message, 'error');
     } finally {
       btn.disabled = false;
       btn.textContent = 'Save to Registry';
     }
   }

   function mergeGems(existingGems, newGems) {
     const byId = new Map(existingGems.map(g => [g.id, g]));
     for (const g of newGems) byId.set(g.id, g);  // overwrite by gemini id
     return Array.from(byId.values());
   }
   ```
5. Remove the "Save to Gem Factory" label and use "Save to Registry"; rename the button class if desired. Leave "Copy JSON" and "Clear" buttons unchanged.

### 3.7 Update `background.js`

**File:** `extension/background.js`.

1. Remove the `chrome.runtime.onMessageExternal` listener entirely. The SPA no longer pushes auth state or queries the extension. (`GET_GEMS`/`CLEAR_GEMS`/`SET_AUTH`/`CLEAR_AUTH` all go.)
2. Keep the internal `STORE_GEM` / `GET_ALL_GEMS` / `DELETE_GEM` handlers — these are still used by `content-script.js` and `popup.js` for the local in-memory cache of extracted gems before save.
3. Add `importScripts('config.js')` at the top so the service worker has access to `GEM_FACTORY_CONFIG` if needed (not strictly necessary for Phase 1 but reserves the pattern).

### 3.8 SPA: replace API client with GCS read-only client

**New file:** `frontend/src/api/gcsClient.ts`. Token-bearing fetch wrapper around the Cloud Storage JSON API.

Key functions:

- `setGcsAccessToken(token: string)` — module-level setter called from `AuthProvider` after the token client returns.
- `listUserObjects(bucket: string): Promise<GcsObject[]>` — GET `https://storage.googleapis.com/storage/v1/b/{bucket}/o?prefix=users/` and return the `items` array.
- `downloadObject(bucket: string, name: string): Promise<UserGemsDocument>` — GET `.../o/{encoded-name}?alt=media`.
- `loadAllGems(bucket: string): Promise<Gem[]>` — list, then download each, flatten into a single gem array with owner attribution.

**New file:** `frontend/src/config.ts`. Single config site (mirrors the extension's `config.js`):

```typescript
export const config = {
  bucketName: import.meta.env.VITE_GCS_BUCKET || 'gcs-gem-registry',
  oauthClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
};
```

Add `VITE_GCS_BUCKET=gcs-gem-registry` to `frontend/.env.development`.

### 3.9 SPA: add GIS Token Client alongside ID-token sign-in

**File:** `frontend/src/auth/AuthProvider.tsx`.

The SPA already obtains an ID token (for identity). It now also needs an OAuth access token for GCS reads. These are distinct flows in GIS:

- ID token (existing): `google.accounts.id.initialize` + `google.accounts.id.prompt()`.
- Access token (new): `google.accounts.oauth2.initTokenClient({ client_id, scope: 'https://www.googleapis.com/auth/devstorage.read_only', callback })`.

1. Add an `accessToken` field to the `AuthContext` shape (currently `{ user, token, isAuthenticated, ... }`).
2. On successful ID-token sign-in, initialize a token client with the same `client_id` and the `devstorage.read_only` scope; call `tokenClient.requestAccessToken({ prompt: '' })` to get a silent token. On callback, store the access token and call `setGcsAccessToken(...)` on the GCS client module.
3. Token expiry: GCS access tokens last 1 hour. Schedule a refresh at `expires_in - 300` seconds via `setTimeout`, identical to the existing ID-token refresh pattern.
4. **Remove** the existing `SET_AUTH` / `CLEAR_AUTH` `chrome.runtime.sendMessage` calls — the extension is no longer a downstream of SPA auth.

### 3.10 SPA: rewrite Dashboard, Registry, GemDetail against GCS

**Files:** `frontend/src/pages/Dashboard.tsx`, `Registry.tsx`, `GemDetail.tsx`. Plus delete `frontend/src/api/gems.ts`, `users.ts`, `stats.ts`, `enterpriseSettings.ts`, `client.ts` once nothing imports them.

Approach: a single hook `useAllGems()` in `frontend/src/data/useAllGems.ts` that:

1. On mount, calls `gcsClient.loadAllGems(config.bucketName)`.
2. Returns `{ gems, loading, error, reload }`.
3. Caches in a React context so all three pages share one fetch.

Page rewrites:

- **Dashboard:** filter `gems` to those owned by `auth.user.email`. Reuse `GemTable.tsx` unchanged.
- **Registry:** show all gems, client-side search (case-insensitive substring across `name`, `description`, `instructions`), client-side filter by `owner` email, paginate in memory. Drop the debounced API call in `SearchBar.tsx` — search becomes instant since data is local.
- **GemDetail:** look up gem by `id` within the loaded set. No separate fetch.
- **Stats card on Dashboard:** compute totals in JS from the loaded gems (`total = gems.length`, `contributors = new Set(gems.map(g => g.owner.email)).size`).

Delete the gem **edit/delete** UI in `GemDetail.tsx` for now. The SPA is read-only in this rewrite; deletes happen by re-running the extension and removing the gem from the local cache before save (or, eventually, a dedicated "manage my gems" page that uses the read-write token). Note as future work.

### 3.11 Decommission API server and database

Once 3.5–3.10 are in place and verified, retire the server tier in a single commit:

1. Delete `server/` (entire tree).
2. Delete `docker-compose.yml`.
3. Remove `make api-start`, `api-stop`, `api-test`, `api-logs`, `db-init`, `db-test` targets from `Makefile`. Keep `spa-install`, `spa-dev`, `spa-build`, `voicecode`.
4. Delete `.db-config` (gitignored — local cleanup only).
5. Remove the production-build output path; `spa-build` should now write to `frontend/dist/` instead of `../server/public/`. Update `frontend/vite.config.ts` `build.outDir`.
6. Delete unused frontend files: `frontend/src/api/client.ts`, `gems.ts`, `users.ts`, `stats.ts`, `enterpriseSettings.ts`, `frontend/src/pages/EnterpriseSettings.tsx` (or repoint it to a placeholder if the enterprise-publish work needs it later).

### 3.12 Documentation updates

1. **`CLAUDE.md`** — rewrite the "API server", "Database", and "Docker Compose" sections. Replace with a "GCS bucket" section describing the test/prod targets and the `config.js`/`config.ts` swap point. Update the directory tree.
2. **`docs/context/ARCH.md`** — supersede the current architecture diagram and component descriptions. The new ARCH is two boxes: "Chrome extension" and "SPA viewer," both pointing at a GCS bucket. Link back to ADR-0001 as the trigger.
3. **`docs/specs/authentication-authorization-SPEC.md`** — mark §3.2 (SPA → extension auth push) as deprecated. Update §3.3 (API identity acceptance) to describe IAM bindings on the bucket instead. Add a new section for "Extension OAuth via `chrome.identity`."
4. **`docs/decisions/0001-replace-sql-and-api-server-with-direct-gcs-writes.md`** — flip status from **Proposed** to **Accepted** in the frontmatter and Status section, and amend the IAM Condition example (the `request.auth.claims.email` claim is not actually supported on GCS — see step 3.1 note).
5. **`docs/deployment/gcs-bucket-setup.md`** (new, from step 3.1) — operational runbook.

## 4. Data Model — JSON document shape on GCS

**Path:** `users/{email}/gems.json` (object name; `users/` is a logical prefix, not a directory).

**Document shape (schemaVersion 1):**

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
        { "name": "...", "type": "...", "mimeType": "...", "driveId": "...", "driveUrl": "..." }
      ],
      "defaultTools": ["..."],
      "source": "edit_page",
      "extractedAt": "2026-05-14T17:22:54.000Z"
    }
  ]
}
```

**Compatibility note:** the SPA reader should treat any unrecognized fields as opaque and forward them through. Readers must tolerate missing fields (`description`, `knowledgeFiles`, `defaultTools` may be absent on older saves). `schemaVersion` increments only on breaking changes.

**Identity (`owner` / object path):** the user's email as returned by `chrome.identity.getProfileUserInfo`. This matches the email claim in the SPA's ID token, so the SPA can attribute gems to the right user without an extra lookup.

## 5. Integration Points

- **Extension ↔ GCS:** direct REST via the JSON API. No intermediary.
- **SPA ↔ GCS:** direct REST via the JSON API, read-only scope.
- **Extension ↔ SPA:** **removed entirely.** The `externally_connectable` manifest entry and the `SET_AUTH`/`CLEAR_AUTH`/`GET_GEMS`/`CLEAR_GEMS` message types are deleted. The SPA and extension are now independent.
- **Identity:** Google Sign-In remains the universal entry point. Same OAuth client ID is referenced from both extension manifest and SPA config; same `oauth2` consent screen approves both `devstorage.read_only` (SPA) and `devstorage.read_write` (extension).
- **Bucket-target swap:** changing `extension/config.js` (`bucketName`) and `frontend/.env.development` (`VITE_GCS_BUCKET`) + bumping the manifest version is the entire prod cutover from the client side. Bucket-side cutover is the IAM bindings and CORS in step 3.1.

## 6. Edge Cases & Risks

- **CORS misconfiguration is the most likely first-day failure.** Symptoms: `fetch` from the popup fails with a CORS error before the request hits GCS. Mitigation: apply `cors.json` (step 3.1) before the first save attempt; the extension's `chrome-extension://<id>` origin **must** be listed.
- **Race on concurrent saves from two browser sessions.** Two windows saving for the same user could clobber each other. Mitigation: `If-Match: <etag>` on PUT — on 412 Precondition Failed, re-fetch and retry once. Code sketch already in step 3.5.
- **OAuth consent screen friction on first save.** `chrome.identity.getAuthToken({ interactive: true })` shows a Google account picker / consent prompt the first time. Acceptable UX; document in the popup as "Click Save to authorize."
- **Token expiry mid-session in the SPA.** Access tokens expire at 1 hour; ID tokens at 1 hour. The SPA must refresh the access token independently of the ID token (different GIS APIs). Handle 401 from GCS by re-requesting via the token client.
- **Email-character edge cases in object paths.** `+`, `.`, and case are all preserved in Gmail addresses. `encodeURIComponent` handles the path safely. Note: `users/Alice@example.com/...` and `users/alice@example.com/...` are different paths — normalize to lower-case in `objectPath(email)`.
- **Service-worker lifecycle.** The background service worker is ephemeral. Don't cache OAuth tokens in worker memory — call `chrome.identity.getAuthToken` each time (it returns cached tokens transparently).
- **Bucket name leakage.** The bucket name is visible in client source (extension and SPA). This is expected — security comes from IAM, not name secrecy.
- **Removing the `externally_connectable` entry is a breaking change for older extension versions.** Anyone on v0.11.0 who still has the SPA open will hit silent failures on `SET_AUTH`. Acceptable for an internal tool — bump the manifest version and document it.
- **Gmail in production.** Per ADR Consequences: the convenient `ALLOW_GMAIL` toggle disappears. For the test phase, `charles.schiele@gmail.com` is bound directly. For prod, list explicit Gmail principals or move them onto the Workspace org.
- **No server-side validation.** The bucket will accept any well-formed JSON the user PUTs. The SPA reader must defensively validate (`gems` is an array, each gem has required fields). Bad data from one user shows up as a render error scoped to their row, not a global outage.

## 7. Verification

### Per-step manual checks

- **3.1 (bucket):** `gsutil cors get gs://gcs-gem-registry` shows the expected origins. `gcloud storage objects list gs://gcs-gem-registry/users/` works (will be empty initially).
- **3.2 (OAuth client):** Cloud Console shows a Chrome Extension OAuth client with the right application ID.
- **3.3 (config.js):** `chrome.runtime.getURL('config.js')` opens in the browser and shows the expected object.
- **3.4 (manifest):** `chrome://extensions` shows v0.12.0, `identity` permission, and no errors.
- **3.5–3.6 (save flow):** load unpacked, navigate to a gem edit page, click FAB, then in popup click Save. On first run, a Google consent dialog appears. After approval, `gcloud storage cat gs://gcs-gem-registry/users/charles.schiele@gmail.com/gems.json` shows the saved JSON. Run a second save and confirm the etag round-trip works (no 412).
- **3.7 (background):** check `chrome://extensions → service worker` log shows no errors; no stray `SET_AUTH` handler invocations.
- **3.8–3.10 (SPA):** `make spa-dev`, sign in with the same Gmail account, dashboard renders the saved gem. Manually upload a second user's `users/foo@example.com/gems.json` via `gcloud storage cp` and confirm Registry shows both owners.
- **3.11 (decommission):** `make api-start` no longer exists; SPA still runs entirely against GCS.

### Acceptance criteria

1. A user can sign into Chrome, install the extension, visit a gem edit page on `gemini.google.com`, click Save, and produce a `users/<email>/gems.json` in `gs://gcs-gem-registry/` with the expected shape — without any Express server running.
2. The SPA at `localhost:3000`, signed in with the same account, displays that gem on the Dashboard.
3. Switching to a different bucket requires editing exactly two files: `extension/config.js` and `frontend/.env.development` (plus rebuilding/reloading the extension and SPA).
4. The `server/` tree and `docker-compose.yml` are gone from the repo.
5. No `Authorization: Bearer <id_token>` calls are made anywhere — only access tokens with the `devstorage.*` scope.

### Automated tests

The current server-side test suite (`server/test/`) is deleted with the server tree. New automated tests are not in scope for Phase 1 — the surface is small and manual verification is sufficient. A follow-up could add Playwright coverage of the SPA flow once the architecture stabilizes.

## 8. Open Questions

1. **Gmail principals in production.** Do we keep Gmail support at all? If yes, do we maintain an allow-list of individual Gmail addresses on the bucket, or require all real users to be in the Workspace org? Recommendation: drop Gmail in prod; keep `charles.schiele@gmail.com` only as the maintainer's bound principal.
2. **Per-user prefix isolation in prod.** Phase 1 accepts group-wide write access. Do we want the per-user-condition-binding approach for prod? Cost: one IAM binding per user, managed via Terraform. Benefit: a compromised user account can only damage their own file. Recommend revisiting once user count is known.
3. **Dedup and search.** The ADR flags both as moving to a read-side concern. For Phase 1, the SPA does client-side search across all loaded gems (works at our scale). A periodic indexer that produces `gs://.../index.json` is a separate workstream — track as a follow-up, not in this plan.
4. **Edit/delete from the SPA.** Currently dropped (read-only viewer). Adding write-back from the SPA would require the SPA to hold a read-write token, not read-only. Defer until there's a concrete need.
5. **Enterprise-publish job rewiring.** `docs/specs/gemini-enterprise-publish-SPEC.md` assumes a Postgres source. It needs to be redirected to read the bucket. Out of scope for this plan; track as a follow-up plan.
6. **Where does the SPA get deployed?** It's no longer served by Cloud Run. Options: Cloud Storage static-site hosting on the same bucket (`gs://gcs-gem-registry/_site/`), Firebase Hosting, or simply a developer-machine `make spa-dev` for the test phase. Recommendation: defer deployment until the architecture has been validated locally; for now, dev-server-only is fine.
