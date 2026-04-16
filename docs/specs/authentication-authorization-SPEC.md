---
type: spec
title: "Gem Factory — Authentication & Authorization"
scope: Cross-module auth layer covering the Chrome extension, API server, SPA frontend, and server-side Google Cloud access
date: 2026-04-16
---

## 1. Problem Statement

Gem Factory spans three modules — a Chrome extension, an Express API server, and a React SPA — that all need a coherent authentication and authorization story, plus a fourth concern: how the API server authenticates to Google Cloud when it needs to.

Today:

- **The API server** validates Google ID tokens in production (`server/middleware/auth.js`) and checks admin status against a flat list (`server/middleware/admin.js`), but its identity acceptance is limited to a single Google Workspace domain via the `hd` claim (`ALLOWED_DOMAIN` env var). Personal Gmail accounts — which have no `hd` claim — are rejected.
- **The Chrome extension** sends gems to `POST /api/gems/import` via `popup.js` but carries no Bearer token. Instead, it attaches an `X-Dev-User-Email` header with an email address the user must type manually into the popup. This only works because the API's dev-bypass mode honors that header.
- **The SPA** signs users in with Google Identity Services (`frontend/src/auth/AuthProvider.tsx`), attaches a Bearer token to all `/api/*` calls (`frontend/src/api/client.ts`), and refreshes the token shortly before expiry. It has no mechanism for letting the extension piggyback on its session.
- **Server-side Google Cloud calls** are not yet needed, but when they are (logging, Cloud Storage, BigQuery, Vertex AI, etc.), the server needs a consistent credentials story for both local development and Cloud Run deployment.

Without a unified spec:
- The customer's private organization identity works, but personal Gmail users cannot authenticate.
- The extension's manual email field is error-prone, unverifiable, and a clear UX wart.
- The extension carries no real proof of identity in production.
- There is no stated approach for server-to-Google-Cloud credentials.

## 2. Goals & Non-Goals

### Goals

1. **One sign-in path, two identity types.** Every user of Gem Factory signs in with Google. The system accepts **both personal Gmail accounts and the customer's private organization Google identity**.
2. **Auth starts at the SPA.** The user signs in via Google Identity Services in the browser. That session establishes the token used for all authenticated API calls.
3. **Extension piggybacks on the SPA session.** The Chrome extension does not run its own OAuth flow. It receives the SPA's token via cross-context messaging and uses it as a Bearer token when it calls the API.
4. **Auto-derive the extension's user email.** Remove the manual email input from the extension popup. The email comes from the user's Google authentication — pushed to the extension alongside the token.
5. **Single authentication mechanism on the API.** Google ID tokens (validated by `google-auth-library`) are the sole credential. Identity acceptance is configurable to cover both Gmail and the customer's org domain.
6. **Server → Google Cloud via standard ADC.** Local development uses Application Default Credentials (`gcloud auth application-default login`); Cloud Run uses the service account bound to the service. No custom credential plumbing.
7. **Two roles — user and admin.** A regular user's default view shows their own gems. Admins see everything. Admin status is determined by `ADMIN_EMAILS`.

### Non-Goals

- **A complicated OAuth integration inside the Chrome extension.** No `chrome.identity.launchWebAuthFlow`, no `"oauth2"` block in the manifest, no identity permission.
- **Complex RBAC.** No additional roles, permissions matrices, or policy engines.
- **Server-side sessions.** The API is stateless; every request carries its own ID token.
- **Multi-tenant architecture.** A single deployment serves one customer organization at a time (plus Gmail users).
- **OAuth scopes for Google APIs accessed on behalf of the user.** The ID token only conveys identity (email, name, picture). Server-to-Google-Cloud calls use their own ADC-sourced credentials, not user tokens.
- **Audit logging.** Out of scope.

## 3. Proposed Solution

### 3.1 Client identity — Google Sign-In at the SPA

The SPA is the entry point. A user visits the registry, clicks "Sign in with Google" (rendered by Google Identity Services), and authenticates with either:

- A personal Gmail account (`user@gmail.com`), or
- A Google Workspace / Cloud Identity account belonging to the customer's organization (`user@customer-org.example`).

On success, the SPA receives a Google ID token. `frontend/src/auth/AuthProvider.tsx` decodes the token's payload, stores the token and user info in a React context, and refreshes ~5 minutes before expiry via `google.accounts.id.prompt()`.

`frontend/src/api/client.ts` attaches the token as `Authorization: Bearer <id_token>` on every `/api/*` request. On a 401, the client attempts one silent refresh and retries.

### 3.2 Extension piggybacks on the SPA session

The extension does **not** run its own OAuth flow. The mechanism:

1. After the SPA obtains an ID token (on initial sign-in and on every refresh), it calls `chrome.runtime.sendMessage(EXTENSION_ID, { type: 'SET_AUTH', token, email, name })`.
2. The extension's `background.js` receives this in its `chrome.runtime.onMessageExternal` handler and stores `{ token, email, name, expiresAt }` in `chrome.storage.local` under a new key (e.g., `authSession`).
3. When the SPA signs the user out, it sends `{ type: 'CLEAR_AUTH' }`; the extension clears `authSession`.
4. When the extension's popup clicks "Save to Gem Factory," it reads `authSession` from storage and attaches `Authorization: Bearer <token>` on the `POST /api/gems/import` call. **No more `X-Dev-User-Email` header in production.**
5. If no session is stored (user hasn't signed into the registry in this browser), the popup shows "Please sign in to the Schnucks Gem Registry first" with a link to open the SPA.

Result: the extension remains lightweight (no new permissions, no new OAuth config, no popups to drive the user through). The extension simply relies on a browser session the user has already established at the SPA.

### 3.3 API identity acceptance — Gmail + customer org

The API continues to validate ID tokens with `google-auth-library`'s `OAuth2Client.verifyIdToken()` using the `GOOGLE_CLIENT_ID` as the audience. The domain check becomes a **list-based allow check** instead of a single-domain enforcement:

| Token shape | Identity type | Current behavior | New behavior |
|-------------|---------------|------------------|--------------|
| Has `hd` claim matching `ALLOWED_DOMAIN` | Customer org | Accepted | Accepted |
| Has `hd` claim not matching | Other org | 403 | 403 |
| No `hd` claim, `email` ends `@gmail.com` | Personal Gmail | 403 | Accepted when `ALLOW_GMAIL=true` |
| No `hd` claim, not Gmail | Personal non-Gmail | 403 | 403 |

`ALLOWED_DOMAIN` remains a single string (the customer's org domain). A new env var `ALLOW_GMAIL` (boolean, default `true`) controls whether personal Gmail accounts are accepted. This keeps the current deployment's behavior trivially extendable: set `ALLOWED_DOMAIN=customer-org.example` and leave `ALLOW_GMAIL=true`, and both identity types work.

### 3.4 Server → Google Cloud credentials (ADC)

Whenever the API server calls Google Cloud APIs (e.g., future Cloud Logging, Cloud Storage, BigQuery, or Vertex AI), it uses **Application Default Credentials** via the official Google Cloud client libraries. No explicit credential files in code, no hardcoded service account keys.

- **Local development:** The developer runs `gcloud auth application-default login` once. The resulting credentials live in `~/.config/gcloud/application_default_credentials.json` and are picked up automatically by Google Cloud client libraries inside the Docker container when the credentials file or `GOOGLE_APPLICATION_CREDENTIALS` is mounted in. (Alternative: rely on a host-level `gcloud` session by binding the credentials file into the container.)
- **Cloud Run (production):** The service account attached to the Cloud Run service provides ADC automatically. No env vars, no key files. IAM grants on that service account determine what Google Cloud resources the API can read or write.

This path is entirely separate from client (user) authentication. User ID tokens are never used to call Google Cloud APIs on behalf of the user.

### 3.5 Authorization model — same as before

| Role | How determined | Default gem visibility | Mutation access |
|------|---------------|----------------------|-----------------|
| **User** | Any authenticated user whose email is NOT in `ADMIN_EMAILS` | Own gems only | CRUD on own gems only |
| **Admin** | Email appears in `ADMIN_EMAILS` env var | All gems | CRUD on any gem; can change gem `status` |

`ADMIN_EMAILS` is a comma-separated list (default: `charles.schiele@gmail.com`). Admin status is a runtime check, not a database role.

## 4. Technical Design

### 4.1 API Server — token validation (`server/middleware/auth.js`)

Current behavior (verified today):

- Reads `GOOGLE_CLIENT_ID` and `ALLOWED_DOMAIN` from env.
- If `GOOGLE_CLIENT_ID` is unset: dev bypass — `req.user = { email: 'dev@localhost', name: 'Dev User' }`, or whatever `X-Dev-User-Email` supplies.
- Otherwise: extracts the `Bearer` token, calls `OAuth2Client.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })`, reads the payload, and if `ALLOWED_DOMAIN` is set, enforces `payload.hd === ALLOWED_DOMAIN`.

**Required change:** Replace the single-domain check with the list-based accept logic from section 3.3. Pseudocode:

```javascript
const email = payload.email;
const hd = payload.hd;

const isCustomerOrg = ALLOWED_DOMAIN && hd === ALLOWED_DOMAIN;
const isGmail = !hd && /@gmail\.com$/i.test(email);

if (!isCustomerOrg && !(ALLOW_GMAIL && isGmail)) {
  return res.status(403).json({ error: 'Access restricted to authorized Google accounts' });
}

req.user = { email: payload.email, name: payload.name };
```

### 4.2 API Server — identity-derived user record

The `POST /api/gems/import` handler already upserts the user from `req.user.email` and `req.user.name`, so imports from the extension will automatically create or find the correct user record. No change needed here.

### 4.3 API Server — ownership-scoped reads

Same as the prior spec (still desired):

- `GET /api/gems` (`server/routes/gems.js`) scopes results to the caller's own gems when the caller is not an admin. Admins see all gems and may pass an `owner` filter.
- `GET /api/gems/:id` returns 404 when a non-admin requests another user's gem (not 403, to avoid leaking existence).
- `GET /api/users` and `GET /api/stats` are admin-only.
- `GET /api/users/me` includes `isAdmin: boolean` in the response so the SPA can adapt its UI.

### 4.4 API Server — Google Cloud credentials

The API server code itself does not reference Google Cloud SDK libraries today, but when it does, it should import them in the standard way (`@google-cloud/storage`, `@google-cloud/bigquery`, etc.) without passing credential arguments. The libraries will read ADC automatically:

- In Docker Compose (local dev): the developer binds their local ADC file into the container, e.g., via `docker-compose.yml` volumes:
  ```yaml
  volumes:
    - ~/.config/gcloud:/root/.config/gcloud:ro
  ```
  Or sets `GOOGLE_APPLICATION_CREDENTIALS` if using a service account key file.
- On Cloud Run: nothing to configure — ADC resolves to the bound service account.

This spec does not mandate which Google Cloud products the API will use; it only establishes the credential-acquisition approach for when they are added.

### 4.5 SPA — Google Sign-In and token lifecycle

Already implemented in `frontend/src/auth/AuthProvider.tsx`:

- Loads the GIS library via `<script>` tag in `index.html`.
- Calls `google.accounts.id.initialize({ client_id, callback, auto_select: true })`.
- `google.accounts.id.prompt()` triggers One Tap.
- On credential response, decodes the JWT payload and stores token + user (`email`, `name`, `picture`, `hd`) in React state.
- Passes the token to `api/client.ts` via `setToken()`.
- Schedules refresh 5 minutes before the token's `exp` claim.
- On 401 from the API, attempts one refresh via the API client's `refreshTokenFn`.

**Required additions:**

1. **Push auth to the extension** — immediately after obtaining (or refreshing) a token, `AuthProvider` calls `chrome.runtime.sendMessage(EXTENSION_ID, { type: 'SET_AUTH', token, email, name, expiresAt })` if `VITE_EXTENSION_ID` is configured and the extension is reachable. Failures are non-fatal and silent.
2. **Notify the extension on sign-out** — sends `{ type: 'CLEAR_AUTH' }` when the user signs out.
3. **Support Gmail sign-in** — the GIS initialization should not set `hd` or other restrictions that would prevent personal Google accounts from signing in. The actual accept/reject decision is the API's job.

### 4.6 Extension — receive and use the SPA's token

**`extension/manifest.json`:** No new permissions. The existing `externally_connectable` entry (`http://localhost:3000/*`) is sufficient. A production SPA origin must be added when deployed.

**`extension/background.js`:** Add two new message types to `chrome.runtime.onMessageExternal`:

| Message type | Payload | Action |
|--------------|---------|--------|
| `SET_AUTH` | `{ token, email, name, expiresAt }` | Store as `authSession` in `chrome.storage.local`. Respond `{ success: true }`. |
| `CLEAR_AUTH` | `{}` | Remove `authSession`. Respond `{ success: true }`. |

The existing `GET_GEMS` and `CLEAR_GEMS` handlers remain unchanged.

**`extension/popup.js`:** Remove the manual email input. Replace with:

1. On load, read `authSession` from `chrome.storage.local`.
2. If present: display "Signed in as: `email`" as a read-only line in the header area (no input field).
3. If absent: display "Please sign in to the Schnucks Gem Registry first" with a link that opens the SPA in a new tab. Disable "Save to Gem Factory."
4. `saveToServer()` (currently at popup.js:188) uses `Authorization: Bearer ${authSession.token}` instead of the `X-Dev-User-Email` header.
5. Token-expiry handling: if the stored `expiresAt` has passed, treat it as signed-out (show the sign-in-first message). The SPA will push a fresh token on its next refresh.

**`extension/popup.html`:** Remove the two-field settings panel (API URL + email). Keep the API URL input — it still needs configuring for non-localhost deployments. Replace the email field with the signed-in-as display.

### 4.7 Dev-bypass behavior

When `GOOGLE_CLIENT_ID` is unset on the API server:

- API auth middleware assigns `req.user = { email: 'dev@localhost', name: 'Dev User' }` (or uses `X-Dev-User-Email` if supplied).
- The SPA auto-authenticates as `dev@localhost` when `VITE_GOOGLE_CLIENT_ID` is empty (already implemented in `AuthProvider`).
- In dev bypass, the SPA still pushes `SET_AUTH` to the extension with `token: null, email: 'dev@localhost'`. The extension popup should detect a null token and fall back to sending `X-Dev-User-Email: <email>` instead of a Bearer header. This keeps the dev workflow functional without Google OAuth setup.

### 4.8 Schema changes

**None.** The existing `users.email` (unique) and `gems.owner_id` (FK to users) already model identity and ownership correctly. User records are upserted by email on first import, which works the same whether the identity is Gmail or customer-org.

## 5. UI / UX

### 5.1 SPA Sign-In

- A full-page sign-in screen displaying the Schnucks logo, the "Schnucks Gem Registry" title, a short instruction ("Sign in with your Google account"), and Google's branded sign-in button (rendered by GIS).
- Both personal Gmail and the customer's org account are acceptable. There is no UI distinction between the two.
- After sign-in, navigate to the dashboard.
- If the API returns 403 because the user's identity isn't in the accept-list (e.g., a third-party org domain), show a clear error: "This account isn't authorized for the Schnucks Gem Registry. Please use your Schnucks account or a personal Gmail account."

### 5.2 Extension popup

- **Signed-in state:** Header shows the Schnucks branding, "Signed in as: `email`" in small text, API URL input, gem list, and action buttons. "Save to Gem Factory" is enabled.
- **Signed-out state:** Header shows "Please sign in to the Schnucks Gem Registry first" with an "Open Registry" link (opens the SPA in a new tab). "Save to Gem Factory" is disabled.
- No manual email input in either state.

### 5.3 Admin indicators

- Admins see a small "Admin" badge next to their display name in the SPA nav bar.
- Admin-only nav items (user list) are visible only to admins.
- On gem detail views, admins see status controls that regular users do not.

## 6. Integration Points

### 6.1 Google Identity Services (client-side)

- **Client ID:** A single OAuth 2.0 client ID is used by the SPA (`VITE_GOOGLE_CLIENT_ID` at build time) and validated by the API server (`GOOGLE_CLIENT_ID`). Created in Google Cloud Console with authorized JavaScript origins for `http://localhost:3000` (dev) and the production domain.
- **Library:** SPA loads `https://accounts.google.com/gsi/client`. The extension does **not** use `chrome.identity` or any Google OAuth library — it receives the token from the SPA.

### 6.2 Server-side Google Cloud (ADC)

- **Local:** `gcloud auth application-default login`, then bind `~/.config/gcloud` into the API container.
- **Cloud Run:** a service account is assigned to the Cloud Run service; IAM roles on that service account determine the server's Google Cloud permissions.

### 6.3 SPA ↔ Extension

The SPA pushes auth state to the extension using `chrome.runtime.sendMessage(EXTENSION_ID, …)`. This is the same cross-context messaging path already used for `GET_GEMS` / `CLEAR_GEMS`, gated by the `externally_connectable` entry in `manifest.json`. The extension ID is configured in the SPA via `VITE_EXTENSION_ID`.

### 6.4 Extension ↔ API

The extension sends `Authorization: Bearer <token>` using the token it received from the SPA. The API validates the token exactly as it would for a direct SPA request — it has no way to tell the two apart, nor does it need to. In dev bypass, the extension falls back to `X-Dev-User-Email`.

### 6.5 Environment variables

| Variable | Used by | Purpose |
|----------|---------|---------|
| `GOOGLE_CLIENT_ID` | API server, SPA (as `VITE_GOOGLE_CLIENT_ID`) | OAuth client ID for token validation and sign-in |
| `ALLOWED_DOMAIN` | API server | Customer's org Google Workspace / Cloud Identity domain (checked against the ID token's `hd` claim) |
| `ALLOW_GMAIL` | API server | Boolean (default `true`). When true, personal Gmail accounts are accepted. |
| `ADMIN_EMAILS` | API server | Comma-separated admin email list |
| `VITE_EXTENSION_ID` | SPA build-time | The Chrome extension's ID, used to push auth state |
| `GOOGLE_APPLICATION_CREDENTIALS` | API server (optional, local dev only) | Path to an ADC JSON file if the developer uses a key file instead of `gcloud auth application-default login` |

The Cloud Run service account replaces the need for credentials env vars in production.

## 7. Edge Cases & Error Handling

### 7.1 Token expiry mid-session

The SPA schedules a refresh 5 minutes before `exp`. When the refresh fires, the SPA also pushes the new token to the extension (`SET_AUTH`). If the SPA still gets a 401 (e.g., clock skew), the API client's `refreshTokenFn` attempts a one-shot refresh via `google.accounts.id.prompt()` and retries. If that fails, the user is returned to the sign-in screen, and the SPA sends `CLEAR_AUTH` to the extension.

### 7.2 User is not authorized (wrong identity type)

The API returns 403. The SPA shows the explanatory message described in section 5.1. Extension calls relying on a stored token that was invalidated between sign-in and use will also 403; the popup displays the error and prompts the user to sign in again at the SPA.

### 7.3 Extension has no stored session

The popup shows "Please sign in to the Schnucks Gem Registry first" and disables the save button. Opening the SPA and signing in causes a `SET_AUTH` message to fire automatically; the popup, if still open, should re-read `authSession` (or simply be reopened).

### 7.4 SPA closed while extension is used

The extension uses the last-cached `authSession`. If the token is still valid (within `expiresAt`), the save works. If expired, the popup shows the "sign in first" message. The user opens the SPA (which triggers One Tap sign-in if they're still signed in with Google), which pushes a fresh `SET_AUTH`, and the save can proceed.

### 7.5 Dev-bypass mode

`GOOGLE_CLIENT_ID` unset on the server and `VITE_GOOGLE_CLIENT_ID` unset in the SPA. The SPA auto-signs in as `dev@localhost` and pushes `SET_AUTH` with `token: null`. The extension popup detects the null token and falls back to `X-Dev-User-Email: dev@localhost` for API calls. Manual override: the developer can edit `authSession.email` via the browser's Extension DevTools if they want to impersonate a different user in testing.

### 7.6 Admin list changes

If an admin's email is removed from `ADMIN_EMAILS` and the API is restarted, the next request is treated as a regular user. The SPA's cached `isAdmin` flag corrects itself on the next `/api/users/me` fetch. The SPA should re-fetch the user profile on app mount and after sign-in.

### 7.7 Concurrent signed-in sessions across Chrome profiles

Each Chrome profile has its own extension storage and its own SPA origin session. They do not interfere. Tokens and gems are scoped per-profile.

## 8. Scope & Milestones

### Milestone 1: API identity acceptance — Gmail + org

- Update `server/middleware/auth.js` to support both `hd === ALLOWED_DOMAIN` and Gmail (when `ALLOW_GMAIL=true`).
- Add `ALLOW_GMAIL` to `docker-compose.yml` environment block (default `true`).
- Update API tests to cover both identity types.

### Milestone 2: API authorization hardening

- Scope `GET /api/gems` to the caller's own gems for non-admins.
- Scope `GET /api/gems/:id` to owned gems for non-admins (404 otherwise).
- Restrict `GET /api/users` and `GET /api/stats` to admins.
- Add `isAdmin` to `GET /api/users/me`.

### Milestone 3: SPA → extension auth push

- `AuthProvider` calls `chrome.runtime.sendMessage(EXTENSION_ID, { type: 'SET_AUTH', … })` after initial sign-in and every refresh.
- `AuthProvider.signOut()` sends `CLEAR_AUTH`.
- Gracefully handle `chrome.runtime` being unavailable (SPA doesn't require the extension).

### Milestone 4: Extension session consumption

- Add `SET_AUTH` and `CLEAR_AUTH` handlers to `background.js` (storing in `chrome.storage.local`).
- Remove the manual email input from `popup.html` / `popup.js`.
- Add signed-in-as display and signed-out prompt.
- `saveToServer()` uses `Authorization: Bearer <token>` when a token is present; falls back to `X-Dev-User-Email` when the SPA is in dev bypass.
- Bump extension version (manifest.json).

### Milestone 5: Server-side ADC wiring

- Document ADC setup in `CLAUDE.md` and `docs/context/ARCH.md`.
- When the first Google Cloud SDK library is added, confirm it resolves credentials via ADC in both local dev (mounted `~/.config/gcloud`) and Cloud Run (bound service account).

Milestones 1–2 can proceed in parallel. Milestones 3–4 must ship together (SPA push and extension consumption are coupled). Milestone 5 is deferred until there's a real need for a Google Cloud SDK call.

## 9. Success Criteria

1. **Gmail works.** A user signing in to the SPA with a personal `@gmail.com` account can import gems, see their dashboard, and browse the registry.
2. **Customer org works.** A user signing in with the customer's org Google account can do the same.
3. **Non-allowed org rejected.** A user signing in with a third-party org domain is rejected with 403 and a clear message.
4. **No manual email field in the extension.** The extension popup never asks the user to type their email.
5. **Extension uses the SPA session.** With the SPA signed in, the extension sends `Authorization: Bearer <token>` (verified by inspecting network requests). Imported gems are correctly attributed to the signed-in user.
6. **Sign-out clears the extension.** Signing out of the SPA causes the extension popup to show the "sign in first" prompt.
7. **Dev bypass still works.** With `GOOGLE_CLIENT_ID` unset, the full flow — SPA auth, extension send — works without Google OAuth.
8. **Ownership scoping enforced.** A non-admin calling `GET /api/gems` receives only their own gems; `GET /api/gems/:id` on another user's gem returns 404.
9. **Admins see everything.** An admin calling `GET /api/gems` without filters sees all gems; admin-only endpoints return 200 for admins and 403 for regular users.
10. **ADC ready.** The deployment story for Google Cloud calls is documented; no custom credential plumbing exists in the server code.

## 10. Resolved Decisions

1. **Extension does not do its own OAuth.** It receives the token from the SPA via `chrome.runtime.sendMessage`. This was the central design choice — keeps the extension simple, avoids `launchWebAuthFlow`, and requires no extension manifest changes beyond what's already in place.

2. **Identity acceptance is Gmail OR one configured org domain.** Not multiple orgs. `ALLOWED_DOMAIN` is still a single string. `ALLOW_GMAIL` toggles personal accounts.

3. **Email comes from the ID token, not from the user.** The extension popup's manual email field is removed entirely. In production, the API derives the email from the validated token. In dev bypass, the extension falls back to the `X-Dev-User-Email` header using the email the SPA supplied.

4. **Server → Google Cloud uses ADC.** Local: `gcloud auth application-default login` + mounted credentials directory. Cloud Run: bound service account. No user tokens, no key files in the code.

5. **Token is not persisted across SPA reloads.** The SPA holds it in memory. On reload, GIS auto-select re-establishes it and pushes a fresh `SET_AUTH` to the extension.

6. **No production origin in `externally_connectable` yet.** The `http://localhost:3000/*` entry works for development. Adding the production SPA origin (once the hosting domain is finalized) is a prerequisite for production deployment.
