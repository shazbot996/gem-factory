---
type: spec
title: "Gem Factory SPA — Frontend Client Application"
scope: Single-page application for authentication, gem import, registry browsing, and search
date: 2026-04-05
---

## 1. Problem Statement

Gem Factory has a working Chrome extension (`extension/`, v0.3.0) that extracts gem configurations from Gemini edit pages and stores them in `chrome.storage.local`, and a working backend API (`server/`, Express on port 9090) that accepts gem imports, deduplicates them, and provides CRUD + search endpoints. What's missing is the user-facing web application that ties these together.

Without the SPA:
- Users have no way to authenticate with the Gem Factory service.
- Extracted gems sit in the extension's local storage with no path to the central registry.
- There is no interface for browsing, searching, or discovering gems across the organization.
- The core value proposition — a shared, searchable gem catalog — has no front door.

The SPA is the final critical-path component that completes the Phase 1 system: extension → SPA → API → database.

## 2. Goals & Non-Goals

### Goals

- Authenticate users via Google Identity Services (GIS), obtaining an ID token scoped to the corporate domain for API calls.
- Detect the Chrome extension and retrieve extracted gems via `chrome.runtime.sendMessage` using the `GET_GEMS` / `CLEAR_GEMS` protocol already implemented in `extension/background.js`.
- Provide a manual import fallback for users without the extension.
- Display an import preview where users confirm which gems to send to `POST /api/gems/import`.
- Provide a registry browser with full-text search, owner filtering, and pagination — consuming `GET /api/gems`, `GET /api/gems/:id`, and `GET /api/stats`.
- Show a dashboard landing page with the authenticated user's imported gems and org-wide statistics.
- Be served as static assets from the same Cloud Run service that hosts the API (via Express static middleware in `server/server.js`).

### Non-Goals

- **Review workflows (Phase 2).** No approval queues, reviewer roles, or status transitions beyond what the API already supports.
- **Gem-to-Enterprise-Agent promotion (Phase 3).** No promotion UI.
- **Admin panel.** Admin operations (status changes, user management) are API-only for Phase 1.
- **Offline support or PWA capabilities.** The app requires network access to the API.
- **Mobile-optimized layout.** Desktop-first; responsive enough not to break on tablets, but mobile is not a target.
- **Custom design system or component library.** Use a lightweight, off-the-shelf CSS framework or utility library.
- **Server-side rendering.** The SPA is fully client-rendered; the server returns `index.html` for all non-API routes.

## 3. Proposed Solution

Build a React + TypeScript single-page application using Vite as the build tool. The built assets are placed in a directory that the Express server in `server/server.js` serves as static files. During development, Vite's dev server proxies `/api/*` requests to the Express backend on port 9090.

**Why React + TypeScript:** The architecture document (`docs/context/ARCH.md` section 3.2) suggests "React or similar." React is the most widely known frontend framework in corporate environments, TypeScript catches integration bugs at build time (especially around the API response shapes), and both have excellent Vite support.

**Why Vite:** Zero-config for React+TS, fast HMR during development, produces optimized static assets for production. No webpack configuration to maintain.

**Why no heavier framework (Next.js, Remix):** The app is a straightforward client-rendered SPA with no SEO requirements and no server-side data fetching needs. A full-stack framework adds complexity without benefit. The Express server already exists and will serve the static build.

### Key user workflows

1. **Sign in** → Google Identity Services button → ID token obtained → stored in memory.
2. **Import gems** → SPA detects extension → retrieves gems → shows preview → user confirms → `POST /api/gems/import` → clear extension storage.
3. **Browse registry** → search bar + filters → paginated gem cards → click through to detail view.
4. **View dashboard** → user's own gems + org stats on the landing page.

## 4. Technical Design

### 4.1 Directory Structure

```
gem-factory/
  frontend/
    index.html
    package.json
    tsconfig.json
    vite.config.ts
    src/
      main.tsx              # React entry point, mounts <App />
      App.tsx               # Top-level router and auth provider
      auth/
        AuthProvider.tsx     # React context for auth state (token, user info)
        useAuth.ts           # Hook exposing sign-in, sign-out, token, user
        GoogleSignIn.tsx     # GIS button component
      api/
        client.ts            # fetch wrapper: base URL, Bearer token injection, error handling
        gems.ts              # Typed API functions: importGems, listGems, getGem, etc.
        users.ts             # getMe, listUsers
        stats.ts             # getStats
        types.ts             # TypeScript interfaces matching API response shapes
      extension/
        useExtension.ts      # Hook: detect extension, getGems, clearGems
      pages/
        Dashboard.tsx        # Landing page: user gems + org stats
        Import.tsx           # Import flow: extension detection, preview, confirm
        Registry.tsx         # Browse/search gem catalog
        GemDetail.tsx        # Single gem view
        NotFound.tsx         # 404 fallback
      components/
        Layout.tsx           # App shell: nav bar, content area
        GemCard.tsx          # Gem summary card (used in Registry and Dashboard)
        SearchBar.tsx        # Search input with debounce
        Pagination.tsx       # Page controls
        ImportPreview.tsx    # Gem list with checkboxes for selective import
        ManualImportForm.tsx # Paste name + instructions for manual import
        EmptyState.tsx       # Placeholder for empty lists
```

### 4.2 Build and Development Setup

**`frontend/package.json`** dependencies:
- `react`, `react-dom` — UI framework
- `react-router-dom` — client-side routing
- `@anthropic-ai/sdk` is NOT used — this is a Google Identity project
- Dev dependencies: `vite`, `@vitejs/plugin-react`, `typescript`, `@types/react`, `@types/react-dom`

No additional UI library is required initially. Use plain CSS (or CSS modules) for styling. If a utility framework is desired later, Tailwind CSS can be added without architectural changes.

**`frontend/vite.config.ts`:**
```typescript
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:9090',
    },
  },
  build: {
    outDir: '../server/public',
    emptyOutDir: true,
  },
});
```

Key decisions:
- **Dev port 3000** — standard React dev port, avoids conflict with API on 9090.
- **Proxy `/api` to 9090** — during development, the Vite dev server forwards API calls to the Express backend. No CORS configuration needed.
- **Build output to `server/public/`** — production builds land where the Express server can serve them. This directory should be gitignored.

### 4.3 Static File Serving (Server-Side Change)

`server/server.js` needs one addition to serve the SPA in production:

```javascript
// After API routes, serve SPA static files
app.use(express.static('public'));
// SPA fallback — all non-API routes return index.html for client-side routing
app.get('*', (req, res) => res.sendFile('index.html', { root: 'public' }));
```

This must come after all `/api/*` routes so API paths are not intercepted by the static file middleware.

### 4.4 Authentication

The SPA uses the Google Identity Services (GIS) JavaScript library to authenticate users.

**Flow:**
1. Load the GIS library via a `<script>` tag in `index.html` (`https://accounts.google.com/gsi/client`).
2. `AuthProvider.tsx` initializes `google.accounts.id.initialize()` with the `GOOGLE_CLIENT_ID` (injected as a Vite environment variable `VITE_GOOGLE_CLIENT_ID`).
3. The sign-in button renders via `google.accounts.id.renderButton()` or a custom `GoogleSignIn.tsx` component.
4. On successful sign-in, GIS returns a JWT credential (ID token).
5. `AuthProvider` stores the token in React state (not localStorage — tokens are short-lived) and decodes the payload to extract `email`, `name`, `picture`, and `hd`.
6. The `useAuth` hook exposes `{ user, token, isAuthenticated, signIn, signOut }` to all components.
7. `api/client.ts` reads the token from the auth context and attaches it as `Authorization: Bearer <token>` on every API call.
8. GIS handles silent re-authentication via the One Tap flow or session cookies. If the token expires and re-auth fails, the SPA redirects to the sign-in page.

**Domain enforcement:** The GIS configuration can restrict sign-in to a specific hosted domain. Additionally, the backend's `middleware/auth.js` validates the `hd` claim, so even if a non-corporate user somehow obtains a token, the API rejects it with 403.

### 4.5 Extension Communication

`extension/useExtension.ts` provides a React hook for communicating with the Chrome extension.

**Detection:** The hook calls `chrome.runtime.sendMessage(EXTENSION_ID, { type: 'GET_GEMS' })` and checks whether the callback receives a response. If `chrome.runtime` is undefined or the call throws, the extension is not installed. The `EXTENSION_ID` is a Vite environment variable (`VITE_EXTENSION_ID`).

**Important:** The extension's `manifest.json` currently lacks an `externally_connectable` key. For the SPA to send messages via `chrome.runtime.sendMessage`, the manifest must declare:

```json
"externally_connectable": {
  "matches": ["https://gem-factory.corp.example.com/*", "http://localhost:3000/*"]
}
```

This is a required change to `extension/manifest.json` before the SPA can communicate with the extension.

**Hook interface:**
```typescript
interface UseExtensionResult {
  available: boolean;       // Extension detected and responding
  loading: boolean;         // Detection or retrieval in progress
  gems: ExtractedGem[];     // Gems from extension storage
  fetchGems: () => Promise<void>;   // Trigger GET_GEMS
  clearGems: () => Promise<void>;   // Trigger CLEAR_GEMS after import
  error: string | null;
}
```

**Gem data mapping:** The extension stores gems with the shape `{ id, name, description, instructions, knowledgeFiles, extractedAt, source }` (as seen in `extension/content-script.js:90-99`). The API import endpoint expects `{ name, instructions, icon?, source? }` (as seen in `server/routes/gems.js:25-35`). The SPA maps between these in the import flow, setting `source: 'extension'`.

### 4.6 API Client Layer

`api/client.ts` provides a typed fetch wrapper:

```typescript
async function apiRequest<T>(path: string, options?: RequestInit): Promise<T>
```

- Prepends `/api` to the path (in development, Vite proxies this; in production, it hits the same origin).
- Reads the auth token from context and sets the `Authorization` header.
- Sets `Content-Type: application/json` for request bodies.
- Throws typed errors for non-2xx responses (with the error message from the JSON body).
- Handles 401 by triggering re-authentication.

`api/types.ts` defines TypeScript interfaces matching the API's response shapes:

```typescript
interface Gem {
  id: string;
  name: string;
  instructions: string;
  icon: string | null;
  source: string;
  status: string;
  owner: { id: string; email: string; displayName: string };
  importedAt: string;
  updatedAt: string;
  duplicateCluster: { id: string; gemCount: number } | null;
}

interface ImportResult {
  imported: number;
  skipped: number;
  duplicates: number;
  gemIds: string[];
}

interface GemListResponse {
  gems: Gem[];
  pagination: { page: number; limit: number; total: number };
}

interface Stats {
  totalGems: number;
  uniqueGems: number;
  totalUsers: number;
  duplicateClusters: number;
  topClusters: { id: string; representativeName: string; gemCount: number }[];
}
```

### 4.7 Routing

React Router with these routes:

| Path | Component | Auth Required | Description |
|------|-----------|--------------|-------------|
| `/` | `Dashboard` | Yes | User's gems + org stats |
| `/import` | `Import` | Yes | Extension/manual import flow |
| `/registry` | `Registry` | Yes | Browse and search all gems |
| `/gems/:id` | `GemDetail` | Yes | Single gem detail view |
| `*` | `NotFound` | No | 404 page |

Unauthenticated users are redirected to a sign-in page (either a dedicated route or a full-page sign-in overlay on `/`).

## 5. UI / UX

### 5.1 Layout

A persistent top navigation bar with:
- **Logo / App name** ("Gem Factory") — links to `/`.
- **Nav links:** Dashboard, Import, Registry.
- **User area (right):** Avatar (from Google profile picture), display name, sign-out button.

Content area below the nav bar, max-width constrained (e.g., 1200px) and centered.

### 5.2 Dashboard (`/`)

Two sections:

**My Gems** — a list or grid of the user's imported gems (fetched via `GET /api/gems?owner=<user-email>`). Each gem is rendered as a `GemCard` showing name, truncated instructions (first 100 chars), import date, and duplicate indicator. If the user has no gems, show an `EmptyState` with a call-to-action linking to `/import`.

**Org Overview** — stats from `GET /api/stats`: total gems, unique gems, total contributors, duplicate clusters. Displayed as a row of stat cards. Optionally includes the top duplicate clusters as a list.

### 5.3 Import Flow (`/import`)

Three states:

**1. Extension detected, gems available:**
- Header: "Import Gems from Gemini"
- Gem count badge: "N gems ready to import"
- `ImportPreview` component: list of extracted gems with checkboxes (all selected by default). Each row shows gem name, instruction preview, extraction timestamp.
- "Import Selected" primary button → calls `POST /api/gems/import` → shows result summary (imported/skipped/duplicate counts) → calls `CLEAR_GEMS` on the extension.
- "Refresh" button to re-fetch from extension.

**2. Extension detected, no gems:**
- Message: "No gems found in the extension. Open a gem's edit page in Gemini and click the blue button to extract it."

**3. Extension not detected:**
- Message explaining how to install the extension (link to corporate Chrome Web Store or developer mode instructions).
- Below: `ManualImportForm` — a form with two fields (gem name, instructions textarea) and an "Import" button. Optionally supports a JSON paste mode for batch import.

### 5.4 Registry (`/registry`)

- **Search bar** at the top — full-text search with debounce (300ms). Fires `GET /api/gems?q=<term>`.
- **Filter row** below the search bar — owner dropdown (populated from `GET /api/users`), status filter (if applicable).
- **Results grid** — `GemCard` components. Each card shows: gem name, owner email, import date, instruction preview (first 100 chars), duplicate cluster badge (e.g., "3 similar").
- **Pagination** at the bottom — page numbers or prev/next, using `page` and `limit` query params.
- **Empty state** when no results match the search/filters.

### 5.5 Gem Detail (`/gems/:id`)

Full view of a single gem from `GET /api/gems/:id`:
- **Header:** Gem name, owner info (email, avatar if available), import date, source badge ("extension" or "manual").
- **Instructions:** Full instruction text in a styled, scrollable block. Monospace or proportional with good line height.
- **Metadata:** Status, duplicate cluster info (with links to other gems in the same cluster).
- **Actions:** "Copy Instructions" button (copies to clipboard). Owner sees "Delete" button.

### 5.6 State Transitions and Feedback

- **Loading states:** Skeleton loaders or spinners when data is being fetched.
- **Import progress:** The import button shows a spinner while the POST is in flight. On success, show a summary toast or inline result. On failure, show the error message.
- **Optimistic navigation:** Search input updates the URL query params (`/registry?q=...`) so the search state is shareable and survives page refresh.
- **Error boundaries:** API errors display inline messages, not unhandled exceptions. Network failures show a retry prompt.

## 6. Integration Points

### 6.1 Chrome Extension

The SPA communicates with the extension via `chrome.runtime.sendMessage` using the `EXTENSION_ID`. The extension's `background.js` already handles `GET_GEMS` and `CLEAR_GEMS` messages via `chrome.runtime.onMessageExternal` (lines 42-56).

**Required extension change:** Add `externally_connectable` to `extension/manifest.json` listing the SPA's origin(s). Without this, `chrome.runtime.sendMessage` from the SPA to the extension will fail silently.

### 6.2 Backend API

All API calls go through the typed client in `api/client.ts`. The SPA consumes these endpoints from `server/routes/gems.js`, `server/routes/users.js`, and `server/routes/stats.js`:

| SPA Action | API Endpoint |
|-----------|-------------|
| Import gems | `POST /api/gems/import` |
| List/search gems | `GET /api/gems?q=&owner=&status=&page=&limit=` |
| View gem detail | `GET /api/gems/:id` |
| Delete gem | `DELETE /api/gems/:id` |
| Get current user | `GET /api/users/me` |
| List users (for filter) | `GET /api/users` |
| Get org stats | `GET /api/stats` |

### 6.3 Google Identity Services

The GIS JavaScript library is loaded from Google's CDN. The SPA needs the OAuth Client ID configured for the corporate domain. This is provided via `VITE_GOOGLE_CLIENT_ID` at build time. The same client ID is used by the backend (`GOOGLE_CLIENT_ID` env var in `docker-compose.yml`) to validate tokens.

### 6.4 Build Integration

The production build output (`frontend/` → `server/public/`) means deployment is unchanged: a single Docker image containing the Express server and the pre-built SPA assets. The `server/Dockerfile` will need to be updated to include a frontend build step (or the build runs in CI before the Docker build).

### 6.5 Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `VITE_GOOGLE_CLIENT_ID` | Frontend build-time | OAuth client ID for GIS |
| `VITE_EXTENSION_ID` | Frontend build-time | Chrome extension ID for messaging |
| `VITE_API_BASE_URL` | Frontend build-time (optional) | Override API base URL; defaults to same-origin `/api` |

## 7. Edge Cases & Error Handling

### 7.1 Authentication

| Condition | Behavior |
|-----------|----------|
| User not signed in | Redirect to sign-in page. No API calls attempted. |
| ID token expires during session | API returns 401. SPA catches this, attempts silent re-auth via GIS. If that fails, redirect to sign-in. |
| User signs in with non-corporate account | GIS can be configured to restrict domain. If a token somehow reaches the API, backend returns 403. SPA shows "Access restricted to your organization." |
| Browser blocks third-party cookies | GIS One Tap may fail. Fall back to the explicit sign-in button flow. |

### 7.2 Extension Communication

| Condition | Behavior |
|-----------|----------|
| Extension not installed | `chrome.runtime` is undefined or `sendMessage` returns no response. SPA hides extension import UI, shows manual import form and install prompt. |
| Extension installed but `externally_connectable` missing | Same as not installed — `sendMessage` fails silently. The extension change is a prerequisite. |
| Extension has no gems stored | `GET_GEMS` returns `{ gems: [] }`. Import page shows "no gems found" message with guidance. |
| Extension returns stale gems | Gems were extracted days ago. Show extraction timestamps on the preview. Include a "Refresh" button that re-triggers `GET_GEMS`. |
| Multiple browser profiles / extension instances | Each profile has its own extension instance and storage. The SPA interacts with whichever profile it's running in. |

### 7.3 Import

| Condition | Behavior |
|-----------|----------|
| All gems are duplicates of the user's existing imports | API returns `{ imported: 0, skipped: N, duplicates: 0 }`. SPA shows "All gems already in your registry." |
| Some gems match other users' gems | API returns a `duplicates` count. SPA shows "N gems matched existing gems from other users" in the import summary. |
| Import request fails (500) | SPA shows error message. Does NOT clear extension storage — gems remain for retry. |
| Manual import with empty instructions | Client-side validation prevents submission. Mirror the server's validation: name required, instructions required and non-empty. |
| Very large instructions (>100KB) | Client-side validation warns before sending. Server rejects with 400 per `server/routes/gems.js:11`. |

### 7.4 Search and Navigation

| Condition | Behavior |
|-----------|----------|
| Search returns no results | Show empty state: "No gems match your search." with a suggestion to clear filters. |
| Gem detail for deleted or non-existent gem | API returns 404. SPA shows "Gem not found" with a link back to the registry. |
| Direct URL access (deep link) | React Router handles it. The Express SPA fallback serves `index.html` for all non-API paths. Auth check runs on mount; if unauthenticated, redirect to sign-in. |
| Rapid search input | Debounce at 300ms before sending API requests. Show a loading indicator during the debounce period. |

## 8. Scope & Milestones

### Milestone 1: Project scaffolding and authentication

- Initialize `frontend/` with Vite + React + TypeScript.
- `AuthProvider`, `useAuth` hook, GIS integration.
- Sign-in page with Google button.
- Basic `Layout` component with nav bar.
- API client with Bearer token injection.
- Vite proxy configuration for `/api`.
- Verify end-to-end: sign in → `GET /api/users/me` returns the authenticated user.

### Milestone 2: Dashboard and stats

- `Dashboard` page with user's gems (`GET /api/gems?owner=<email>`) and org stats (`GET /api/stats`).
- `GemCard` component.
- Empty states when user has no gems.

### Milestone 3: Import flow — extension path

- `useExtension` hook (detect, `GET_GEMS`, `CLEAR_GEMS`).
- Add `externally_connectable` to `extension/manifest.json` (version bump).
- `Import` page with extension detection and gem preview.
- `ImportPreview` component with select/deselect.
- Import confirmation → `POST /api/gems/import` → result summary → `CLEAR_GEMS`.

### Milestone 4: Import flow — manual fallback

- `ManualImportForm` component (name + instructions fields).
- Client-side validation.
- Same `POST /api/gems/import` call, with `source: 'manual'`.

### Milestone 5: Registry browser

- `Registry` page with `SearchBar`, owner filter, results grid.
- `Pagination` component.
- URL-synced search state (`/registry?q=...&page=...`).

### Milestone 6: Gem detail and actions

- `GemDetail` page consuming `GET /api/gems/:id`.
- Copy instructions button.
- Owner delete button → `DELETE /api/gems/:id`.

### Milestone 7: Production build integration

- Update `server/Dockerfile` to include frontend build step (multi-stage build).
- Add `express.static('public')` and SPA fallback route to `server/server.js`.
- Add `make spa-dev` and `make spa-build` Makefile targets.
- Verify the built SPA serves correctly from the Express server.

### Deferred

- Mobile-responsive layout refinements.
- Dark mode.
- Duplicate cluster detail view (navigate from a gem to its cluster siblings).
- Gem instruction diff view (compare two similar gems side-by-side).
- Admin features (status changes, user management) via UI — admin actions remain API-only.
- Embedding-based semantic search or similarity visualization.

## 9. Success Criteria

### Must pass

1. A user can sign in with their corporate Google account and see their display name in the nav bar.
2. Unauthenticated users cannot access any page except the sign-in page; all API calls include a valid Bearer token.
3. With the Chrome extension installed and gems extracted, the Import page detects the extension, displays the gems in a preview list, and allows the user to import them.
4. After a successful import, the extension's gem storage is cleared, and the imported gems appear on the Dashboard.
5. A user without the extension can paste a gem's name and instructions into the manual import form and successfully import it.
6. The Registry page displays all gems in the org with pagination, and searching by keyword returns relevant results.
7. Clicking a gem card navigates to the gem detail page showing full instructions, owner, and metadata.
8. The SPA can be built with `npm run build` (in `frontend/`) and served by the Express server from `server/public/`.
9. During development, `npm run dev` (in `frontend/`) starts a dev server that proxies API calls to the Express backend.

### Should pass

10. The Import page shows an accurate summary after import (imported count, skipped count, duplicate count).
11. The Dashboard displays org-wide statistics (total gems, unique gems, contributors).
12. Search state in the registry is reflected in the URL and survives page refresh.
13. The gem detail page has a working "Copy Instructions" button.
14. The owner of a gem can delete it from the detail page.
15. All API error responses (401, 403, 404, 500) are handled gracefully with user-facing messages.

## 10. Open Questions

### Q1: CSS approach

Should the SPA use plain CSS/CSS modules, Tailwind CSS, or a component library (e.g., Radix, shadcn/ui)? Plain CSS is simplest but slower to build a polished UI. Tailwind is pragmatic for utility-first styling. A component library provides pre-built patterns but adds dependency weight.

**Recommendation:** Start with CSS modules for simplicity. Add Tailwind if styling velocity becomes a bottleneck.

### Q2: Extension ID management

The `VITE_EXTENSION_ID` needs to be known at build time. During development with sideloaded extensions, the ID changes each time the extension is reloaded. Options: (a) hardcode a known dev extension ID in `.env.development`, (b) allow the user to paste their extension ID into the SPA settings, (c) use `chrome.runtime.connect` with a fallback discovery mechanism.

**Recommendation:** Use a `.env.development` file with the dev extension ID. Document how to find the ID in `chrome://extensions`. For production, the corporate Chrome Web Store assigns a stable ID.

### Q3: Token refresh strategy

GIS ID tokens are short-lived (~1 hour). The SPA needs a strategy for refreshing them without interrupting the user. Options: (a) rely on GIS's built-in session management (automatic if One Tap / FedCM is active), (b) proactively refresh before expiry by decoding the token's `exp` claim, (c) reactively refresh on 401 from the API.

**Recommendation:** Combine (b) and (c). Set a timer to refresh the token 5 minutes before expiry. If a 401 still occurs (e.g., clock skew), catch it in the API client and attempt one refresh before failing.

### Q4: SPA hosting URL

The production URL (e.g., `gem-factory.corp.example.com`) needs to be known for the extension's `externally_connectable` list and for the GIS OAuth redirect configuration. This needs to be decided before the extension manifest is updated and the OAuth client is configured.

**Recommendation:** Decide the production domain early. Use `http://localhost:3000` for development in both the extension manifest and GIS config.

### Q5: Makefile integration

How should the frontend dev workflow integrate with the existing Makefile? Options: (a) `make spa-dev` to start the Vite dev server, `make spa-build` to produce the production build, (b) developers use `npm run dev` directly in the `frontend/` directory.

**Recommendation:** Add `make spa-dev` and `make spa-build` targets for consistency with the existing `make api-start` / `make api-stop` pattern. Developers can still use npm directly if they prefer.
