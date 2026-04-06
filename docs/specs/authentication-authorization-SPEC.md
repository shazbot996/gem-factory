---
type: spec
title: "Gem Factory — Authentication & Authorization"
scope: Cross-module auth layer covering the Chrome extension, API server, and SPA frontend
date: 2026-04-06
---

## 1. Problem Statement

Gem Factory spans three modules — a Chrome extension, an Express API server, and a forthcoming SPA frontend — that all need a coherent authentication and authorization story. Today:

- **The API server** already validates Google ID tokens in production (`server/middleware/auth.js`) and checks admin status against a flat list (`server/middleware/admin.js`), but every authenticated user can see every gem in the registry via `GET /api/gems` with no ownership scoping.
- **The Chrome extension** sends gems to `POST /api/gems/import` via `background.js` (line 42–73), but the request carries **no authentication header**. In dev-bypass mode the API assigns all imports to `dev@localhost`; in production the request would be rejected with 401.
- **The SPA** does not exist yet. Its spec (`docs/specs/spa-frontend-SPEC.md`) describes a Google Identity Services sign-in flow and an `AuthProvider` context, but there is no specification for how the two roles (user vs. admin) affect what data is visible, nor how the extension should supply credentials when it calls the API on behalf of a logged-in user.

Without a unified auth spec:
- Gems imported from the extension in production cannot be associated with the actual user.
- Regular users see the entire registry, including gems they did not import — there is no "my gems" default view enforced by the API.
- The admin/user distinction exists only as middleware guards on mutating operations; it does not shape read access.

This spec defines how authentication and role-based authorization work **across all three modules** so that every gem is tied to its importer and each role sees only what it should.

## 2. Goals & Non-Goals

### Goals

1. **Every gem is traceable to the user who imported it.** The extension must include the user's identity when calling the API, and the API must record it.
2. **Two roles — user and admin — with clear read boundaries.** A regular user's default view shows only their own gems. An admin sees all gems across the entire registry.
3. **Single authentication mechanism.** Google ID tokens (issued by Google Identity Services for Workspace accounts) are the sole credential across all modules.
4. **Extension-to-API auth.** Define how the Chrome extension obtains and sends a valid Bearer token when calling `POST /api/gems/import`.
5. **SPA auth lifecycle.** Define sign-in, token storage, token refresh, sign-out, and how the token propagates to API calls.
6. **Admin determination.** Admins are identified by a flat-file list of email addresses configured via the `ADMIN_EMAILS` environment variable — no database role column, no RBAC tables.

### Non-Goals

- **Complex RBAC.** No additional roles, permissions matrices, or policy engines. The only distinction is admin vs. user.
- **Service-to-service authentication.** No machine-to-machine tokens or API keys. All callers are humans via browser contexts.
- **Session management or server-side sessions.** The API is stateless; every request carries its own ID token.
- **Multi-tenant or multi-domain support.** All users belong to a single Google Workspace domain enforced by the `ALLOWED_DOMAIN` check.
- **OAuth2 scopes or consent screens for accessing Google APIs.** Gem Factory only needs identity (email, name, domain) from the ID token — no Calendar, Drive, or other API access.
- **Audit logging.** Tracking who did what when is a future concern.

## 3. Proposed Solution

### 3.1 Authentication Flow

All three modules share one credential type: a **Google ID token** issued via Google Identity Services (GIS), validated server-side by `google-auth-library`.

- **SPA:** The user signs in with the GIS JavaScript library. The resulting ID token is held in memory (not localStorage) and attached as a `Bearer` token to every API request.
- **Chrome extension:** When the user clicks "Send to API," the extension uses the `chrome.identity.getAuthToken` API (or, for ID tokens specifically, `chrome.identity.launchWebAuthFlow` with the same Google OAuth client) to obtain an ID token for the signed-in Chrome profile. This token is sent as a `Bearer` header alongside the gem payload.
- **API server:** No changes to the existing `server/middleware/auth.js` validation logic. It already verifies the ID token, checks the `hd` (hosted domain) claim, and sets `req.user`.

### 3.2 Authorization Model

Two roles, determined entirely at request time:

| Role | How determined | Default gem visibility | Mutation access |
|------|---------------|----------------------|-----------------|
| **User** | Any authenticated user whose email is NOT in `ADMIN_EMAILS` | Own gems only (`owner_id = current user`) | CRUD on own gems only |
| **Admin** | Email appears in `ADMIN_EMAILS` env var | All gems across all users | CRUD on any gem; can change gem `status` |

The key change from today's behavior: `GET /api/gems` currently returns all gems to all authenticated users. After this spec is implemented, it will default to returning only the requesting user's gems unless the caller is an admin or explicitly passes an `owner` filter (admin only).

### 3.3 Why This Approach

- **Builds on what exists.** The API already validates Google ID tokens and checks admin emails. The extension already calls the API. The SPA spec already describes GIS sign-in. This spec fills the gaps between them.
- **No new infrastructure.** No auth server, no session store, no database role tables. Google does the heavy lifting; the API just verifies tokens.
- **Minimal surface area for mistakes.** Two roles, one token type, one domain — there is very little to get wrong.

## 4. Technical Design

### 4.1 Chrome Extension — Authenticated API Calls

**Current state:** `extension/background.js` lines 42–73 send gems to the API with no `Authorization` header. The `fetch` call at line 50–54 only sets `Content-Type`.

**Required change:** Before calling the API, the background service worker must obtain a Google ID token for the active Chrome user. Two options exist for Manifest V3 extensions:

1. **`chrome.identity.getAuthToken`** — returns an OAuth2 access token, not an ID token. Not directly usable for the API's ID token validation.
2. **`chrome.identity.launchWebAuthFlow`** (preferred) — performs a full OAuth2/OIDC flow in a popup, requesting `openid email profile` scopes with `response_type=id_token`. Returns an ID token that the API can verify with `google-auth-library`.

The extension's `manifest.json` must add the `"identity"` permission and declare an `"oauth2"` section with the same `GOOGLE_CLIENT_ID` used by the API. The `background.js` `SEND_TO_API` handler must:

1. Call `chrome.identity.launchWebAuthFlow` to get an ID token (caching it for reuse until expiry).
2. Include `Authorization: Bearer <id_token>` in the `fetch` headers.
3. On 401 response, clear the cached token and retry once.

The user's email is extracted server-side from the validated token — the extension does not need to send it separately.

### 4.2 API Server — Ownership-Scoped Reads

**File: `server/routes/gems.js`**

The `GET /api/gems` handler (line 53–73) currently accepts an optional `owner` query parameter that filters by email. The required changes:

- If the caller is **not** an admin (`!isAdmin(req.user.email)`), the query must automatically scope results to `owner_id = <current user's id>`. Any `owner` parameter supplied by a non-admin should be ignored or rejected.
- If the caller **is** an admin, the existing behavior is correct: return all gems, optionally filtered by `owner`.

**File: `server/routes/gems.js`** — `GET /api/gems/:id` (line 76–85):
- A non-admin can only retrieve a gem they own. Return 404 (not 403, to avoid leaking existence) if the gem belongs to another user.

**File: `server/routes/users.js`** — `GET /api/users` (line 38–55):
- This endpoint lists all users with gem counts. It should be restricted to admins. Regular users have no need to enumerate other users.

**File: `server/routes/stats.js`** — `GET /api/stats`:
- Org-wide stats (total gems, unique gems, total users) should be admin-only. A regular user could receive stats scoped to their own gems if desired, but this is a nice-to-have.

**File: `server/middleware/auth.js`** — No changes needed to token validation. The `req.user` object already contains `email` and `name`.

**File: `server/middleware/admin.js`** — No changes needed. `isAdmin(email)` and `requireAdmin` middleware are already correct.

### 4.3 API Server — Admin Flag in User Response

The `GET /api/users/me` response (`server/routes/users.js`, line 9–35) should include an `isAdmin` boolean so the SPA can adapt its UI without maintaining a separate admin list client-side:

```json
{
  "id": "...",
  "email": "user@example.com",
  "displayName": "User Name",
  "isAdmin": false,
  "gemCount": 12
}
```

This is derived at response time from `isAdmin(req.user.email)` — no database change.

### 4.4 SPA Frontend — Auth Lifecycle

Per the SPA spec (`docs/specs/spa-frontend-SPEC.md`), the frontend uses Google Identity Services (GIS) with these specifics:

- **Sign-in:** GIS `google.accounts.id.initialize` + `google.accounts.id.renderButton`. On callback, the credential (ID token) is stored in an in-memory React context (`frontend/src/auth/AuthProvider.tsx`).
- **Token propagation:** The `api/client.ts` fetch wrapper reads the token from the auth context and sets `Authorization: Bearer <token>` on every `/api/*` request.
- **Token refresh:** Google ID tokens have a ~1 hour lifetime. The SPA should re-invoke the GIS prompt (or use `google.accounts.id.prompt` for One Tap) before the token expires. On 401 from the API, the SPA should redirect to sign-in.
- **Sign-out:** Clear the in-memory token and call `google.accounts.id.disableAutoSelect()`. No server-side session to invalidate.

### 4.5 SPA Frontend — Role-Based Views

The SPA calls `GET /api/users/me` on sign-in to get the user profile including `isAdmin`. Based on this:

| View | User | Admin |
|------|------|-------|
| Dashboard | Own gems, own stats | All gems, org-wide stats |
| Registry browser | Own gems only (API enforces) | All gems with owner filter |
| Gem detail | Own gems only (API returns 404 for others) | Any gem |
| User list | Not accessible | Full user list with gem counts |
| Status changes | Not available | Available on gem detail |

The SPA should hide admin-only UI elements (user list nav item, status controls) for regular users, but the API is the enforcement point — the frontend is a convenience, not a security boundary.

### 4.6 Schema Changes

**None.** The existing `users` and `gems` tables already model ownership correctly:
- `gems.owner_id` references `users.id`
- `users.email` is unique
- The `idx_gems_owner_hash` unique index enforces per-user dedup

Admin status is purely a runtime check against `ADMIN_EMAILS` — no database column needed given the expected admin count (fewer than 5).

### 4.7 Dev Bypass Mode

The existing dev bypass in `server/middleware/auth.js` (lines 12–18) should continue to work. When `GOOGLE_CLIENT_ID` is unset:
- `req.user` defaults to `dev@localhost` (or the `X-Dev-User-Email` header value).
- The default dev email should be in `ADMIN_EMAILS` so that developers can test admin flows without extra configuration.
- The extension's "Send to API" should also work in dev bypass mode (no token required when `GOOGLE_CLIENT_ID` is empty).

## 5. UI / UX

### 5.1 SPA Sign-In

- A full-page sign-in screen with Google's branded "Sign in with Google" button (rendered by GIS).
- No email/password form — Google Workspace SSO is the only option.
- After sign-in, redirect to the dashboard.
- If the user's domain doesn't match `ALLOWED_DOMAIN`, display a clear error: "Access is restricted to [domain] accounts."

### 5.2 Extension Auth UX

- When the user clicks "Send to API" in the overlay and no cached ID token is available, the extension triggers `launchWebAuthFlow`, which opens a Google sign-in popup.
- After the popup completes, the gem is sent automatically — no second click needed.
- If auth fails or is cancelled, the "Send to API" button shows an error state with the message "Sign-in required."

### 5.3 Admin Indicators

- In the SPA nav bar, an admin sees a small badge or label (e.g., "Admin") next to their profile to confirm elevated access.
- Admin-only nav items (user list) are visible only to admins.
- On gem detail views, admins see a status dropdown that regular users do not.

## 6. Integration Points

### 6.1 Google Identity Services

- **Client ID:** A single OAuth 2.0 client ID is shared across the SPA and Chrome extension. Created in Google Cloud Console with authorized JavaScript origins for both `localhost:3000` (dev) and the production domain.
- **Library:** SPA loads the GIS JavaScript library (`accounts.google.com/gsi/client`). Extension uses `chrome.identity` APIs.
- **Server validation:** `google-auth-library` (`OAuth2Client.verifyIdToken`) — already in use in `server/middleware/auth.js`.

### 6.2 Chrome Extension ↔ API

- The `background.js` `SEND_TO_API` handler adds the Bearer token to the existing fetch call. The API import endpoint (`server/routes/gems.js`, `POST /import`) already upserts the user from `req.user` and associates the gem — no changes needed to the import logic.

### 6.3 Chrome Extension ↔ SPA

- The SPA spec describes `GET_GEMS` / `CLEAR_GEMS` external messages for retrieving extracted gems from the extension. This communication does not involve authentication — it is local, between the extension and the SPA running on the same machine. The `externally_connectable` entry in `manifest.json` (line 14–16) already allows `http://localhost:3000/*`.

### 6.4 Environment Variables

| Variable | Used by | Purpose |
|----------|---------|---------|
| `GOOGLE_CLIENT_ID` | API server, SPA, extension | OAuth client ID for token validation and sign-in |
| `ALLOWED_DOMAIN` | API server | Restricts access to a single Workspace domain |
| `ADMIN_EMAILS` | API server | Comma-separated admin email list |

No new environment variables are introduced.

## 7. Edge Cases & Error Handling

### 7.1 Token Expiry Mid-Session

Google ID tokens expire after ~1 hour. If the SPA receives a 401, it should prompt re-authentication silently (GIS One Tap) or redirect to sign-in. The extension should clear its cached token and re-invoke `launchWebAuthFlow` on 401 (retry once, then surface the error).

### 7.2 User Not in Allowed Domain

The API returns 403 with `"Access restricted to [domain]"`. The SPA should catch this and show a clear message rather than a generic error. The extension should surface this in the overlay button state.

### 7.3 Admin List Changes

If an admin is removed from `ADMIN_EMAILS` and the API is restarted, their next request is treated as a regular user. No token revocation is needed — the role check is per-request. Cached `isAdmin: true` in the SPA will be corrected on the next `GET /api/users/me` call. The SPA should re-fetch the user profile periodically or on navigation to keep the admin flag current.

### 7.4 Extension Used Without API Authentication Configured

In dev-bypass mode (`GOOGLE_CLIENT_ID` is empty), the extension's requests succeed without a token. The extension should detect this (e.g., a successful import without having authenticated) and not prompt for sign-in unnecessarily. The `background.js` handler can attempt the request without a token first; if it gets a 401, then initiate the auth flow.

### 7.5 Concurrent Imports from Extension and SPA

Both the extension ("Send to API") and the SPA import flow call the same `POST /api/gems/import` endpoint. The existing `ON CONFLICT (owner_id, instruction_hash) DO NOTHING` dedup in `server/db/gems.js` (line 5) prevents duplicate gems for the same user. No special handling is needed.

### 7.6 Non-Admin Attempts to Access Admin Endpoints

The API should return 403 for admin-only endpoints (`GET /api/users`, `GET /api/stats`) when called by a regular user. The SPA hides these routes but the API must enforce independently. The existing `requireAdmin` middleware handles this.

## 8. Scope & Milestones

### Milestone 1: API Authorization Hardening

- Scope `GET /api/gems` to the current user's gems for non-admins.
- Scope `GET /api/gems/:id` to owned gems for non-admins.
- Restrict `GET /api/users` and `GET /api/stats` to admins.
- Add `isAdmin` to `GET /api/users/me` response.
- Update API tests.

### Milestone 2: Extension Authenticated Sends

- Add `"identity"` permission and `"oauth2"` config to `extension/manifest.json`.
- Implement token acquisition in `background.js` `SEND_TO_API` handler.
- Handle 401 retry and dev-bypass fallback.
- Bump extension version.

### Milestone 3: SPA Auth Integration

- Implement `AuthProvider`, `useAuth` hook, and `GoogleSignIn` component.
- Wire Bearer token into the API client.
- Implement token refresh and sign-out.
- Implement role-based view rendering using `isAdmin` from `/api/users/me`.
- Route guards for admin-only pages.

Milestones 1 and 2 can proceed in parallel. Milestone 3 depends on the SPA frontend being built (per `docs/specs/spa-frontend-SPEC.md`).

## 9. Success Criteria

1. **No anonymous gems.** Every gem in the `gems` table has an `owner_id` that maps to a real user record with a valid email — verified by a query: `SELECT COUNT(*) FROM gems g LEFT JOIN users u ON g.owner_id = u.id WHERE u.email IS NULL` returns 0.
2. **Ownership scoping enforced.** A non-admin calling `GET /api/gems` receives only their own gems. Calling `GET /api/gems/:id` with another user's gem ID returns 404.
3. **Admin sees everything.** An admin calling `GET /api/gems` without an `owner` filter receives gems from all users.
4. **Extension sends authenticated requests.** With `GOOGLE_CLIENT_ID` configured, the extension's "Send to API" includes a valid Bearer token and the imported gem is associated with the correct user.
5. **Extension works in dev bypass.** With `GOOGLE_CLIENT_ID` unset, the extension's "Send to API" succeeds without prompting for sign-in.
6. **SPA sign-in works.** A user with a valid Workspace account can sign in, see their gems, and be identified correctly via `GET /api/users/me`.
7. **SPA admin view works.** An admin user sees all gems, the user list, and status controls. A regular user does not.
8. **Domain restriction holds.** A Google account outside `ALLOWED_DOMAIN` is rejected with a clear error at both the API and SPA levels.

## 10. Resolved Decisions

1. **`chrome.identity` vs. `launchWebAuthFlow`:** Use `launchWebAuthFlow` with an OIDC flow to get ID tokens. This keeps one validation path across the SPA and extension — the API only ever verifies ID tokens via `google-auth-library`.

2. **`GET /api/stats` access:** Admin-only. Regular users get their gem count from `GET /api/users/me` — no per-user stats endpoint needed.

3. **Token caching in the extension:** Cache the ID token in the service worker's memory with expiry tracking. On 401, clear the cache and acquire a fresh token.

4. **`externally_connectable` origins:** `http://localhost:3000/*` is sufficient for now. The production origin will be added when the hosting domain is finalized.
