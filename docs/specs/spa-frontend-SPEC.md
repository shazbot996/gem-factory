---
type: spec
title: "Schnucks Gem Registry SPA — Frontend Client Application"
scope: Single-page application for authentication, gem registry browsing, search, and detail views — branded as the Schnucks Gem Registry
date: 2026-04-15
---

## 1. Problem Statement

Gem Factory has a working Chrome extension (`extension/`, v0.10.0) that extracts gem configurations from Gemini edit pages and stores them in `chrome.storage.local`, and a working backend API (`server/`, Express on port 9090) that accepts gem imports, deduplicates them, and provides CRUD + search endpoints. The SPA is the user-facing web application that ties these together.

Without the SPA:
- Users have no way to authenticate with the Gem Factory service.
- Extracted gems sit in the extension's local storage with no path to the central registry (beyond the extension popup's direct server save).
- There is no interface for browsing, searching, or discovering gems across the organization.
- The core value proposition — a shared, searchable gem catalog — has no front door.

The SPA completes the Phase 1 system: extension → API → database → SPA.

## 2. Goals & Non-Goals

### Goals

- Authenticate users via Google Identity Services (GIS), obtaining an ID token scoped to the corporate domain for API calls.
- Provide a personal dashboard showing the authenticated user's imported gems and org-wide statistics.
- Provide a registry browser with full-text search, owner filtering, and pagination — consuming `GET /api/gems`, `GET /api/gems/:id`, and `GET /api/stats`.
- Show gem detail views with full instructions, knowledge files, enabled tools, and owner actions (copy, delete).
- Be served as static assets from the same Express service that hosts the API (via `express.static` in `server/server.js`).
- Be branded as the **Schnucks Gem Registry** with Schnucks Markets' red color theme.

### Non-Goals

- **Import UI.** Gem import is handled by the Chrome extension's popup ("Save to Gem Factory" button) or the extension's `GET_GEMS`/`CLEAR_GEMS` messaging protocol. The SPA does not provide its own import form.
- **Review workflows (Phase 2).** No approval queues, reviewer roles, or status transitions beyond what the API already supports.
- **Gem-to-Enterprise-Agent promotion (Phase 3).** No promotion UI.
- **Admin panel.** Admin operations (status changes, user management) are API-only for Phase 1.
- **Offline support or PWA capabilities.** The app requires network access to the API.
- **Mobile-optimized layout.** Desktop-first; responsive enough not to break on tablets, but mobile is not a target.
- **Server-side rendering.** The SPA is fully client-rendered; the server returns `index.html` for all non-API routes.

## 3. Proposed Solution

A React + TypeScript single-page application using Vite as the build tool and Tailwind CSS v4 for styling. The built assets are placed in `server/public/` where the Express server serves them as static files. During development, Vite's dev server proxies `/api/*` requests to the Express backend on port 9090.

**Why React + TypeScript:** The architecture document (`docs/context/ARCH.md` section 3.2) suggests "React or similar." React is the most widely known frontend framework in corporate environments, TypeScript catches integration bugs at build time (especially around the API response shapes), and both have excellent Vite support.

**Why Vite:** Zero-config for React+TS, fast HMR during development, produces optimized static assets for production. No webpack configuration to maintain.

**Why Tailwind CSS v4:** Utility-first styling with no separate configuration file — theme is defined inline in `index.css` via `@theme`. Schnucks brand colors are declared as CSS custom properties.

**Why no heavier framework (Next.js, Remix):** The app is a straightforward client-rendered SPA with no SEO requirements and no server-side data fetching needs. A full-stack framework adds complexity without benefit. The Express server already exists and serves the static build.

### Key user workflows

1. **Sign in** → Google Identity Services button → ID token obtained → stored in React state.
2. **Dashboard** → user's own gems in a compact table + org-wide statistics.
3. **Browse registry** → search bar + owner filter → paginated table → click through to detail view.
4. **View gem detail** → full instructions, knowledge files with Drive links, enabled tools, copy/delete actions.

## 4. Technical Design

### 4.1 Directory Structure

```
gem-factory/
  frontend/
    index.html              # Entry HTML ("Schnucks Gem Registry"), loads GIS script
    package.json            # React 19, React Router 7.5, Tailwind 4.1, Vite 6.3
    tsconfig.json           # References tsconfig.app.json and tsconfig.node.json
    tsconfig.app.json       # ES2020 target, react-jsx, strict mode
    vite.config.ts          # Port 3000, /api proxy → localhost:9090, build → ../server/public/
    .env.development        # VITE_GOOGLE_CLIENT_ID, VITE_EXTENSION_ID, VITE_API_BASE_URL
    public/
      schnucks-logo.png     # Schnucks Markets brand logo
    src/
      main.tsx              # React entry point, BrowserRouter + StrictMode + <App />
      App.tsx               # AuthProvider + ProtectedRoutes + route definitions
      index.css             # Tailwind v4 import + Schnucks brand theme (@theme)
      vite-env.d.ts         # Vite environment type declarations
      auth/
        AuthProvider.tsx     # React context: GIS integration, token lifecycle, dev bypass
        useAuth.ts           # Hook: user, token, isAuthenticated, signOut, isLoading
        GoogleSignIn.tsx     # GIS renderButton component
        gis.d.ts             # Google Identity Services type declarations
      api/
        client.ts            # fetch wrapper: Bearer token, 401 refresh, ApiError class
        gems.ts              # importGems, listGems, getGem, deleteGem
        users.ts             # getMe, listUsers
        stats.ts             # getStats
        types.ts             # Gem, KnowledgeFile, GemOwner, Stats, ImportResult, etc.
      extension/
        useExtension.ts      # Hook: detect extension, getGems, clearGems
        chrome.d.ts          # Chrome runtime type declarations
      pages/
        Dashboard.tsx        # User's gems (GemTable) + org stats cards
        Registry.tsx         # Full catalog: search, owner filter, pagination (50/page)
        GemDetail.tsx        # Single gem: instructions, knowledge files, tools, delete
        NotFound.tsx         # 404 fallback
      components/
        Layout.tsx           # Header: Schnucks logo, "Gem Registry", nav, user profile
        GemTable.tsx         # Compact table view (shared by Dashboard and Registry)
        GemCard.tsx          # Card view component (legacy, not currently used by any page)
        SearchBar.tsx        # Debounced search input (300ms)
        Pagination.tsx       # Page controls with record range display
        EmptyState.tsx       # Empty state message
```

### 4.2 Build and Development Setup

**`frontend/package.json`** dependencies:
- `react` ^19.0.0, `react-dom` ^19.0.0 — UI framework
- `react-router-dom` ^7.5.0 — client-side routing
- Dev dependencies: `vite` ^6.3.0, `@vitejs/plugin-react` ^4.4.0, `typescript` ~5.7.0, `tailwindcss` ^4.1.0, `@tailwindcss/vite` ^4.1.0, `@types/react` ^19.0.0, `@types/react-dom` ^19.0.0

ES modules throughout (`"type": "module"` in `package.json`).

**`frontend/vite.config.ts`:**
```typescript
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
- **Dev port 3000** — avoids conflict with API on 9090.
- **Proxy `/api` to 9090** — during development, the Vite dev server forwards API calls to the Express backend. No CORS configuration needed in dev.
- **Build output to `../server/public/`** — production builds land where the Express server can serve them.
- **Tailwind CSS plugin** — `@tailwindcss/vite` for v4 integration, no separate config file needed.

**Makefile targets:**
- `make spa-install` — `npm install` in `frontend/`
- `make spa-dev` — starts Vite dev server (auto-installs if `node_modules` missing)
- `make spa-build` — production build to `server/public/`

### 4.3 Static File Serving (Server-Side)

`server/server.js` serves the SPA in production. After all `/api/*` routes:

```javascript
const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get('*', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}
```

The SPA fallback returns `index.html` for all non-API routes, enabling client-side routing. If no `public/` directory exists (no build present), the server returns a JSON identity response at `GET /`.

### 4.4 Authentication

The SPA uses the Google Identity Services (GIS) JavaScript library to authenticate users.

**Flow (implemented in `auth/AuthProvider.tsx`):**
1. The GIS library is loaded via a `<script>` tag in `index.html` (`https://accounts.google.com/gsi/client`).
2. `AuthProvider` waits for the `google` global to be available, then calls `google.accounts.id.initialize()` with the `VITE_GOOGLE_CLIENT_ID` and `auto_select: true`.
3. `google.accounts.id.prompt()` triggers the One Tap / auto-select flow.
4. On successful sign-in, GIS returns a JWT credential (ID token).
5. `AuthProvider` decodes the JWT payload (via `decodeJwtPayload()`) to extract `email`, `name`, `picture`, and `hd`. The token and user object are stored in React state.
6. The token is passed to `api/client.ts` via `setToken()`, which attaches it as `Authorization: Bearer <token>` on every API call.
7. A refresh timer is set to fire 5 minutes before the token's `exp` claim. If a 401 occurs during an API call, the client catches it and attempts one token refresh via `google.accounts.id.prompt()` before failing.

**Development bypass mode:** When `VITE_GOOGLE_CLIENT_ID` is empty (the default in `.env.development`), `AuthProvider` skips GIS entirely and auto-authenticates as `dev@localhost` with a placeholder token. This allows local development without Google OAuth configuration.

**Sign-out:** Calls `google.accounts.id.revoke()` with the user's email, clears the token and user state, and resets the API client token.

**Domain enforcement:** The GIS configuration can restrict sign-in to a specific hosted domain. Additionally, the backend's `middleware/auth.js` validates the `hd` claim, so even if a non-corporate user somehow obtains a token, the API rejects it with 403.

### 4.5 Extension Communication

`extension/useExtension.ts` provides a React hook for communicating with the Chrome extension.

**Detection:** The hook calls `chrome.runtime.sendMessage(EXTENSION_ID, { type: 'GET_GEMS' })` on mount. If `chrome.runtime` is undefined or the call throws, the extension is not available. The `EXTENSION_ID` comes from the `VITE_EXTENSION_ID` environment variable.

The extension's `manifest.json` declares `externally_connectable` with `http://localhost:3000/*`, enabling SPA-to-extension messaging in development.

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

### 4.6 API Client Layer

`api/client.ts` provides a typed fetch wrapper:

```typescript
async function apiRequest<T>(path: string, options?: RequestInit): Promise<T>
```

- Uses `VITE_API_BASE_URL` as the base (defaults to empty string, meaning same-origin).
- Reads the current token from module-level state (set by `AuthProvider` via `setToken()`) and sets the `Authorization: Bearer` header.
- Sets `Content-Type: application/json` for POST/PUT/PATCH request bodies.
- Returns `undefined` for 204 No Content responses.
- Throws `ApiError` (custom class with `status` property) for non-2xx responses, extracting the error message from the JSON body.
- Handles 401 by calling `refreshTokenFn` (set by `AuthProvider` via `setRefreshToken()`) and retrying once before re-throwing.

`api/types.ts` defines TypeScript interfaces matching the API's response shapes:

```typescript
interface GemOwner { id: string; email: string; displayName: string }

interface KnowledgeFile {
  name: string; type: string; mimeType: string;
  driveId: string | null; driveUrl: string | null;
}

interface Gem {
  id: string;
  name: string;
  description: string | null;
  instructions: string;
  icon: string | null;
  source: string;
  status: string;
  geminiId: string | null;
  knowledgeFiles: KnowledgeFile[];
  defaultTools: string[];
  owner: GemOwner;
  importedAt: string;
  updatedAt: string;
  extractedAt: string | null;
  duplicateCluster: { id: string; gemCount: number } | null;
}

interface GemListResponse {
  gems: Gem[];
  pagination: { page: number; limit: number; total: number };
}

interface ImportResult {
  imported: number;
  updated: number;
  skipped: number;
  importedIds: string[];
}

interface UserProfile {
  id?: string; email: string; displayName: string;
  gemCount: number; firstImportAt: string | null; lastImportAt: string | null;
}

interface UserListItem { id: string; email: string; displayName: string; gemCount: number }

interface Stats {
  totalGems: number;
  uniqueGems: number;
  totalUsers: number;
  duplicateClusters: number;
  topClusters: { id: string; representativeName: string; gemCount: number }[];
}

interface ExtractedGem {
  id: string; name: string; description: string; instructions: string;
  knowledgeFiles: KnowledgeFile[]; defaultTools: string[];
  extractedAt: string; source: string;
}
```

**API functions:**

| Module | Function | Endpoint |
|--------|----------|----------|
| `gems.ts` | `importGems(gems[])` | `POST /api/gems/import` |
| `gems.ts` | `listGems({ q?, owner?, status?, page?, limit? })` | `GET /api/gems` |
| `gems.ts` | `getGem(id)` | `GET /api/gems/:id` |
| `gems.ts` | `deleteGem(id)` | `DELETE /api/gems/:id` |
| `users.ts` | `getMe()` | `GET /api/users/me` |
| `users.ts` | `listUsers()` | `GET /api/users` |
| `stats.ts` | `getStats()` | `GET /api/stats` |

### 4.7 Routing

React Router v7.5 with these routes (defined in `App.tsx`):

| Path | Component | Auth Required | Description |
|------|-----------|--------------|-------------|
| `/` | `Dashboard` | Yes | User's gems + org stats |
| `/registry` | `Registry` | Yes | Browse and search all gems |
| `/gems/:id` | `GemDetail` | Yes | Single gem detail view |
| `*` | `NotFound` | No | 404 page |

Unauthenticated users see a `SignInPage` component (defined inline in `App.tsx`) with the Schnucks logo, "Gem Registry" title, and `GoogleSignIn` button.

### 4.8 Schnucks Branding

The SPA is branded as the **Schnucks Gem Registry**:

- **Logo:** `public/schnucks-logo.png` displayed in the header nav and sign-in page.
- **Page title:** "Schnucks Gem Registry" (set in `index.html`).
- **Color theme** (defined in `index.css` via Tailwind v4 `@theme`):
  - `--color-schnucks-red: #E31837` — primary accent for active nav links, focus rings, interactive text
  - `--color-schnucks-red-dark: #C41430` — hover states
  - `--color-schnucks-red-light: #FEF2F2` — active nav background
- **Typography:** System font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`).

## 5. UI / UX

### 5.1 Layout

A persistent top navigation bar (`Layout.tsx`) with:
- **Logo area (left):** Schnucks logo image + "Gem Registry" text label — links to `/`.
- **Nav links:** Dashboard, Registry. Active link styled with Schnucks red background/text.
- **User area (right):** Avatar (from Google profile picture), display name, sign-out button.

Content area below the nav bar, max-width constrained (`max-w-7xl`) and centered.

### 5.2 Dashboard (`/`)

Two sections:

**My Gems** — a compact table of the user's imported gems (fetched via `listGems({ owner: user.email, limit: 200 })`). Rendered as a `GemTable` with `showOwner={false}`. Shows gem count above the table. If the user has no gems, shows an `EmptyState` with the message "You don't have any gems in the registry yet."

**Org Overview** — stats from `getStats()`: Total Gems, Unique Gems, Contributors, Duplicate Clusters. Displayed as a row of four `StatCard` components.

### 5.3 Registry (`/registry`)

- **Header row:** "Gem Registry" title with total gem count.
- **Filter row:** `SearchBar` (full-text search, debounced 300ms) and owner dropdown (populated from `listUsers()`). Both reset to page 1 on change.
- **Results table:** `GemTable` with `showOwner={true}`. Columns: Name, Owner, Description, Docs count, Tools, Imported date. Responsive — columns hide progressively on smaller screens.
- **Pagination:** `Pagination` component showing record range (e.g., "1–50 of 234") with Previous/Next buttons. Page size: 50.
- **URL-synced state:** Search query (`q`), owner filter (`owner`), and page number (`page`) are stored in URL search params via `useSearchParams`, making the state shareable and bookmarkable.
- **Empty state** when no results match: "No gems match your search."

### 5.4 Gem Detail (`/gems/:id`)

Full view of a single gem from `getGem(id)`:
- **Back link:** "← Back" linking to `/` (if owner) or `/registry` (if not owner). Styled in Schnucks red.
- **Header:** Gem name, source badge (gray pill), description, metadata row (owner, import date, status, extraction timestamp if available).
- **Duplicate cluster warning** (if present): amber text noting the cluster size.
- **Instructions:** Full text in a scrollable `<pre>` block (max height 24rem) with a "Copy Instructions" button (Schnucks red) that shows "Copied!" feedback for 2 seconds.
- **Knowledge Documents** (if any): Bordered list with emoji icon per mime type, file name, type label, and "Open in Drive" link (Schnucks red) for files with captured Drive URLs.
- **Enabled Tools** (if any): Purple pill badges listing each tool.
- **Actions:** Owner sees a red "Delete Gem" button with confirmation dialog.

### 5.5 State Transitions and Feedback

- **Loading states:** "Loading..." text when data is being fetched.
- **Error states:** Error messages displayed inline (red text) when API calls fail.
- **Search debounce:** 300ms debounce in `SearchBar` before triggering API requests.
- **URL-synced search:** Registry search state in URL query params (`/registry?q=...&page=...`), survives page refresh.
- **Clipboard feedback:** "Copy Instructions" shows "Copied!" for 2 seconds on success.
- **Delete confirmation:** Browser `confirm()` dialog before deleting a gem.

## 6. Integration Points

### 6.1 Chrome Extension

The SPA can communicate with the extension via `chrome.runtime.sendMessage` using the `VITE_EXTENSION_ID`. The extension's `background.js` handles `GET_GEMS` and `CLEAR_GEMS` messages via `chrome.runtime.onMessageExternal`. The extension's `manifest.json` declares `externally_connectable` for `http://localhost:3000/*`.

The `useExtension` hook (`extension/useExtension.ts`) provides the `fetchGems` and `clearGems` functions. This integration exists for potential future use but is not currently wired into any SPA page — gem import is handled by the extension popup's "Save to Gem Factory" button.

### 6.2 Backend API

All API calls go through the typed client in `api/client.ts`. The SPA consumes these endpoints from `server/routes/gems.js`, `server/routes/users.js`, and `server/routes/stats.js`:

| SPA Action | API Endpoint |
|-----------|-------------|
| List/search gems | `GET /api/gems?q=&owner=&status=&page=&limit=` |
| View gem detail | `GET /api/gems/:id` |
| Delete gem | `DELETE /api/gems/:id` |
| List users (for filter) | `GET /api/users` |
| Get org stats | `GET /api/stats` |

The `importGems()` API function exists in `api/gems.ts` but is not currently called by any SPA page.

### 6.3 Google Identity Services

The GIS JavaScript library is loaded from Google's CDN via a `<script>` tag in `index.html`. The SPA needs the OAuth Client ID configured for the corporate domain via `VITE_GOOGLE_CLIENT_ID` at build time. The same client ID is used by the backend (`GOOGLE_CLIENT_ID` env var in `docker-compose.yml`) to validate tokens.

### 6.4 Build Integration

The production build output (`frontend/` → `server/public/`) means the Express server serves both the API and the SPA from a single process. `make spa-build` runs the Vite build, and the output lands in `server/public/` which the Express server automatically detects and serves.

### 6.5 Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `VITE_GOOGLE_CLIENT_ID` | Frontend build-time | OAuth client ID for GIS. Empty = dev bypass mode. |
| `VITE_EXTENSION_ID` | Frontend build-time | Chrome extension ID for messaging |
| `VITE_API_BASE_URL` | Frontend build-time (optional) | Override API base URL; defaults to same-origin |

## 7. Edge Cases & Error Handling

### 7.1 Authentication

| Condition | Behavior |
|-----------|----------|
| User not signed in | `ProtectedRoutes` shows `SignInPage` with GoogleSignIn button. No API calls attempted. |
| ID token expires during session | API returns 401. `apiRequest` catches this, attempts token refresh via `google.accounts.id.prompt()`. If refresh succeeds, retries the request. If not, user must re-authenticate. |
| User signs in with non-corporate account | GIS can be configured to restrict domain. If a token reaches the API with wrong domain, backend returns 403. |
| `VITE_GOOGLE_CLIENT_ID` is empty | Dev bypass mode activates — auto-authenticates as `dev@localhost`. |
| Browser blocks third-party cookies | GIS One Tap may fail. Fall back to the explicit sign-in button flow rendered by `GoogleSignIn`. |

### 7.2 Search and Navigation

| Condition | Behavior |
|-----------|----------|
| Search returns no results | `EmptyState`: "No gems match your search." |
| Gem detail for deleted or non-existent gem | `getGem` returns 404 (caught via `ApiError`). SPA shows "Gem not found." with a "Back to Registry" link. |
| Direct URL access (deep link) | React Router handles it. Express SPA fallback serves `index.html` for all non-API paths. Auth check runs on mount. |
| Rapid search input | Debounce at 300ms in `SearchBar` before calling `onChange`. |

### 7.3 Gem Operations

| Condition | Behavior |
|-----------|----------|
| Delete fails (500) | Error message displayed inline. Gem remains. |
| Copy to clipboard fails | "Copy failed" text shown briefly on the button. |
| User is not the gem owner | Delete button not shown. Back link goes to `/registry` instead of `/`. |
| Gem has no knowledge files | Knowledge Documents section not rendered. |
| Gem has no enabled tools | Enabled Tools section not rendered. |

## 8. Scope & Milestones

### Milestone 1: Project scaffolding and authentication ✓

- Initialized `frontend/` with Vite + React + TypeScript + Tailwind CSS v4.
- `AuthProvider`, `useAuth` hook, GIS integration with dev bypass.
- Sign-in page with Schnucks logo and Google button.
- `Layout` component with Schnucks-branded nav bar.
- API client with Bearer token injection and 401 refresh.
- Vite proxy configuration for `/api`.

### Milestone 2: Dashboard and stats ✓

- `Dashboard` page with user's gems (`listGems({ owner: email })`) and org stats (`getStats()`).
- `GemTable` component for compact table display.
- `StatCard` component for org-wide numbers.
- Empty states when user has no gems.

### Milestone 3: Registry browser ✓

- `Registry` page with `SearchBar`, owner filter dropdown, results table.
- `Pagination` component with record range display.
- URL-synced search state (`/registry?q=...&owner=...&page=...`).
- Page size of 50 for registry listings.

### Milestone 4: Gem detail and actions ✓

- `GemDetail` page consuming `getGem(id)`.
- Knowledge files display with Drive links and mime type icons.
- Enabled tools display.
- Copy instructions button with feedback.
- Owner delete button with confirmation.

### Milestone 5: Production build integration ✓

- `express.static('public')` and SPA fallback route in `server/server.js`.
- `make spa-install`, `make spa-dev`, and `make spa-build` Makefile targets.
- Built SPA serves correctly from the Express server.

### Milestone 6: Schnucks branding ✓

- Schnucks logo in header and sign-in page.
- Schnucks red color theme (`#E31837`) applied to nav links, focus rings, interactive elements.
- "Schnucks Gem Registry" page title and header text.

### Deferred

- Mobile-responsive layout refinements.
- Dark mode.
- Duplicate cluster detail view (navigate from a gem to its cluster siblings).
- Gem instruction diff view (compare two similar gems side-by-side).
- Admin features (status changes, user management) via UI — admin actions remain API-only.
- Embedding-based semantic search or similarity visualization.
- SPA-driven import flow (currently handled by the extension popup).

## 9. Success Criteria

### Must pass

1. A user can sign in with their corporate Google account and see their display name in the nav bar.
2. Unauthenticated users cannot access any page except the sign-in page; all API calls include a valid Bearer token.
3. The Dashboard displays the authenticated user's gems in a compact table and org-wide statistics.
4. The Registry page displays all gems with pagination (50 per page), and searching by keyword returns relevant results.
5. The Registry search state is reflected in the URL and survives page refresh.
6. Clicking a gem name in the table navigates to the gem detail page showing full instructions, knowledge files, tools, and owner metadata.
7. The gem detail page has a working "Copy Instructions" button and a "Delete Gem" button visible to the owner.
8. The SPA can be built with `make spa-build` and served by the Express server from `server/public/`.
9. During development, `make spa-dev` starts a dev server that proxies API calls to the Express backend.

### Should pass

10. The Dashboard displays org-wide statistics (total gems, unique gems, contributors, duplicate clusters).
11. The Registry owner filter dropdown is populated from the user list and correctly filters results.
12. The gem detail page displays knowledge documents with Drive links and mime type icons.
13. The gem detail page displays enabled tools as badges.
14. All API error responses (401, 403, 404, 500) are handled gracefully with user-facing messages.
15. The Schnucks logo and red color theme are consistently applied throughout the application.

## 10. Open Questions (Resolved)

### Q1: CSS approach

**Resolved:** Tailwind CSS v4 with `@tailwindcss/vite` plugin. No separate configuration file — theme is defined inline in `index.css` via `@theme`. Schnucks brand colors declared as custom properties.

### Q2: Extension ID management

**Resolved:** `VITE_EXTENSION_ID` is set in `.env.development`. For sideloaded extensions, the developer copies the ID from `chrome://extensions`. The extension's `manifest.json` declares `externally_connectable` for `http://localhost:3000/*`.

### Q3: Token refresh strategy

**Resolved:** Combined proactive + reactive approach in `AuthProvider.tsx`. A timer refreshes the token 5 minutes before `exp`. If a 401 still occurs, the API client (`apiRequest` in `client.ts`) catches it, calls `refreshTokenFn`, and retries once.

### Q4: SPA hosting URL

**Resolved:** `http://localhost:3000` for development. The extension's `externally_connectable` includes this origin. Production domain TBD.

### Q5: Makefile integration

**Resolved:** `make spa-install`, `make spa-dev`, and `make spa-build` targets exist in the project Makefile, consistent with the `make api-start` / `make api-stop` pattern.
