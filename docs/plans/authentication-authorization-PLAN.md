---
type: plan
title: "Authentication & Authorization Implementation"
spec: docs/specs/authentication-authorization-SPEC.md
scope: Implement Google Sign-In with Gmail + customer-org support, SPA sign-in UX, SPA→extension token push, auto-derived email, ownership-scoped reads, and ADC for server→Google Cloud
date: 2026-04-16
---

## 1. Goal

Implement the auth design described in `docs/specs/authentication-authorization-SPEC.md`: every user signs in with Google (accepting both personal Gmail and the customer's organization identity), the SPA holds the session and pushes its token to the Chrome extension for piggyback auth, the manual email field disappears from the extension popup, the API enforces ownership scoping for non-admins, and the server is set up to use Application Default Credentials for any future Google Cloud calls.

This plan is structured as **six phases** that group related changes and can land in separate commits. Phases 1 and 2 (API changes) are independent and can ship first. Phase 3a makes the SPA's sign-in actually usable (documentation for the OAuth client plus a fix for the dev-bypass sign-out trap) and is a prerequisite for testing Phases 3 and 4 with real Google accounts. Phases 3 and 4 (SPA push + extension receive) are coupled and must ship together. Phase 5 (ADC) is documentation-only until the first Google Cloud call is needed.

## 2. Context & Prior Art

### Key files this plan touches

**API server:**
- `server/middleware/auth.js` — current single-domain `hd` check at line 34; needs Gmail support.
- `server/middleware/admin.js` — `isAdmin()` and `requireAdmin` already implemented; reused as-is.
- `server/routes/gems.js` — `GET /api/gems` and `GET /api/gems/:id` need ownership scoping for non-admins.
- `server/routes/users.js` — `GET /api/users/me` needs `isAdmin` flag; `GET /api/users` needs admin gate.
- `server/routes/stats.js` — needs admin gate.
- `server/db/users.js` — `findByEmail()` and `upsertUser()` already handle per-email user records; no schema changes.
- `docker-compose.yml` — adds `ALLOW_GMAIL` env var passthrough.

**SPA:**
- `frontend/src/auth/AuthProvider.tsx` — already does GIS initialize + refresh + signOut; needs to push/clear auth to the extension.
- `frontend/src/api/client.ts` — already attaches Bearer tokens and retries on 401; no changes beyond possible response-type updates.
- `frontend/src/api/users.ts` — `getMe()` already defined; response type needs `isAdmin`.
- `frontend/src/api/types.ts` — `UserProfile` type needs `isAdmin: boolean`.
- `frontend/src/extension/useExtension.ts` — existing `sendMessage` helper is a good reference for the AuthProvider's push call.

**Extension:**
- `extension/manifest.json` — `externally_connectable` already allows `http://localhost:3000/*`; no new permissions needed. Version bump.
- `extension/background.js` — `onMessageExternal` handler needs `SET_AUTH` and `CLEAR_AUTH` cases.
- `extension/popup.html` — remove the email input field.
- `extension/popup.js` — remove email input logic, read `authSession` from storage, use Bearer token.

### Existing patterns to follow

- **Message-type dispatch in `background.js`:** switch on `message.type`, return `true` from the listener to keep `sendResponse` alive for async work, store in `chrome.storage.local`.
- **API client error handling in `api/client.ts`:** throws `ApiError` with `status`; `AuthProvider` wires `refreshTokenFn` via `setRefreshToken()`.
- **Dev-bypass detection:** API checks `!GOOGLE_CLIENT_ID`; SPA checks `!import.meta.env.VITE_GOOGLE_CLIENT_ID`; both fall back to `dev@localhost`. Extension should detect "dev bypass" by `authSession.token === null`.

### Dependencies

- No new npm packages on either side. `google-auth-library` (server) and the GIS script tag (SPA) are already in place.
- No schema changes.

## 3. Implementation Steps

### Phase 1 — API identity acceptance (Gmail + org)

#### Step 1.1: Add `ALLOW_GMAIL` env var support in `server/middleware/auth.js`

- **What:** Replace the single-domain `hd` check with the dual-accept logic from spec §3.3.
- **Where:** `server/middleware/auth.js` lines 3–5, 34–36.
- **How:** Read `ALLOW_GMAIL` (default `'true'`) alongside `ALLOWED_DOMAIN`. Replace the block at lines 34–36:

  ```javascript
  const ALLOW_GMAIL = process.env.ALLOW_GMAIL !== 'false'; // default true

  // ...inside the try block, after getting payload:
  const isCustomerOrg = ALLOWED_DOMAIN && payload.hd === ALLOWED_DOMAIN;
  const isGmail = !payload.hd && /@gmail\.com$/i.test(payload.email || '');

  if (!isCustomerOrg && !(ALLOW_GMAIL && isGmail)) {
    return res.status(403).json({
      error: 'This account is not authorized. Use your organization account or a personal Gmail account.',
    });
  }
  ```

- **Why:** Enables personal Gmail users to sign in without loosening the org-domain check. Controlled by a single explicit env flag.

#### Step 1.2: Add `ALLOW_GMAIL` to `docker-compose.yml`

- **What:** Pass `ALLOW_GMAIL` through from the host environment with a default.
- **Where:** `docker-compose.yml` line 11 (inside the `environment:` block).
- **How:** Add `ALLOW_GMAIL: "${ALLOW_GMAIL:-true}"` after `ADMIN_EMAILS`.

#### Step 1.3: Update the auth test

- **What:** Extend `server/test/auth.test.js` with cases covering (a) customer-org token accepted, (b) Gmail token accepted when `ALLOW_GMAIL=true`, (c) Gmail rejected when `ALLOW_GMAIL=false`, (d) third-party domain rejected.
- **Where:** `server/test/auth.test.js`.
- **How:** Follow the existing test style (node's built-in test runner via `node --test`). Mock the `OAuth2Client.verifyIdToken` response with different `hd` / `email` payloads and assert the middleware's next/response behavior.

### Phase 2 — API ownership scoping and admin gating

#### Step 2.1: Scope `GET /api/gems` to the caller for non-admins

- **What:** When the caller is not an admin, force `owner = req.user.email` on the `listGems` query regardless of what's in the query string.
- **Where:** `server/routes/gems.js` lines 53–73 (the GET `/` handler).
- **How:**

  ```javascript
  import { isAdmin } from '../middleware/admin.js';
  // ...
  const admin = isAdmin(req.user.email);
  const ownerFilter = admin ? (req.query.owner || null) : req.user.email;

  const { gems, total } = await gemsDb.list(pool, {
    q: req.query.q || null,
    owner: ownerFilter,
    status: req.query.status || null,
    page, limit,
  });
  ```

- **Why:** Enforces the "own gems only" default without breaking admin flexibility.

#### Step 2.2: Scope `GET /api/gems/:id` to the owner or admin

- **What:** Return 404 (not 403) when a non-admin requests someone else's gem.
- **Where:** `server/routes/gems.js` lines 76–85.
- **How:** After `findById`, check `if (!isAdmin(req.user.email) && gem.owner.email !== req.user.email) return res.status(404).json({ error: 'Gem not found' });`.
- **Why:** 404 rather than 403 prevents leaking existence of other users' gems.

#### Step 2.3: Gate `GET /api/users` behind `requireAdmin`

- **What:** Apply the existing `requireAdmin` middleware.
- **Where:** `server/routes/users.js` at the `router.get('/', ...)` handler (the list endpoint).
- **How:** Import `requireAdmin` from `../middleware/admin.js` and add it as middleware: `router.get('/', requireAdmin, async (req, res) => { ... })`. Do **not** apply it to `/me`.

#### Step 2.4: Gate `GET /api/stats` behind `requireAdmin`

- **What:** Same pattern as 2.3.
- **Where:** `server/routes/stats.js`.
- **How:** Import and apply `requireAdmin` on `router.get('/', ...)`.

#### Step 2.5: Add `isAdmin` to `GET /api/users/me`

- **What:** Include `isAdmin: boolean` in the `/me` response so the SPA can render role-specific UI.
- **Where:** `server/routes/users.js` lines 9–35.
- **How:** Import `isAdmin` from `../middleware/admin.js`. In both response branches (user-not-in-DB and user-in-DB), add `isAdmin: isAdmin(req.user.email)`. Update `frontend/src/api/types.ts` `UserProfile` in a later step.

#### Step 2.6: API tests for ownership scoping

- **What:** Extend `server/test/api.test.js` with: (a) non-admin A's list returns only A's gems, (b) admin's list with `?owner=A@` returns A's gems, (c) non-admin fetching B's gem ID returns 404, (d) non-admin `GET /api/users` returns 403, (e) non-admin `GET /api/stats` returns 403, (f) `/api/users/me` includes `isAdmin` matching `ADMIN_EMAILS`.

### Phase 3a — SPA sign-in UX and OAuth configuration

**Why this phase exists:** the SPA today is usable only in dev-bypass mode because `VITE_GOOGLE_CLIENT_ID` is empty. Clicking "Sign out" in dev bypass drops the user on a SignInPage with no working button, because `<GoogleSignIn />` returns `null` when no client ID is configured and `AuthProvider`'s `useEffect` doesn't re-fire to re-auto-sign-in. This phase fixes that trap, updates the sign-in copy to reflect Gmail + org acceptance, and documents how to configure a real OAuth client ID so developers can test production-mode sign-in locally.

#### Step 3a.1: Expose `signInAsDev` in the auth context

- **What:** Add a `signInAsDev()` method to `AuthContextType` that re-runs the dev-bypass auto-auth (sets `user` back to `dev@localhost`). Only meaningful when `VITE_GOOGLE_CLIENT_ID` is empty.
- **Where:** `frontend/src/auth/AuthProvider.tsx`.
- **How:** Add a `useCallback` that, when `!clientId`, calls the same `setUser` / `setToken` / `setApiToken` sequence used in the mount-time dev-bypass branch (lines 104–110). Export through the `AuthContextType` interface and the `AuthContext.Provider` value. No-op when a client ID is present.

#### Step 3a.2: Fix the SignInPage in dev-bypass mode

- **What:** When `VITE_GOOGLE_CLIENT_ID` is empty, the SignInPage must show an escape hatch instead of a dead GIS button.
- **Where:** `frontend/src/App.tsx` `SignInPage` component.
- **How:** Read `import.meta.env.VITE_GOOGLE_CLIENT_ID` at render time. If empty, show an explanatory paragraph and a "Continue as dev user" button that calls `signInAsDev()` from `useAuth()`. If set, show the existing `<GoogleSignIn />` button. The dev-mode copy should name `VITE_GOOGLE_CLIENT_ID` and point to `frontend/.env.development.local` so the fix is discoverable.

#### Step 3a.3: Update the sign-in copy

- **What:** The existing copy reads "Sign in with your corporate Google account." Per spec §2 goal 1, personal Gmail is also accepted. Update copy accordingly.
- **Where:** `frontend/src/App.tsx` `SignInPage`.
- **How:** Replace with "Sign in with your Google account" (or, more specifically, "your Schnucks account or personal Gmail").

#### Step 3a.4: Improve `.env.development.local.example` with OAuth-client guidance

- **What:** Add inline documentation to `frontend/.env.development.local.example` so a developer can see exactly what to set and where to get it, without needing to read external docs.
- **Where:** `frontend/.env.development.local.example`.
- **How:** Replace with commented instructions covering: create a Google Cloud project, create an OAuth 2.0 Web client, add `http://localhost:3000` to authorized JavaScript origins, then paste the client ID into `VITE_GOOGLE_CLIENT_ID`. Reference the CLAUDE.md section (added below) for the step-by-step.

#### Step 3a.5: Document OAuth client setup in CLAUDE.md

- **What:** A short "Frontend — enabling real Google Sign-In" section under the Frontend heading in `CLAUDE.md`.
- **Where:** `CLAUDE.md`, Frontend SPA section.
- **How:** Add a subsection describing the Google Cloud Console steps: create an OAuth 2.0 Client ID (type: Web application), authorized JavaScript origin `http://localhost:3000`, then copy the client ID into `frontend/.env.development.local`. Note that the same client ID must be set as `GOOGLE_CLIENT_ID` on the API server (already passed through via `docker-compose.yml`) for token validation to work.

#### Step 3a.6: Verify the fix

- Load the SPA with `VITE_GOOGLE_CLIENT_ID` empty → auto-signed in as `dev@localhost`.
- Click Sign out → SignInPage shows "Continue as dev user" button with a clear explanation.
- Click "Continue as dev user" → back to Dashboard.
- Set a real `VITE_GOOGLE_CLIENT_ID` in `.env.development.local`, restart Vite → SignInPage shows the actual Google button and real sign-in works.

### Phase 3 — SPA auth push to extension

#### Step 3.1: Add `pushAuthToExtension` and `clearAuthInExtension` helpers

- **What:** Two small functions that wrap `chrome.runtime.sendMessage` to the extension.
- **Where:** New file `frontend/src/auth/extensionBridge.ts` (or add to `AuthProvider.tsx` — prefer a separate file for testability).
- **How:**

  ```typescript
  const EXTENSION_ID = import.meta.env.VITE_EXTENSION_ID;

  export function pushAuthToExtension(payload: {
    token: string | null;
    email: string;
    name: string;
    expiresAt: number | null;
  }): void {
    if (!EXTENSION_ID || typeof chrome === 'undefined' || !chrome.runtime) return;
    try {
      chrome.runtime.sendMessage(EXTENSION_ID, { type: 'SET_AUTH', ...payload }, () => {
        // Swallow chrome.runtime.lastError — extension not installed is fine
        void chrome.runtime.lastError;
      });
    } catch {
      // Non-fatal
    }
  }

  export function clearAuthInExtension(): void {
    if (!EXTENSION_ID || typeof chrome === 'undefined' || !chrome.runtime) return;
    try {
      chrome.runtime.sendMessage(EXTENSION_ID, { type: 'CLEAR_AUTH' }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // Non-fatal
    }
  }
  ```

- **Why:** Centralizes the cross-context call, makes the AuthProvider easier to read, and handles the "extension not installed" case silently.

#### Step 3.2: Push on sign-in / refresh in `AuthProvider`

- **What:** Call `pushAuthToExtension` after every `setToken` inside `handleCredentialResponse`, and also push `{ token: null, email: 'dev@localhost', ... }` in the dev-bypass branch.
- **Where:** `frontend/src/auth/AuthProvider.tsx` inside `handleCredentialResponse` (after line 49), and inside the dev-bypass branch in `useEffect` (after line 107).
- **How:** After `setApiToken(credential)`:

  ```typescript
  pushAuthToExtension({
    token: credential,
    email: newUser.email,
    name: newUser.name,
    expiresAt: (payload.exp as number) * 1000,
  });
  ```

  In the dev-bypass branch:

  ```typescript
  pushAuthToExtension({
    token: null,
    email: 'dev@localhost',
    name: 'Dev User',
    expiresAt: null,
  });
  ```

- **Why:** Keeps the extension's stored session continuously in sync with the SPA's live session, including the refresh path (GIS refresh fires the same `handleCredentialResponse`).

#### Step 3.3: Clear in `signOut`

- **What:** Call `clearAuthInExtension()` in the signOut callback.
- **Where:** `frontend/src/auth/AuthProvider.tsx` `signOut()` at lines 89–101.
- **How:** Add `clearAuthInExtension()` right after `setApiToken(null)` on line 99.

#### Step 3.4: Update `UserProfile` type

- **What:** Add the new `isAdmin` field to the frontend type.
- **Where:** `frontend/src/api/types.ts`, the `UserProfile` interface.
- **How:** Add `isAdmin: boolean;` to the interface. Existing callers that destructure it can now use the flag.

#### Step 3.5: Fetch `/api/users/me` on SPA load

- **What:** Expose the admin flag through the auth context so components can read it.
- **Where:** `frontend/src/auth/AuthProvider.tsx`.
- **How:** After a successful sign-in, call `getMe()` from `api/users.ts` and store the `isAdmin` on the `User` object (extend the `User` interface with `isAdmin?: boolean`). Pass it through `AuthContextType`. Non-blocking — render can proceed before this resolves; UI elements that depend on admin status can default to hidden until the flag is known.

### Phase 4 — Extension receives and consumes SPA auth

#### Step 4.1: Add `SET_AUTH` / `CLEAR_AUTH` handlers to `background.js`

- **What:** Extend `chrome.runtime.onMessageExternal` with the two new message types.
- **Where:** `extension/background.js` starting at line 68 (existing external handler).
- **How:** Add these branches inside the existing listener:

  ```javascript
  if (message.type === 'SET_AUTH') {
    chrome.storage.local.set({
      authSession: {
        token: message.token || null,
        email: message.email || '',
        name: message.name || '',
        expiresAt: message.expiresAt || null,
        storedAt: Date.now()
      }
    }, function () {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'CLEAR_AUTH') {
    chrome.storage.local.remove('authSession', function () {
      sendResponse({ success: true });
    });
    return true;
  }
  ```

- **Why:** Matches the spec's `SET_AUTH` / `CLEAR_AUTH` contract exactly and uses `chrome.storage.local` so the session survives service-worker restarts.

#### Step 4.2: Remove the manual email input from the popup

- **What:** Delete the email input and its label from `popup.html`; keep the API URL input.
- **Where:** `extension/popup.html` — the `.settings` block currently containing both inputs.
- **How:** Remove the second `.settings-row` (the one containing `<label for="user-email">` and `<input id="user-email">`). The API URL row stays.

#### Step 4.3: Add the signed-in-as / sign-in-first banner

- **What:** A small UI element at the top of the popup body showing either "Signed in as: `email`" (with a small muted caption like "via Schnucks Gem Registry") or "Please sign in to the Schnucks Gem Registry first" with an "Open Registry" button that `window.open`s the SPA URL.
- **Where:** `extension/popup.html` (markup) and `extension/popup.js` (rendering logic).
- **How:** Add a `<div id="auth-status"></div>` below the settings block. In `popup.js`, add a `renderAuthStatus(session)` function that conditionally sets `textContent` / inner nodes. Also disable/enable the "Save to Gem Factory" button based on the presence of a valid session.

#### Step 4.4: Load `authSession` on popup open

- **What:** Read the session from `chrome.storage.local` on popup load and drive the UI state from it.
- **Where:** `extension/popup.js` — the init block at lines 287–290.
- **How:** Replace the current `loadSettings(...)` + `loadGems()` pair with:

  ```javascript
  function loadAuthSession(callback) {
    chrome.storage.local.get('authSession', function (data) {
      callback(data.authSession || null);
    });
  }

  loadSettings(function () {
    loadAuthSession(function (session) {
      renderAuthStatus(session);
      loadGems();
    });
  });
  ```

  `renderAuthStatus` also decides whether to enable the save button. The Save button's click handler should re-read the session each time (or consult a module-level `currentSession` variable that's updated on storage changes via `chrome.storage.onChanged`).

#### Step 4.5: Replace `X-Dev-User-Email` with Bearer token in `saveToServer`

- **What:** Use the session's token when present; fall back to `X-Dev-User-Email` when the token is null (dev bypass).
- **Where:** `extension/popup.js` `saveToServer()` at lines 188–266.
- **How:** Remove the `userEmail` validation at lines 197–201. Pull `session` (the loaded `authSession`) before the fetch. Build headers:

  ```javascript
  var headers = { 'Content-Type': 'application/json' };
  if (session && session.token) {
    headers['Authorization'] = 'Bearer ' + session.token;
  } else if (session && session.email) {
    // Dev bypass — token is null, email was supplied by the SPA
    headers['X-Dev-User-Email'] = session.email;
  } else {
    showStatus('Please sign in to the Gem Registry first.', 'error');
    btn.disabled = false;
    btn.textContent = 'Save to Gem Factory';
    return;
  }
  ```

  Check `session.expiresAt` and treat an expired token as "signed out" (null token) for error messaging. The existing error/success branches don't need changes.

#### Step 4.6: Listen for storage changes to refresh the popup state

- **What:** If the SPA pushes a fresh token while the popup is open, the popup should update without requiring a close/reopen.
- **Where:** `extension/popup.js`.
- **How:** Add `chrome.storage.onChanged.addListener((changes, areaName) => { if (areaName === 'local' && changes.authSession) { renderAuthStatus(changes.authSession.newValue); } });`

#### Step 4.7: Bump extension version

- **What:** Bump `extension/manifest.json` version.
- **Where:** `extension/manifest.json` line 4.
- **How:** `0.10.0` → `0.11.0`.

### Phase 5 — Server-side ADC documentation and wiring stub

#### Step 5.1: Document the ADC strategy in `CLAUDE.md`

- **What:** Add a short section under Docker Compose / API server explaining how ADC works in local dev vs. Cloud Run.
- **Where:** `CLAUDE.md`.
- **How:** Add a "Server → Google Cloud credentials (ADC)" subsection with the commands and volume mount example from the spec §3.4.

#### Step 5.2: Document ADC in `docs/context/ARCH.md`

- **What:** A matching note in the architecture document's deployment section (if one exists there).
- **Where:** `docs/context/ARCH.md`.
- **How:** Add one paragraph referencing `docs/specs/authentication-authorization-SPEC.md` §3.4 and noting that user ID tokens are never used for server-to-Google-Cloud calls.

#### Step 5.3: Prepare `docker-compose.yml` for future ADC mounting (optional)

- **What:** A commented-out volume mount line so developers can opt in when they add the first Google Cloud call.
- **Where:** `docker-compose.yml` under the API service's `volumes:` block.
- **How:** Add (commented):

  ```yaml
  # - ~/.config/gcloud:/root/.config/gcloud:ro  # Uncomment when API code starts calling Google Cloud APIs (requires gcloud auth application-default login)
  ```

- **Why:** Keeps the ADC wiring discoverable without forcing every developer to run `gcloud auth` today. Purely documentary until needed.

## 4. Data Model / Schema Changes

**None.** No database schema changes. The only "data model" change is the new `authSession` key in `chrome.storage.local`:

```typescript
interface AuthSession {
  token: string | null;   // null in dev bypass
  email: string;
  name: string;
  expiresAt: number | null;  // milliseconds since epoch; null for dev bypass
  storedAt: number;       // for debugging
}
```

API response shape additions:
- `GET /api/users/me` gains `isAdmin: boolean`.
- `UserProfile` TypeScript type in `frontend/src/api/types.ts` gains `isAdmin: boolean`.

## 5. Integration Points

- **SPA → extension:** `chrome.runtime.sendMessage(EXTENSION_ID, { type: 'SET_AUTH'|'CLEAR_AUTH', ... })`. Already allowed by the extension's existing `externally_connectable` entry for `http://localhost:3000/*`. When the production SPA origin is known, add it to `manifest.json`.
- **Extension → API:** `Authorization: Bearer <token>` (or `X-Dev-User-Email` in dev bypass) on `POST /api/gems/import`. No other endpoint is called by the extension today.
- **SPA → API:** Unchanged — `AuthProvider` wires `api/client.ts` exactly as it does today.
- **API admin determination:** `isAdmin(email)` from `middleware/admin.js` — already in use by the PATCH and DELETE handlers.
- **CLI / config surface changes:** New env var `ALLOW_GMAIL` (default `true`). Documented in CLAUDE.md, added to `docker-compose.yml`.

## 6. Edge Cases & Risks

### Extension / SPA coupling

- **Extension-not-installed case:** `pushAuthToExtension` swallows `chrome.runtime.lastError`. The SPA must not depend on the extension being available — the push is best-effort.
- **Token refresh while popup is open:** `chrome.storage.onChanged` listener (step 4.6) re-renders. Without it, the popup displays stale state until reopened.
- **Popup opened with no session:** "Save to Gem Factory" is disabled; user is directed to open the SPA. Ensure the disabled state is both visually obvious and enforced in the click handler (defense-in-depth).
- **Dev bypass token is `null`:** The extension must detect this and fall back to `X-Dev-User-Email`. Easy to get wrong — test this path explicitly.

### API changes

- **`hd` claim on non-Workspace accounts:** Some edge Google accounts may have an `hd` that's unexpected. The spec's logic rejects these; this is intentional.
- **Gmail users in `ADMIN_EMAILS`:** Admin elevation works the same for Gmail users (email-based match). No special handling needed.
- **Ownership scoping regressions:** A user who previously saw all gems via `GET /api/gems` will now see only their own. This is a **breaking behavioral change** for any existing frontend code that assumes otherwise — but the only consumer is the SPA, whose Dashboard already passes `owner=user.email`, and Registry, which admins should use to see all gems. Verify the Registry still works for non-admins (it will now show only their own gems, which is the intended behavior per the spec).
- **404 vs. 403 for cross-user gem detail:** Spec says 404. Follow the spec — 403 would leak existence.

### ADC

- **ADC is not actively used yet.** Phase 5 is documentation + stubs. When the first Google Cloud call is added in the future, confirm the volume mount and Cloud Run IAM roles at that time.
- **Key file vs. gcloud creds:** Supporting both (`GOOGLE_APPLICATION_CREDENTIALS` or mounted `~/.config/gcloud`) without conflict. The standard libraries handle this natively.

### Security

- **Storing tokens in `chrome.storage.local`:** Tokens are scoped to the extension and readable only by the extension in that browser profile. Acceptable per the threat model. Never write tokens to content-script-accessible storage.
- **`externally_connectable` scope:** Currently only `http://localhost:3000/*`. Before production, tighten to the real SPA origin (or an allowlist).
- **Token in URL / logs:** Nothing in the plan routes tokens through URLs or logs. Keep it that way.

## 7. Verification

### Phase 1 — API identity acceptance

- Run `make api-test` — new `auth.test.js` cases pass.
- Manual: with `GOOGLE_CLIENT_ID` set and `ALLOW_GMAIL=true`, a Gmail-signed ID token via `curl -H "Authorization: Bearer <token>" http://localhost:9090/api/users/me` returns 200. With `ALLOW_GMAIL=false`, same request returns 403.

### Phase 2 — API ownership scoping

- `make api-test` with the new cases passes.
- Manual with dev bypass:
  - `curl -H "X-Dev-User-Email: alice@example.com" http://localhost:9090/api/gems` returns only Alice's gems.
  - `curl -H "X-Dev-User-Email: charles.schiele@gmail.com" http://localhost:9090/api/gems` returns all gems (admin).
  - `curl -H "X-Dev-User-Email: alice@example.com" http://localhost:9090/api/users` returns 403.
  - `curl -H "X-Dev-User-Email: alice@example.com" http://localhost:9090/api/users/me | jq .isAdmin` returns `false`.
  - `curl -H "X-Dev-User-Email: charles.schiele@gmail.com" http://localhost:9090/api/users/me | jq .isAdmin` returns `true`.

### Phase 3 — SPA push

- Open the SPA in a browser with the extension loaded.
- Sign in (or dev-bypass auto-sign-in). Inspect `chrome.storage.local` in the extension's DevTools: `authSession` should be present with the current email and (in production) a valid token.
- Sign out. `authSession` should be absent.

### Phase 4 — Extension consumption

- With the SPA signed in, open the extension popup: header shows "Signed in as: `email`". Save button is enabled.
- Click "Save to Gem Factory": network tab shows `POST /api/gems/import` with `Authorization: Bearer ...` header (production) or `X-Dev-User-Email: ...` header (dev bypass).
- Sign out of the SPA: popup (after reopen or via `chrome.storage.onChanged` listener) shows the "Please sign in first" message; Save button is disabled.
- Verify no `user-email` input appears in the popup UI.

### Phase 5 — ADC documentation

- Documentation reads correctly and points to the right commands.
- When the first Google Cloud SDK call is added (future), confirm it works with `gcloud auth application-default login` + the commented-out volume uncommented.

### Cross-cutting acceptance (from spec §9)

1. Gmail user signs in and imports gems. ✓ after Phase 1+3+4.
2. Customer-org user signs in and imports gems. ✓ after Phase 1+3+4.
3. Third-party domain rejected with a clear message. ✓ after Phase 1.
4. No manual email field. ✓ after Phase 4.
5. Extension sends Bearer token. ✓ after Phase 3+4.
6. Sign-out clears the extension. ✓ after Phase 3+4.
7. Dev bypass end-to-end still works. ✓ after Phase 3+4.
8. Ownership scoping enforced. ✓ after Phase 2.
9. Admins see everything. ✓ after Phase 2.
10. ADC strategy documented. ✓ after Phase 5.

## 8. Open Questions

1. **Production SPA origin.** `externally_connectable` in `manifest.json` currently lists only `http://localhost:3000/*`. The production origin must be added before deployment. **Blocker:** domain is TBD.

2. **`POST /api/gems/import` from extension in dev bypass — does it need to work in production-like mode?** The extension currently uses `X-Dev-User-Email` as its sole auth mechanism, which the API honors only when `GOOGLE_CLIENT_ID` is empty. With Phase 1+4, production uses Bearer tokens. The dev-bypass path still uses `X-Dev-User-Email`. **Resolved:** yes, this is the spec's "fall back to X-Dev-User-Email when token is null."

3. **Gmail users with identical emails to org users.** Google guarantees no overlap — an email like `alice@customer-org.example` is owned by the org; `alice@gmail.com` is a separate identity. No collision possible. No action needed.

4. **Should `/api/users/me` also return the list of authorized domains for UX messaging?** Out of scope for this plan — the SPA can hardcode the phrase "Schnucks account or Gmail" for now. Revisit if the customer deploys to additional orgs.

5. **Admin demotion revocation latency.** If an admin is removed from `ADMIN_EMAILS` mid-session, their SPA still has `isAdmin: true` in memory. The spec accepts this — the next `/me` fetch corrects it. **Resolved:** the SPA should re-fetch `/me` on route transitions to the admin-only sections (user list, stats) to minimize staleness. Not a security issue since the API enforces independently.

6. **Service worker eviction in the extension.** Manifest V3 service workers get evicted. `chrome.storage.local` (not in-memory) is used for `authSession`, so eviction is fine. No action needed.
