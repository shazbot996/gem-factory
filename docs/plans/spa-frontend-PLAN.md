---
type: plan
title: "SPA Frontend — Implementation Plan"
spec: docs/specs/spa-frontend-SPEC.md
scope: React + TypeScript SPA with Vite, Tailwind CSS, Google Identity Services auth, extension communication, gem import, and registry browser
date: 2026-04-05
---

## 1. Goal

Build the Gem Factory frontend SPA — a React + TypeScript application using Vite and Tailwind CSS that authenticates users via Google Identity Services, communicates with the Chrome extension to retrieve extracted gems, sends them to the existing backend API for import, and provides a browsable/searchable registry of all gems in the organization. This is the final critical-path component that completes the Phase 1 system.

Spec: [`docs/specs/spa-frontend-SPEC.md`](../specs/spa-frontend-SPEC.md)

## 2. Context & Prior Art

### Existing codebase

- **`server/server.js`** — Express entry point, listens on port 9090. Currently serves `/api/*` routes and a root JSON health check. Needs a static file serving addition after API routes.
- **`server/routes/gems.js`** — All gem CRUD endpoints. The `formatGem` function (line 141) defines the response shape the SPA must consume: `{ id, name, instructions, icon, source, status, owner, importedAt, updatedAt, duplicateCluster }`.
- **`server/routes/users.js`** — `GET /me` returns `{ email, displayName, gemCount, firstImportAt, lastImportAt }`. `GET /` returns `{ users: [...] }` with `{ id, email, displayName, gemCount }`.
- **`server/routes/stats.js`** — `GET /` returns `{ totalGems, uniqueGems, totalUsers, duplicateClusters, topClusters }`.
- **`server/middleware/auth.js`** — Dev bypass mode when `GOOGLE_CLIENT_ID` is empty: sets `req.user = { email: 'dev@localhost', name: 'Dev User' }` or reads `X-Dev-User-Email` header. Production mode validates Google ID tokens and checks `hd` claim.
- **`extension/background.js`** — Lines 42-56: `onMessageExternal` listener handles `GET_GEMS` (returns `{ gems: [...] }` from `chrome.storage.local`) and `CLEAR_GEMS` (removes stored gems).
- **`extension/content-script.js`** — Lines 90-99: Extracted gem shape is `{ id, name, description, instructions, knowledgeFiles, extractedAt, source: 'edit_page' }`.
- **`extension/manifest.json`** — v0.3.0. Currently lacks `externally_connectable` — must be added for SPA messaging.
- **`docker-compose.yml`** — API on port 9090, PostgreSQL on 5432. `GOOGLE_CLIENT_ID` and `ALLOWED_DOMAIN` passed from host with empty defaults.
- **`Makefile`** — Uses `SHELL := /bin/bash`, has `api-start`, `api-stop`, `api-test`, `api-logs` targets. New `spa-dev` and `spa-build` will follow the same `##`-comment help pattern.
- **`.gitignore`** — Has `.db-config` and `node_modules/`. Needs `server/public/` and `frontend/.env.development.local`.

### Key decisions (from spec open questions, resolved by user)

1. **CSS:** Tailwind CSS.
2. **Extension ID:** `.env.development` with hardcoded dev ID, documented process.
3. **Token refresh:** Proactive (timer before `exp`) + reactive (catch 401, retry once).
4. **Production domain:** Configurable, start with localhost. Will use a Cloud Run `run.app` domain later.
5. **Makefile:** Add `make spa-dev` (foreground, Ctrl-C to stop) and `make spa-build`.

### Dependencies

| Package | Purpose |
|---------|---------|
| `react`, `react-dom` | UI framework |
| `react-router-dom` | Client-side routing |
| `vite` | Build tool + dev server |
| `@vitejs/plugin-react` | Vite React plugin |
| `tailwindcss`, `@tailwindcss/vite` | Utility CSS framework |
| `typescript` | Type checking |
| `@types/react`, `@types/react-dom` | React type definitions |

## 3. Implementation Steps

### Phase A: Project Scaffolding

#### Step 1 — Initialize `frontend/` with Vite + React + TypeScript

- **What:** Create the `frontend/` directory and initialize a Vite project.
- **Where:** `frontend/`
- **How:** Run `npm create vite@latest frontend -- --template react-ts` from the project root, or manually create the minimal set of files. The key files are:

  **`frontend/package.json`:**
  ```json
  {
    "name": "gem-factory-frontend",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "scripts": {
      "dev": "vite",
      "build": "tsc -b && vite build",
      "preview": "vite preview"
    },
    "dependencies": {
      "react": "^19.0.0",
      "react-dom": "^19.0.0",
      "react-router-dom": "^7.5.0"
    },
    "devDependencies": {
      "@types/react": "^19.0.0",
      "@types/react-dom": "^19.0.0",
      "@vitejs/plugin-react": "^4.4.0",
      "tailwindcss": "^4.1.0",
      "@tailwindcss/vite": "^4.1.0",
      "typescript": "~5.7.0",
      "vite": "^6.3.0"
    }
  }
  ```

  **`frontend/tsconfig.json`:**
  Standard Vite React TS config. Set `"compilerOptions": { "target": "ES2020", "module": "ESNext", "moduleResolution": "bundler", "jsx": "react-jsx", "strict": true, "baseUrl": ".", "paths": { "@/*": ["src/*"] } }`. Include `src/`.

  **`frontend/tsconfig.app.json`:**
  Extends `tsconfig.json`, adds `"include": ["src"]`.

  **`frontend/tsconfig.node.json`:**
  For Vite config files: `"include": ["vite.config.ts"]`.

- **Why:** Establishes the project foundation. Using `type: "module"` matches the server's `package.json` convention.

#### Step 2 — Configure Vite with API proxy and Tailwind

- **What:** Create the Vite config with dev proxy and production build output.
- **Where:** `frontend/vite.config.ts`
- **How:**
  ```typescript
  import { defineConfig } from 'vite';
  import react from '@vitejs/plugin-react';
  import tailwindcss from '@tailwindcss/vite';

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
- **Why:** Port 3000 avoids conflict with the API on 9090. The proxy eliminates CORS issues during development. Build output goes to `server/public/` where Express will serve it.

#### Step 3 — Set up Tailwind CSS

- **What:** Add the Tailwind CSS import to the main stylesheet.
- **Where:** `frontend/src/index.css`
- **How:** Tailwind v4 uses the new CSS-first config. Create `frontend/src/index.css`:
  ```css
  @import "tailwindcss";
  ```
  This is imported in `main.tsx`. With Tailwind v4 + the `@tailwindcss/vite` plugin, no `tailwind.config.js` is needed — Tailwind auto-detects content sources from the Vite project.

#### Step 4 — Create `index.html` entry point

- **What:** The HTML shell that loads the SPA and the GIS library.
- **Where:** `frontend/index.html`
- **How:**
  ```html
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Gem Factory</title>
      <script src="https://accounts.google.com/gsi/client" async defer></script>
    </head>
    <body>
      <div id="root"></div>
      <script type="module" src="/src/main.tsx"></script>
    </body>
  </html>
  ```
- **Why:** The GIS library must be loaded as a script tag (it's not an npm package). `async defer` prevents blocking page load.

#### Step 5 — Create environment files

- **What:** Environment variable files for development.
- **Where:** `frontend/.env.development`, `frontend/.env.development.local.example`
- **How:**

  **`frontend/.env.development`** (checked into git):
  ```
  # Google OAuth Client ID — leave empty for dev bypass mode
  VITE_GOOGLE_CLIENT_ID=

  # Chrome Extension ID for SPA ↔ extension messaging
  # To find your sideloaded extension ID:
  #   1. Go to chrome://extensions
  #   2. Enable Developer Mode
  #   3. Find "Gem Factory Extractor" and copy the ID string
  # Copy this file to .env.development.local and set your ID there.
  VITE_EXTENSION_ID=

  # API base URL override (optional — defaults to same-origin /api via Vite proxy)
  # VITE_API_BASE_URL=
  ```

  **`frontend/.env.development.local.example`** (checked into git as a template):
  ```
  VITE_GOOGLE_CLIENT_ID=
  VITE_EXTENSION_ID=your-extension-id-here
  ```

- **Why:** `.env.development` provides defaults. `.env.development.local` (gitignored) holds developer-specific overrides like the sideloaded extension ID. The `.example` file documents what to set.

#### Step 6 — Update `.gitignore`

- **What:** Add frontend-specific ignores.
- **Where:** `.gitignore`
- **How:** Append:
  ```
  # SPA frontend
  frontend/node_modules/
  frontend/.env.development.local
  frontend/.env.production.local

  # Production SPA build output (served by Express)
  server/public/
  ```
- **Why:** `server/public/` is a build artifact — it should not be committed. Local env files contain developer-specific extension IDs.

#### Step 7 — Add Makefile targets

- **What:** Add `spa-dev` and `spa-build` targets.
- **Where:** `Makefile`
- **How:** Add before the `.PHONY` line:
  ```makefile
  spa-dev: ## Start the SPA dev server (Ctrl-C to stop)
  	cd frontend && npm run dev

  spa-build: ## Build the SPA for production (output: server/public/)
  	cd frontend && npm run build
  ```
  Add `spa-dev` and `spa-build` to the `.PHONY` list.
- **Why:** `spa-dev` runs in the foreground (no `-d` flag, no `&`) so Ctrl-C stops it cleanly. Consistent with the existing Makefile convention where `##` comments drive `make help`.

#### Step 8 — Create `frontend/src/main.tsx`

- **What:** React entry point.
- **Where:** `frontend/src/main.tsx`
- **How:**
  ```tsx
  import { StrictMode } from 'react';
  import { createRoot } from 'react-dom/client';
  import { BrowserRouter } from 'react-router-dom';
  import App from './App';
  import './index.css';

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
  ```

### Phase B: Authentication

#### Step 9 — Create GIS type declarations

- **What:** TypeScript declarations for the Google Identity Services global API.
- **Where:** `frontend/src/auth/gis.d.ts`
- **How:** Declare the `google.accounts.id` namespace with the types used by the SPA:
  - `google.accounts.id.initialize(config: { client_id: string; callback: (response: CredentialResponse) => void; auto_select?: boolean })`
  - `google.accounts.id.renderButton(parent: HTMLElement, config: { theme: string; size: string; width?: number })`
  - `google.accounts.id.prompt(callback?: (notification: PromptMomentNotification) => void)`
  - `google.accounts.id.revoke(email: string, callback: () => void)`
  - `CredentialResponse: { credential: string; select_by: string }`
- **Why:** GIS has no `@types` package. A local declaration file provides autocomplete and type safety without a runtime dependency.

#### Step 10 — Create `AuthProvider` and `useAuth` hook

- **What:** React context that manages authentication state.
- **Where:** `frontend/src/auth/AuthProvider.tsx`, `frontend/src/auth/useAuth.ts`
- **How:**

  **AuthProvider.tsx:**
  1. Create an `AuthContext` with shape `{ user: User | null; token: string | null; isAuthenticated: boolean; signOut: () => void; isLoading: boolean }`.
  2. `User` type: `{ email: string; name: string; picture: string; hd: string }`.
  3. On mount, call `google.accounts.id.initialize()` with `VITE_GOOGLE_CLIENT_ID`. If the env var is empty (dev mode), skip GIS initialization and set a dev user: `{ email: 'dev@localhost', name: 'Dev User', picture: '', hd: '' }` with `token: null`.
  4. The callback decodes the JWT credential (base64 decode the payload segment — no verification needed client-side, the server verifies) to extract `email`, `name`, `picture`, `hd`. Store the raw credential string as `token`.
  5. Set up a token refresh timer: decode `exp` from the JWT payload, set a `setTimeout` for `(exp * 1000 - Date.now() - 5 * 60 * 1000)` ms that calls `google.accounts.id.prompt()` for silent re-auth. If the timer fires and prompt fails, clear auth state (force re-sign-in).
  6. `signOut`: call `google.accounts.id.revoke(user.email, ...)`, clear state.
  7. Wrap children in `AuthContext.Provider`.

  **useAuth.ts:**
  Simple hook: `export function useAuth() { return useContext(AuthContext); }`. Throw if used outside provider.

- **Why:** Keeping auth in a context makes the token available to the API client layer and the user info available to the Layout component. The dev bypass mode mirrors the server's auth bypass (when `GOOGLE_CLIENT_ID` is empty).

#### Step 11 — Create `GoogleSignIn` component

- **What:** Renders the Google sign-in button.
- **Where:** `frontend/src/auth/GoogleSignIn.tsx`
- **How:**
  1. Accept no props (reads `VITE_GOOGLE_CLIENT_ID` from env).
  2. Use a `ref` to a `<div>` element.
  3. In a `useEffect`, call `google.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large' })`.
  4. If `VITE_GOOGLE_CLIENT_ID` is empty, render nothing (dev mode — auth is bypassed).
- **Why:** GIS requires rendering its own button into a DOM element via `renderButton`.

### Phase C: API Client Layer

#### Step 12 — Create API types

- **What:** TypeScript interfaces matching the API response shapes.
- **Where:** `frontend/src/api/types.ts`
- **How:** Define interfaces based on the actual response shapes from the server code:

  ```typescript
  export interface GemOwner {
    id: string;
    email: string;
    displayName: string;
  }

  export interface Gem {
    id: string;
    name: string;
    instructions: string;
    icon: string | null;
    source: string;
    status: string;
    owner: GemOwner;
    importedAt: string;
    updatedAt: string;
    duplicateCluster: { id: string; gemCount: number } | null;
  }

  export interface GemListResponse {
    gems: Gem[];
    pagination: { page: number; limit: number; total: number };
  }

  export interface ImportResult {
    imported: number;
    skipped: number;
    importedIds: string[];
  }

  export interface UserProfile {
    id?: string;
    email: string;
    displayName: string;
    gemCount: number;
    firstImportAt: string | null;
    lastImportAt: string | null;
  }

  export interface UserListItem {
    id: string;
    email: string;
    displayName: string;
    gemCount: number;
  }

  export interface Stats {
    totalGems: number;
    uniqueGems: number;
    totalUsers: number;
    duplicateClusters: number;
    topClusters: { id: string; representativeName: string; gemCount: number }[];
  }

  // Shape of gems coming from the Chrome extension
  export interface ExtractedGem {
    id: string;
    name: string;
    description: string;
    instructions: string;
    knowledgeFiles: string[];
    extractedAt: string;
    source: string;
  }
  ```

  These match: `server/routes/gems.js:141-154` (formatGem), `server/routes/users.js:13-19` and `42-49`, `server/routes/stats.js:15-20`, and `extension/content-script.js:90-99`.

#### Step 13 — Create the API client

- **What:** Typed fetch wrapper that injects auth tokens and handles errors.
- **Where:** `frontend/src/api/client.ts`
- **How:**
  1. Export a class or module with a `setToken(token: string | null)` function and an `apiRequest<T>(path: string, options?: RequestInit): Promise<T>` function.
  2. `apiRequest` prepends the base URL (from `VITE_API_BASE_URL` env var, defaulting to empty string — same-origin).
  3. Sets `Authorization: Bearer ${token}` if a token exists.
  4. Sets `Content-Type: application/json` for bodies.
  5. On non-2xx response: parse the JSON body for an `error` field, throw an `ApiError` class with `status`, `message`.
  6. On 401: throw a specific `AuthError` that the auth provider can catch to trigger re-auth.
  7. Use a module-level `let currentToken: string | null = null` for the token. The auth provider calls `setToken` when auth state changes.
  8. Include a retry-on-401 mechanism: on first 401, attempt to call a `refreshToken` callback (set by the auth provider). If refresh succeeds, retry the original request once. If it fails again, throw.

- **Why:** A centralized client avoids duplicating token injection and error handling in every API call. The `setToken` pattern avoids a circular dependency between the API client and the auth context.

#### Step 14 — Create API function modules

- **What:** Typed functions for each API endpoint.
- **Where:** `frontend/src/api/gems.ts`, `frontend/src/api/users.ts`, `frontend/src/api/stats.ts`
- **How:**

  **`gems.ts`:**
  ```typescript
  import { apiRequest } from './client';
  import type { Gem, GemListResponse, ImportResult } from './types';

  export async function importGems(gems: { name: string; instructions: string; icon?: string; source?: string }[]): Promise<ImportResult> {
    return apiRequest('/api/gems/import', {
      method: 'POST',
      body: JSON.stringify({ gems }),
    });
  }

  export async function listGems(params: { q?: string; owner?: string; status?: string; page?: number; limit?: number } = {}): Promise<GemListResponse> {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.owner) qs.set('owner', params.owner);
    if (params.status) qs.set('status', params.status);
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    const query = qs.toString();
    return apiRequest(`/api/gems${query ? '?' + query : ''}`);
  }

  export async function getGem(id: string): Promise<Gem> {
    return apiRequest(`/api/gems/${id}`);
  }

  export async function deleteGem(id: string): Promise<void> {
    await apiRequest(`/api/gems/${id}`, { method: 'DELETE' });
  }
  ```

  **`users.ts`:** `getMe()` → `GET /api/users/me`, `listUsers()` → `GET /api/users`.

  **`stats.ts`:** `getStats()` → `GET /api/stats`.

  All functions use the `apiRequest` wrapper from `client.ts`.

### Phase D: Extension Communication

#### Step 15 — Add `externally_connectable` to the Chrome extension manifest

- **What:** Edit the extension manifest to allow the SPA origin to send messages.
- **Where:** `extension/manifest.json`
- **How:** Add after `"host_permissions"`:
  ```json
  "externally_connectable": {
    "matches": ["http://localhost:3000/*"]
  },
  ```
  Bump the version to `"0.4.0"`. When a production domain is known, add it to the `matches` array (e.g., `"https://*.run.app/*"` or the specific `run.app` URL).
- **Why:** Without `externally_connectable`, `chrome.runtime.sendMessage` from the SPA to the extension fails silently. The version bump signals a testable change per the convention in `CLAUDE.md`.

#### Step 16 — Create `useExtension` hook

- **What:** React hook for detecting the extension and communicating with it.
- **Where:** `frontend/src/extension/useExtension.ts`
- **How:**
  ```typescript
  import { useState, useEffect, useCallback } from 'react';
  import type { ExtractedGem } from '../api/types';

  const EXTENSION_ID = import.meta.env.VITE_EXTENSION_ID;

  interface UseExtensionResult {
    available: boolean;
    loading: boolean;
    gems: ExtractedGem[];
    fetchGems: () => Promise<void>;
    clearGems: () => Promise<void>;
    error: string | null;
  }

  export function useExtension(): UseExtensionResult {
    const [available, setAvailable] = useState(false);
    const [loading, setLoading] = useState(true);
    const [gems, setGems] = useState<ExtractedGem[]>([]);
    const [error, setError] = useState<string | null>(null);

    const sendMessage = useCallback(
      (message: { type: string }): Promise<any> => {
        return new Promise((resolve, reject) => {
          if (!EXTENSION_ID || typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
            reject(new Error('Extension not available'));
            return;
          }
          chrome.runtime.sendMessage(EXTENSION_ID, message, (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(response);
            }
          });
        });
      },
      [],
    );

    const fetchGems = useCallback(async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await sendMessage({ type: 'GET_GEMS' });
        setAvailable(true);
        setGems(response?.gems || []);
      } catch {
        setAvailable(false);
        setGems([]);
      } finally {
        setLoading(false);
      }
    }, [sendMessage]);

    const clearGems = useCallback(async () => {
      try {
        await sendMessage({ type: 'CLEAR_GEMS' });
        setGems([]);
      } catch (err) {
        setError('Failed to clear extension storage');
      }
    }, [sendMessage]);

    useEffect(() => { fetchGems(); }, [fetchGems]);

    return { available, loading, gems, fetchGems, clearGems, error };
  }
  ```

  Also add a `chrome.runtime` type stub in `frontend/src/extension/chrome.d.ts`:
  ```typescript
  declare namespace chrome {
    namespace runtime {
      function sendMessage(extensionId: string, message: any, callback: (response: any) => void): void;
      const lastError: { message: string } | undefined;
    }
  }
  ```

- **Why:** The hook encapsulates all extension communication. Detection happens on mount by trying `GET_GEMS` — if it fails, the extension is not available. The `fetchGems` function is also exposed for the "Refresh" button on the import page.

### Phase E: Layout and Routing

#### Step 17 — Create the `Layout` component

- **What:** App shell with navigation bar and content area.
- **Where:** `frontend/src/components/Layout.tsx`
- **How:**
  1. Import `useAuth` for user info and sign-out.
  2. Import `NavLink` from `react-router-dom` for active-link styling.
  3. Render a `<header>` with:
     - App name "Gem Factory" as a `<NavLink to="/">`.
     - Nav links: "Dashboard" (`/`), "Import" (`/import`), "Registry" (`/registry`).
     - User area: display name, Google profile picture (from `user.picture`), sign-out button.
  4. Render `<main>` containing `<Outlet />` (React Router's nested route outlet).
  5. Style with Tailwind: `max-w-7xl mx-auto` for content width, `bg-white shadow` for nav bar, `flex items-center gap-6` for nav layout.
- **Why:** Persistent layout across all authenticated pages. Using `<Outlet />` means page components render inside the layout without prop drilling.

#### Step 18 — Create `App.tsx` with routing

- **What:** Top-level component with auth provider and route definitions.
- **Where:** `frontend/src/App.tsx`
- **How:**
  ```tsx
  import { Routes, Route, Navigate } from 'react-router-dom';
  import { AuthProvider } from './auth/AuthProvider';
  import { useAuth } from './auth/useAuth';
  import Layout from './components/Layout';
  import Dashboard from './pages/Dashboard';
  import Import from './pages/Import';
  import Registry from './pages/Registry';
  import GemDetail from './pages/GemDetail';
  import NotFound from './pages/NotFound';
  import { GoogleSignIn } from './auth/GoogleSignIn';

  function ProtectedRoutes() {
    const { isAuthenticated, isLoading } = useAuth();
    if (isLoading) return <div className="flex items-center justify-center h-screen">Loading...</div>;
    if (!isAuthenticated) return <SignInPage />;
    return <Layout />;
  }

  function SignInPage() {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-6">
        <h1 className="text-3xl font-bold">Gem Factory</h1>
        <p className="text-gray-600">Sign in with your corporate Google account</p>
        <GoogleSignIn />
      </div>
    );
  }

  export default function App() {
    return (
      <AuthProvider>
        <Routes>
          <Route element={<ProtectedRoutes />}>
            <Route index element={<Dashboard />} />
            <Route path="import" element={<Import />} />
            <Route path="registry" element={<Registry />} />
            <Route path="gems/:id" element={<GemDetail />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    );
  }
  ```
- **Why:** `ProtectedRoutes` wraps all authenticated routes. If not signed in, shows the sign-in page instead of redirecting (avoids URL churn). The `Layout` component renders `<Outlet />` for the nested routes.

### Phase F: Shared Components

#### Step 19 — Create `GemCard` component

- **What:** Reusable card for displaying a gem summary.
- **Where:** `frontend/src/components/GemCard.tsx`
- **How:**
  1. Props: `gem: Gem` (from `api/types.ts`).
  2. Render: gem name as a `<Link to={/gems/${gem.id}}>`, owner email, truncated instructions (first 100 chars + "..."), import date (formatted with `toLocaleDateString`), source badge, duplicate cluster badge if present.
  3. Style with Tailwind: `border rounded-lg p-4 hover:shadow-md transition-shadow`.
- **Why:** Used on both the Dashboard (user's gems) and the Registry (all gems).

#### Step 20 — Create `SearchBar` component

- **What:** Search input with debounce.
- **Where:** `frontend/src/components/SearchBar.tsx`
- **How:**
  1. Props: `value: string`, `onChange: (value: string) => void`, `placeholder?: string`.
  2. Internal state for the input value. `useEffect` with a 300ms `setTimeout` that calls `onChange` when the internal value settles.
  3. Cleanup the timeout on unmount or when value changes.
  4. Style: `w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500`.
- **Why:** Debounce prevents firing an API request on every keystroke.

#### Step 21 — Create `Pagination` component

- **What:** Page navigation controls.
- **Where:** `frontend/src/components/Pagination.tsx`
- **How:**
  1. Props: `page: number`, `limit: number`, `total: number`, `onPageChange: (page: number) => void`.
  2. Calculate total pages: `Math.ceil(total / limit)`.
  3. Render previous/next buttons (disabled at bounds) and current page indicator ("Page X of Y").
  4. Style with Tailwind: `flex items-center gap-2`.
- **Why:** Used on the Registry page for paginated gem browsing.

#### Step 22 — Create `EmptyState` component

- **What:** Placeholder for empty lists.
- **Where:** `frontend/src/components/EmptyState.tsx`
- **How:**
  1. Props: `message: string`, `action?: { label: string; to: string }` (optional call-to-action link).
  2. Render centered message with optional `<Link>` button.
  3. Style: `text-center py-12 text-gray-500`.

### Phase G: Dashboard Page

#### Step 23 — Create `Dashboard` page

- **What:** Landing page showing user's gems and org stats.
- **Where:** `frontend/src/pages/Dashboard.tsx`
- **How:**
  1. Fetch the user's gems on mount: `listGems({ owner: user.email })` from `api/gems.ts`. Use `useAuth()` to get the email.
  2. Fetch org stats on mount: `getStats()` from `api/stats.ts`.
  3. **My Gems section:** Render a grid of `GemCard` components. If empty, show `EmptyState` with action linking to `/import`.
  4. **Org Overview section:** Render stat cards in a row — total gems, unique gems, contributors. Each card is a simple `<div>` with a large number and label. Use Tailwind grid: `grid grid-cols-3 gap-4`.
  5. Loading state: show a spinner or skeleton while fetches are in flight.
  6. Error state: show inline error message if API calls fail.

### Phase H: Import Flow

#### Step 24 — Create `ImportPreview` component

- **What:** List of extracted gems with checkboxes for selective import.
- **Where:** `frontend/src/components/ImportPreview.tsx`
- **How:**
  1. Props: `gems: ExtractedGem[]`, `selected: Set<string>`, `onToggle: (gemId: string) => void`, `onToggleAll: () => void`.
  2. Render a table or list with a "select all" checkbox in the header.
  3. Each row: checkbox, gem name, instruction preview (first 80 chars), extraction timestamp (`extractedAt` formatted).
  4. Style: `divide-y` for row separators.

#### Step 25 — Create `ManualImportForm` component

- **What:** Form for manually entering a gem (name + instructions).
- **Where:** `frontend/src/components/ManualImportForm.tsx`
- **How:**
  1. Props: `onImport: (gems: { name: string; instructions: string; source: string }[]) => Promise<void>`, `loading: boolean`.
  2. Two controlled inputs: gem name (`<input>`) and instructions (`<textarea>`).
  3. Client-side validation: name required, instructions required and non-empty, instructions max 100KB (matching `server/routes/gems.js:11` `MAX_INSTRUCTION_LENGTH`).
  4. Submit calls `onImport([{ name, instructions, source: 'manual' }])`.
  5. Clear form on successful import.
  6. Show validation errors inline below each field.

#### Step 26 — Create `Import` page

- **What:** The gem import flow page with extension detection and manual fallback.
- **Where:** `frontend/src/pages/Import.tsx`
- **How:**
  1. Use `useExtension()` to detect extension and retrieve gems.
  2. State: `selected: Set<string>` (gem IDs to import, all selected by default), `importResult: ImportResult | null`, `importing: boolean`, `importError: string | null`.
  3. **Extension path (available && gems.length > 0):**
     - Header: "Import Gems from Gemini" with badge "N gems ready".
     - Render `<ImportPreview>` with select/deselect.
     - "Import Selected" button: on click, map selected `ExtractedGem` objects to the API payload shape (`{ name, instructions, source: 'extension' }`), call `importGems()`. On success, set `importResult`, call `clearGems()`. On error, set `importError` — do NOT call `clearGems`.
     - "Refresh" button calls `fetchGems()`.
     - After import, show result summary: "N imported, N skipped (already in your registry)".
  4. **Extension detected, no gems (available && gems.length === 0):**
     - Message: "No gems found in the extension. Open a gem's edit page in Gemini and click the blue button to extract it."
  5. **Extension not detected (!available && !loading):**
     - Install prompt: "Install the Gem Factory Chrome Extension to import gems directly from Gemini. Load it in developer mode from the `extension/` directory."
     - Below: render `<ManualImportForm>` with the same `importGems` call (source: 'manual').
  6. The manual form is always accessible (e.g., via a "Manual Import" tab or section) even when the extension is detected, for flexibility.

### Phase I: Registry Browser

#### Step 27 — Create `Registry` page

- **What:** Browse and search all gems in the organization.
- **Where:** `frontend/src/pages/Registry.tsx`
- **How:**
  1. Read URL search params with `useSearchParams()` from React Router: `q`, `owner`, `page`.
  2. Fetch gems on mount and when search params change: `listGems({ q, owner, page, limit: 20 })`.
  3. Fetch users for the owner filter dropdown: `listUsers()` (once, on mount).
  4. Render:
     - `<SearchBar>` bound to the `q` param. On change, update URL params (`setSearchParams`), reset page to 1.
     - Owner filter: `<select>` populated from `listUsers()`. Default: "All owners".
     - Results grid: `GemCard` components in a `grid grid-cols-1 md:grid-cols-2 gap-4`.
     - `<Pagination>` bound to `page` param.
     - `<EmptyState>` when no results match.
  5. Loading: spinner overlay or skeleton cards while fetching.
- **Why:** URL-synced search state (`/registry?q=helper&page=2`) makes searches shareable and survives page refresh.

### Phase J: Gem Detail Page

#### Step 28 — Create `GemDetail` page

- **What:** Full view of a single gem.
- **Where:** `frontend/src/pages/GemDetail.tsx`
- **How:**
  1. Read `id` from `useParams()`.
  2. Fetch gem on mount: `getGem(id)`. Handle 404 (show "Gem not found" with link to registry).
  3. Render:
     - **Header:** Gem name (large), owner email, import date, source badge (Tailwind `rounded-full px-2 py-1 text-xs bg-blue-100`).
     - **Instructions block:** Full text in a `<pre className="whitespace-pre-wrap bg-gray-50 p-4 rounded-lg overflow-auto max-h-96 text-sm">`.
     - **"Copy Instructions" button:** `navigator.clipboard.writeText(gem.instructions)`. Show "Copied!" feedback for 2 seconds (same pattern as `extension/content-script.js:243-248`).
     - **Delete button (owner only):** Compare `gem.owner.email` with `useAuth().user.email`. On click, confirm with `window.confirm()`, then call `deleteGem(id)`, navigate to `/` on success.
     - **Metadata:** Status, duplicate cluster info if present.
  4. Loading and error states.

#### Step 29 — Create `NotFound` page

- **What:** 404 fallback.
- **Where:** `frontend/src/pages/NotFound.tsx`
- **How:** Simple page: "Page not found" heading, link back to Dashboard. Style: centered, `text-gray-500`.

### Phase K: Server-Side Integration

#### Step 30 — Add static file serving to `server/server.js`

- **What:** Serve the built SPA assets and add SPA fallback routing.
- **Where:** `server/server.js`
- **How:** Add after the existing route mounts (after `app.use('/api/stats', statsRouter)`) and before the global error handler:
  ```javascript
  import { fileURLToPath } from 'node:url';
  import path from 'node:path';

  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  // Serve SPA static files (only if the public directory exists)
  import fs from 'node:fs';
  const publicDir = path.join(__dirname, 'public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
    // SPA fallback — all non-API routes return index.html
    app.get('*', (req, res) => {
      res.sendFile(path.join(publicDir, 'index.html'));
    });
  }
  ```
  Also remove or adjust the existing `app.get('/', ...)` root handler — it should be replaced by the SPA's `index.html` when the build exists, but remain as-is when no build exists (API-only development).
- **Why:** The SPA fallback is critical for client-side routing — without it, direct navigation to `/registry` returns a 404. The `existsSync` guard means the server works fine without a frontend build (e.g., during API-only development).

#### Step 31 — Update `server/Dockerfile` for production builds

- **What:** Multi-stage Docker build that builds the frontend and serves it alongside the API.
- **Where:** `server/Dockerfile`
- **How:**
  ```dockerfile
  # Stage 1: Build the frontend
  FROM node:20-alpine AS frontend-build
  WORKDIR /frontend
  COPY ../frontend/package.json ../frontend/package-lock.json* ./
  RUN npm install
  COPY ../frontend/ .
  RUN npm run build

  # Stage 2: API server with built frontend
  FROM node:20-alpine
  WORKDIR /app
  COPY package.json package-lock.json* ./
  RUN npm install --production
  COPY . .
  COPY --from=frontend-build /frontend/../server/public ./public
  EXPOSE 9090
  CMD ["node", "server.js"]
  ```

  Note: The Vite build outputs to `../server/public` relative to `frontend/`, so inside the build stage we need to account for that. An alternative (simpler) approach: adjust the Dockerfile context to the project root, or build the frontend outside Docker and copy the `server/public/` directory. Given that Docker Compose mounts `./server:/app`, the simpler approach for now is:

  Keep the existing Dockerfile as-is for local dev (where Vite builds to `server/public/` on the host). For production, add a `Dockerfile.prod` at the project root or handle the frontend build in CI before `docker build`. This decision can be deferred — for Phase 1, `make spa-build` runs on the host and the output lands in `server/public/` which is bind-mounted into the container.

- **Why:** Local dev doesn't need a multi-stage build because the Vite dev server runs separately. Production build integration is noted as Milestone 7 in the spec and can be refined when deploying to Cloud Run.

### Phase L: Verification & Cleanup

#### Step 32 — Install dependencies and verify the dev workflow

- **What:** Run `npm install` in `frontend/`, verify the full dev stack works end-to-end.
- **Where:** `frontend/`
- **How:**
  1. `cd frontend && npm install`.
  2. `make api-start` (start the backend).
  3. `make spa-dev` (start the Vite dev server).
  4. Open `http://localhost:3000` — should see the sign-in page (or auto-bypass to dashboard in dev mode).
  5. Navigate through all routes: `/`, `/import`, `/registry`.
  6. Verify API proxy: browser's network tab should show `/api/users/me` requests going through successfully.
  7. Ctrl-C to stop the Vite dev server.
  8. `make spa-build` — should produce files in `server/public/`.
  9. Open `http://localhost:9090` — should serve the built SPA.
  10. Navigate to `/registry` and refresh — SPA fallback should serve `index.html`, client-side router should handle the route.

#### Step 33 — Test extension communication

- **What:** Verify the SPA can talk to the Chrome extension.
- **Where:** Browser with the extension loaded.
- **How:**
  1. Load the extension in Chrome (`chrome://extensions` → Load unpacked → `extension/` directory).
  2. Note the extension ID, set it in `frontend/.env.development.local`.
  3. Restart the Vite dev server (`make spa-dev`).
  4. Navigate to `gemini.google.com`, open a gem's edit page, click the FAB to extract.
  5. Open `http://localhost:3000/import` — should detect the extension and show the extracted gem(s).
  6. Click "Import Selected" — gem should be imported to the API.
  7. Navigate to `/` (Dashboard) — imported gem should appear.

## 4. Data Model / Schema Changes

No database schema changes. The SPA consumes the existing API responses.

### New TypeScript types (in `frontend/src/api/types.ts`)

- `Gem`, `GemOwner`, `GemListResponse`, `ImportResult` — match `server/routes/gems.js:141-154` formatGem output.
- `UserProfile`, `UserListItem` — match `server/routes/users.js` response shapes.
- `Stats` — matches `server/routes/stats.js` response shape.
- `ExtractedGem` — matches `extension/content-script.js:90-99` gem shape.

### New configuration

- `VITE_GOOGLE_CLIENT_ID` — build-time env var for GIS initialization. Empty = dev bypass.
- `VITE_EXTENSION_ID` — build-time env var for extension messaging. Empty = extension features disabled.
- `VITE_API_BASE_URL` — optional API base URL override.

### Extension manifest change

- `extension/manifest.json`: Add `externally_connectable.matches` array. Bump version to `0.4.0`.

## 5. Integration Points

### SPA ↔ Chrome Extension

The SPA calls `chrome.runtime.sendMessage(EXTENSION_ID, message, callback)` using the protocol already implemented in `extension/background.js:42-56`. Messages: `GET_GEMS` returns `{ gems: ExtractedGem[] }`, `CLEAR_GEMS` returns `{ success: true }`. Requires `externally_connectable` in the manifest.

### SPA ↔ Backend API

All API calls go through `frontend/src/api/client.ts` with Bearer token injection. The SPA consumes every endpoint defined in `server/routes/`: `gems.js` (import, list, get, update, delete), `users.js` (me, list), `stats.js` (org stats).

### Backend ↔ SPA Static Serving

`server/server.js` gains `express.static('public')` and a `*` catch-all route returning `index.html`. This must come after all `/api/*` routes.

### Vite Dev Server ↔ Backend

The Vite `server.proxy` configuration in `vite.config.ts` forwards `/api/*` to `http://localhost:9090` during development.

### Makefile

New targets `spa-dev` (foreground, Ctrl-C to stop) and `spa-build` integrate with the existing pattern.

## 6. Edge Cases & Risks

### GIS library loading

The GIS script loads asynchronously from Google's CDN. If it hasn't loaded when `AuthProvider` mounts, `google.accounts.id` will be undefined. The provider must wait for the script to load (poll or use an `onload` callback on the script tag) before calling `initialize()`. If the CDN is unreachable (corporate firewall, offline), show a meaningful error instead of crashing.

### Dev bypass and token refresh

In dev mode (`VITE_GOOGLE_CLIENT_ID` empty), there's no real token and no expiry. The token refresh timer must not run. The API client must omit the `Authorization` header (the server's dev bypass mode in `middleware/auth.js:12-18` doesn't require one).

### Extension ID mismatch

If the sideloaded extension is reloaded, Chrome assigns a new ID. The `.env.development.local` value becomes stale. The `useExtension` hook will fail to detect the extension. Document this in the `.env.development` file comments and in a README.

### Large instruction text in GemCard

Gem instructions can be up to 100KB. The `GemCard` must truncate to a preview (first 100 chars). Use `instructions.slice(0, 100)` + "..." rather than CSS truncation, to avoid rendering the full string in the DOM.

### SPA fallback vs. API 404

The `app.get('*')` SPA fallback in `server/server.js` must not catch `/api/*` requests. Since Express evaluates routes in order and the API routes are mounted first, `/api/nonexistent` will correctly return 404 from Express's default handler (no matching API route) rather than serving `index.html`. The `*` fallback only matches paths that don't match any prior route.

### `externally_connectable` production domain

The manifest's `externally_connectable.matches` only includes `http://localhost:3000/*` initially. When deploying to a `run.app` domain, the manifest must be updated and the extension republished. This is a manual step that must not be forgotten.

## 7. Verification

### Per-milestone verification

**After Phase A (Steps 1-8):**
- `cd frontend && npm install` succeeds.
- `make spa-dev` starts Vite on port 3000, Ctrl-C stops it.
- `http://localhost:3000` shows the Vite default page or a blank page with "Gem Factory" title.

**After Phase B (Steps 9-11):**
- With `VITE_GOOGLE_CLIENT_ID` empty: app auto-signs in as dev user.
- With `VITE_GOOGLE_CLIENT_ID` set: Google sign-in button appears, click it to authenticate.

**After Phases C-D (Steps 12-16):**
- With API running (`make api-start`): `http://localhost:3000` loads, calls `/api/users/me` successfully (check network tab).
- With extension loaded and `.env.development.local` configured: Import page detects the extension.

**After Phases E-F (Steps 17-22):**
- Nav bar renders with links. Clicking links navigates between routes.
- `GemCard` renders mock data correctly.

**After Phase G (Step 23):**
- Dashboard shows "No gems yet" empty state for new users.
- Dashboard shows org stats from the API.

**After Phase H (Steps 24-26):**
- Extension import: extracted gems appear in preview, selecting and importing works, result summary displays, extension storage is cleared.
- Manual import: form validates, submits, gem appears on dashboard.

**After Phase I (Step 27):**
- Registry shows all gems with pagination.
- Search filters results. URL reflects search state.
- Owner filter narrows results.

**After Phase J (Steps 28-29):**
- Clicking a gem card navigates to detail page.
- Full instructions are shown. "Copy Instructions" works.
- Owner sees delete button. Non-owner does not.

**After Phase K (Steps 30-31):**
- `make spa-build` produces output in `server/public/`.
- `http://localhost:9090` serves the built SPA.
- Refreshing on `/registry` serves the SPA (not a 404).

### Acceptance criteria (from spec section 9)

| # | Criterion | Verified by |
|---|-----------|------------|
| 1 | Sign in with corporate Google account, see name in nav | Phase B verification |
| 2 | Unauthenticated users can't access pages; all API calls have Bearer token | Phase B + C verification |
| 3 | Extension detected, gems displayed in preview, import works | Phase H verification |
| 4 | After import, extension cleared, gems on Dashboard | Phase H verification |
| 5 | Manual import via form works | Phase H verification |
| 6 | Registry shows all gems with pagination and search | Phase I verification |
| 7 | Gem card → detail page with full instructions | Phase J verification |
| 8 | `npm run build` produces servable output | Phase K verification |
| 9 | `npm run dev` proxies API calls | Phase A verification |

## 8. Open Questions

### Resolved

- **CSS framework** → Tailwind CSS (user decision).
- **Extension ID management** → `.env.development` + `.env.development.local` (user decision).
- **Token refresh** → Proactive timer + reactive 401 catch (user confirmed spec recommendation).
- **Production domain** → Configurable; `localhost:3000` for now, `run.app` later (user decision).
- **Makefile integration** → `make spa-dev` (foreground) and `make spa-build` (user decision).

### Remaining

- **Google OAuth Client ID for non-dev-bypass testing:** To test real GIS auth locally, a Google Cloud Console OAuth client ID is needed with `http://localhost:3000` as an authorized JavaScript origin. This is optional — dev bypass mode is sufficient for initial development. Create the client ID when ready to test auth end-to-end.
- **Multi-stage Docker build for production:** The current plan defers the production Dockerfile changes. When deploying to Cloud Run, the build pipeline needs to produce a single image with both the API server and the built frontend. Options: multi-stage Dockerfile at the project root, or CI step that builds the frontend before building the Docker image. Decide when production deployment is scoped.
- **Extension version for Chrome Web Store:** When publishing the extension with the `externally_connectable` change (Step 15), the production domain must be in the `matches` array. If the `run.app` domain isn't known yet, the Chrome Web Store version cannot include production messaging support. The extension can be updated later, but there's a review cycle.
