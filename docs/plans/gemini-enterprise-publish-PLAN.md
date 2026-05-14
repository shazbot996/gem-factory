---
type: plan
title: "Gemini Enterprise Publication — Implementation Plan"
spec: docs/specs/gemini-enterprise-publish-SPEC.md
scope: Staged delivery of the GE publication feature in three phases — admin configuration & connection test, minimal prompt-and-description publish, then knowledge-files and tools support
date: 2026-04-16
---

## 1. Goal

Deliver the Gemini Enterprise publication feature specified in `docs/specs/gemini-enterprise-publish-SPEC.md` incrementally, so each phase is independently testable against a real GE instance (the sandbox at `schiele.altostrat.com`) before the next one builds on top. Phase 1 proves the admin can configure credentials and that the server can reach the customer's GE project. Phase 2 adds minimal gem publication (instructions + description only) end-to-end with a real recipe that produces a working agent in Agent Designer. Phase 3 extends the publish path with knowledge-file ingestion (custom Discovery Engine data store backed by user-Drive → GCS → `documents.import`) and tool mapping.

## 2. Context & Prior Art

### Existing patterns we match

- **Migrations.** `server/db/migrate.js` runs numbered `.sql` files in `server/db/migrations/` inside a single transaction per file, tracked in `schema_migrations`. The next file is `003_*.sql` (we already have `001_initial_schema.sql`, `002_add_gem_metadata.sql`).
- **Routes.** Each route group is a `Router` under `server/routes/` mounted in `server/server.js:40–42`. The admin-only pattern is visible at `server/routes/users.js:41` — `router.get('/', requireAdmin, …)` using `server/middleware/admin.js`. `requireAdmin` assumes auth middleware already populated `req.user`.
- **Repositories.** Thin wrappers over `pool.query(...)` in `server/db/*.js` (see `server/db/gems.js`, `server/db/users.js`). Export named async functions; callers pass the `pool` through.
- **Frontend API client.** `frontend/src/api/client.ts` wraps `fetch` with the Bearer token and 401 refresh. Per-resource files (`gems.ts`, `users.ts`, `stats.ts`) export typed functions. Types live in `frontend/src/api/types.ts`.
- **Admin gating in the SPA.** `useAuth()` already surfaces `isAdmin` (populated from `/api/users/me` — see `AuthProvider.tsx:50–64`). Pages can check `const { isAdmin } = useAuth()` and render a `NotFound` fallback or a denial message when false.
- **Routing.** `App.tsx:63–76` — protected routes mount under `<Layout />`. Adding a new page = adding one `<Route>` and (optionally) one `<NavLink>` in `Layout.tsx:30–37`.
- **Auth middleware** (`server/middleware/auth.js`) covers every `/api/*` route via `app.use('/api', authMiddleware)` in `server.js:37`. Dev bypass auto-authenticates as `dev@localhost` when `GOOGLE_CLIENT_ID` is empty.
- **Google Cloud credentials.** `docker-compose.yml` has a commented-out `~/.config/gcloud` volume mount for ADC, cross-referenced in `docs/specs/authentication-authorization-SPEC.md` §3.4. Production Cloud Run uses the attached service account.
- **Dependencies.** `server/package.json` already includes `google-auth-library` (per `CLAUDE.md`); no `googleapis` SDK is used — we stay with hand-rolled `fetch` calls for parity with existing code style.

### Spec sections load-bearing for this plan

- §3.3 user workflow, §4.2 components, §4.4 orchestration, §4.6 schema, §4.7 API surface, §5 UI, §6.4 IAM roles, §8 milestones.
- §4.1 is the critical constraint: Agent Designer has no public creation API as of April 2026. Phase 2 implements the **"recipe-and-paste"** path the spec committed to, not a programmatic `agents.create`.

### External dependencies

- `google-auth-library` (already installed) for ADC + service-account impersonation.
- REST endpoints called directly via `fetch`:
  - `https://serviceusage.googleapis.com/v1/projects/{p}/services/{api}:enable`
  - `https://iam.googleapis.com/v1/projects/-/serviceAccounts/{email}` (connectivity probe)
  - `https://{region}-discoveryengine.googleapis.com/v1alpha/projects/{p}/locations/{l}/collections/default_collection/engines/{engine}` (engine get)
  - Phase 3 only: `discoveryengine` `dataStores.create` + `documents.import`, plus Drive API + GCS upload.

---

## 3. Implementation Steps

Each phase ends in a **verification gate** — do not advance to the next phase until the gate passes against the live sandbox GE instance on `schiele.altostrat.com`.

### Phase 1 — Admin configuration and connection test

The goal of Phase 1 is narrow: an admin can open a settings page, fill in project / region / engine / impersonation-SA fields, hit "Test connection," and see a pass/fail summary. No gem publication yet. No knowledge ingestion. The IAM role help text lives on the same page.

#### 1.1 Database migration for `org_enterprise_settings`

**What:** Add the single-row settings table from spec §4.6 (plus schema_migrations tracking; `gem_publications` is deferred to Phase 2).

**Where:** `server/db/migrations/003_add_enterprise_settings.sql` (new file).

**How:** Follow the style of `002_add_gem_metadata.sql` — plain SQL, no stored procedures. Column set exactly as §4.6 specifies for `org_enterprise_settings`. Do **not** include `gem_publications` here — that belongs in `004_*.sql` created in Phase 2, to keep each migration scoped.

```sql
CREATE TABLE org_enterprise_settings (
  id                          INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  project_id                  TEXT,
  region                      TEXT DEFAULT 'global',
  engine_id                   TEXT,
  impersonation_sa_email      TEXT,
  preferred_model             TEXT DEFAULT 'gemini-3-pro-preview',
  drive_staging_bucket        TEXT,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by                  UUID REFERENCES users(id)
);
```

**Why:** `migrate.js` will pick this up automatically on next container start. The `CHECK (id = 1)` pins this to a single row forever — if we go multi-tenant later, we drop this constraint and add a tenant FK.

#### 1.2 Repository for settings

**What:** `getSettings(pool)` and `upsertSettings(pool, {…, updatedBy})` helpers.

**Where:** `server/db/enterpriseSettings.js` (new file).

**How:** Mirror the named-export style of `server/db/users.js`. `getSettings` returns the single row or `null`. `upsertSettings` does `INSERT … ON CONFLICT (id) DO UPDATE SET …` with `id = 1` hard-coded. Never accept `id` from the caller.

#### 1.3 Google Cloud client wrapper

**What:** A thin module that produces an authenticated `fetch` function for a given impersonation target.

**Where:** `server/services/gcpClient.js` (new file).

**How:**
- Export `async function getGcpFetch({ impersonationEmail })`.
- Build a `GoogleAuth` instance from `google-auth-library`. If `impersonationEmail` is present, use `Impersonated` with `targetPrincipal = impersonationEmail` and the `cloud-platform` scope; otherwise fall back to the raw ADC client (useful for local dev when the developer's own account has the roles).
- Return a function `(url, opts) => fetch(url, { …opts, headers: { …opts.headers, Authorization: `Bearer ${accessToken}` } })` that refreshes the token on each call (the library caches internally).
- Export a helper `parseGcpError(res)` that reads JSON-or-text from a non-2xx Response and returns `{ code, message, status }`, so callers produce consistent error surface.

**Why:** Centralizing token acquisition keeps each caller simple and makes unit-testing the callers easier (they accept `gcpFetch` as a dependency).

#### 1.4 Connection probe service

**What:** Implement the "Test connection" logic: confirm impersonation works, confirm the engine resource is reachable, confirm required APIs are enabled.

**Where:** `server/services/geConnection.js` (new file).

**How:** Export `async function testConnection(settings)` that returns:

```js
{
  ok: boolean,
  steps: [
    { name: 'impersonate', status: 'ok' | 'fail', message?, code? },
    { name: 'apis_enabled', status, details: { discoveryengine: true, aiplatform: true } },
    { name: 'engine_reachable', status, message? },
  ]
}
```

Each step runs in order and short-circuits with `ok: false` on the first failure. Implementation:

1. **impersonate** — call `iam.googleapis.com/v1/projects/-/serviceAccounts/{impersonation_sa_email}` (`GET`). Any 200 proves the impersonation chain works. Record the numeric project number if present (useful for future calls).
2. **apis_enabled** — call `serviceusage.googleapis.com/v1/projects/{project_id}/services/discoveryengine.googleapis.com` and `…/aiplatform.googleapis.com`. Check the `state` field in each response; treat `ENABLED` as ok. Do **not** auto-enable in the connection test — just report. Auto-enable happens during publish (Phase 2).
3. **engine_reachable** — call `https://{region}-discoveryengine.googleapis.com/v1alpha/projects/{p}/locations/{region}/collections/default_collection/engines/{engineId}`. A 200 proves the impersonation SA has `discoveryengine` read access on the engine.

Return granular errors: on 403 surface "Missing role X" with the likely-missing role name; on 404 surface "Engine `{engineId}` not found in project `{project}` / location `{region}`."

#### 1.5 Settings + connection test routes

**What:** Three admin-only endpoints.

**Where:** `server/routes/enterpriseSettings.js` (new file). Mount at `/api/settings/enterprise` in `server/server.js` after the existing `usersRouter`.

**How:** Use the `requireAdmin` pattern from `server/routes/users.js:41`. The file should export a `Router` with:

| Method | Path | Auth | Body / Response |
|---|---|---|---|
| `GET` | `/api/settings/enterprise` | admin | Returns the stored settings row (or empty defaults). `impersonation_sa_email` is returned as-is (it's not a secret) but any future secret fields must be redacted. |
| `PUT` | `/api/settings/enterprise` | admin | Upserts the settings row. Validates: non-empty `projectId`, `engineId`, `impersonationSaEmail`; `region` defaults to `global`; model from a hardcoded allowlist. Sets `updated_by` to the admin's `users.id` (look up via `usersDb.findByEmail`). |
| `POST` | `/api/settings/enterprise/test` | admin | Runs `testConnection` using **the payload in the request body** if present, else the stored settings. This lets the UI test **before** saving. |

Register in `server/server.js` right after line 42:

```js
import enterpriseSettingsRouter from './routes/enterpriseSettings.js';
app.use('/api/settings/enterprise', enterpriseSettingsRouter);
```

#### 1.6 Frontend API client for settings

**What:** Typed client functions.

**Where:** `frontend/src/api/enterpriseSettings.ts` (new file).

**How:** Mirror `frontend/src/api/users.ts`. Export:

```ts
export interface EnterpriseSettings { projectId: string | null; region: string; engineId: string | null; impersonationSaEmail: string | null; preferredModel: string; driveStagingBucket: string | null; updatedAt: string | null; }
export interface ConnectionTestResult { ok: boolean; steps: { name: 'impersonate' | 'apis_enabled' | 'engine_reachable'; status: 'ok' | 'fail'; message?: string; code?: string; details?: Record<string, boolean> }[]; }
export async function getEnterpriseSettings(): Promise<EnterpriseSettings> { … }
export async function putEnterpriseSettings(s: Omit<EnterpriseSettings, 'updatedAt'>): Promise<EnterpriseSettings> { … }
export async function testEnterpriseConnection(draft?: Partial<EnterpriseSettings>): Promise<ConnectionTestResult> { … }
```

Types for `ConnectionTestResult` go in `frontend/src/api/types.ts` alongside existing exports.

#### 1.7 Enterprise settings page

**What:** Admin-only SPA page with form fields + "Test connection" + IAM help.

**Where:** `frontend/src/pages/EnterpriseSettings.tsx` (new file). Route registered in `frontend/src/App.tsx:67–71` as `<Route path="settings/enterprise" element={<EnterpriseSettings />} />`.

**How:** 

- At the top: `const { isAdmin } = useAuth();` — if `!isAdmin`, render the same "Not found" message used by `NotFound.tsx` (don't leak the page's existence). The `requireAdmin` server-side middleware is the authoritative gate; this UI check is just UX.
- On mount, call `getEnterpriseSettings()`; populate form state.
- Form fields: Project ID, Region (dropdown: `global`, `us`, `eu`), Engine (App) ID, Impersonation SA email, Preferred model (dropdown: `gemini-3-pro-preview`, `gemini-3-flash-preview`, `gemini-2.5-pro`), Drive staging bucket (optional, Phase 3 only — keep the field but mark "Required for Phase 3 knowledge ingestion").
- Two buttons: **Save** (calls `putEnterpriseSettings`) and **Test connection** (calls `testEnterpriseConnection` with the current form state, whether saved or not).
- Test result panel below the form: one row per step, green check or red X, with the returned `message` and `code` when present.
- A collapsible **"Required GCP permissions"** section with the content from §1.8 below.
- Tailwind classes consistent with existing pages — compare `frontend/src/pages/GemDetail.tsx` for header/button/pill styling.

#### 1.8 IAM / permissions help content

**What:** In-page explanation of what the admin must do on the GCP side.

**Where:** Inline in `EnterpriseSettings.tsx` (collapsible section).

**How:** Static copy block. Content (render as a `<details><summary>Required GCP permissions</summary>…</details>` block so it defaults to collapsed):

```
The impersonation service account needs these roles in the target project:

- roles/discoveryengine.admin — register agents + read engines
- roles/serviceusage.serviceUsageAdmin — enable APIs on first publish
- roles/aiplatform.user — v2 only (ADK path)
- roles/storage.objectAdmin on the staging bucket — Phase 3 only

Our runtime service account must have roles/iam.serviceAccountTokenCreator
on the impersonation SA. In the GE console, add the impersonation SA as
an app admin on the target engine.

One-time gcloud commands (copy and replace {VARS}):

  gcloud iam service-accounts add-iam-policy-binding \
    {IMPERSONATION_SA} \
    --member="serviceAccount:{OUR_RUNTIME_SA}" \
    --role="roles/iam.serviceAccountTokenCreator"

  gcloud projects add-iam-policy-binding {PROJECT_ID} \
    --member="serviceAccount:{IMPERSONATION_SA}" \
    --role="roles/discoveryengine.admin"
```

Include a small live-substitute helper: when the form has Project ID and Impersonation SA filled, dynamically substitute those into the shown commands so admins can copy-paste directly.

#### 1.9 Nav entry

**What:** Add a "Settings" link to the header, visible only to admins.

**Where:** `frontend/src/components/Layout.tsx` at the end of the `<nav>` block (around line 36).

**How:**

```tsx
{isAdmin && (
  <NavLink to="/settings/enterprise" className={linkClass}>
    Settings
  </NavLink>
)}
```

Pull `isAdmin` from `useAuth()` alongside the existing `user` destructure on line 12.

#### 1.10 Docker Compose ADC mount

**What:** Uncomment the gcloud volume mount so the API container can call GCP during local development.

**Where:** `docker-compose.yml` line 21.

**How:** Remove the `#` from `# - ~/.config/gcloud:/root/.config/gcloud:ro`. Document the one-time `gcloud auth application-default login` prerequisite in the `make api-start` output (or at least note it in the PR description — do not edit `CLAUDE.md` as part of this step).

**Why:** Without this the `google-auth-library` calls inside the container have no credentials and the connection test will always fail in local dev.

#### 1.11 Phase 1 verification gate

Stop here and verify end-to-end before starting Phase 2:

1. `make api-stop && make api-start` (migration 003 runs).
2. Sign into the SPA as `charles.schiele@gmail.com` (admin).
3. Navigate to `/settings/enterprise`. Confirm a non-admin account sees the "not found" fallback.
4. Fill in the sandbox values (project = `schiele.altostrat.com` sandbox, engine = whatever exists there), save.
5. Click **Test connection**:
   - **Pass case:** all three steps green.
   - **Engine not found:** intentionally misspell the engine ID → red X on `engine_reachable` with a helpful message.
   - **Missing role:** remove `roles/discoveryengine.admin` from the impersonation SA → red X on either `apis_enabled` or `engine_reachable` with a 403 code.
   - **Impersonation not granted:** revoke `roles/iam.serviceAccountTokenCreator` → red X on `impersonate`.
6. Reload the page — the saved settings round-trip correctly.

---

### Phase 2 — Minimal publish (instructions + description only)

Goal: on a gem detail page, clicking **Publish to Gemini Enterprise** produces a `gem_publications` row, a **recipe JSON** for Agent Designer, and a deep link to the Agent Designer "new agent" screen in the customer's project. Admin pastes the recipe, confirms success back in the SPA, and the row transitions to `status='completed'`.

This phase deliberately does **not** touch knowledge files or tools — Phase 3 handles those. The recipe produced in Phase 2 contains `knowledgeFiles: []` and `tools: []`; the publisher verifies this works end-to-end first.

#### 2.1 Migration for `gem_publications`

**What:** Add the publications table from spec §4.6.

**Where:** `server/db/migrations/004_add_gem_publications.sql` (new file).

**How:** SQL exactly per §4.6, including the two indexes.

#### 2.2 Repository for publications

**What:** Thin DB layer for publication records.

**Where:** `server/db/publications.js` (new file).

**How:** Export:

- `insertPublication(pool, row) → { id, … }`
- `updatePublication(pool, id, patch) → row` (used when transitioning to `completed`, `failed`, or `superseded`)
- `listByGem(pool, gemId) → rows[]`
- `findById(pool, id) → row | null`

Status transitions are simple state; no state-machine library needed. The `CHECK` constraint in the migration enforces valid values.

#### 2.3 Recipe generator

**What:** Pure function that turns a `Gem` row into an agent recipe.

**Where:** `server/services/agentRecipe.js` (new file).

**How:** Export `function toRecipe(gem, { preferredModel })`. Phase-2 shape:

```js
{
  version: 1,
  displayName: gem.name,
  description: gem.description || deriveShortDescription(gem.instructions),
  instructions: normalizeInstructions(gem.instructions),
  model: preferredModel,
  tools: [],                 // Phase 2: always empty
  dataStore: null,           // Phase 2: always null
  knowledgeFiles: [],        // Phase 2: always empty
  source: {
    registryGemId: gem.id,
    instructionHash: gem.instruction_hash,
  },
  _warnings: [],
  _unmappedTools: [],
  _attachManually: [],
}
```

`normalizeInstructions` must match the normalizer in `server/services/ingestion.js:normalize` byte-for-byte so the resulting recipe's `instructions` hashes to the same `instruction_hash` as stored on the gem row. Import from `ingestion.js` rather than reimplementing (export `normalize` from `ingestion.js` if it isn't already exported).

Unit tests: `server/test/agentRecipe.test.js` using Node's built-in `node:test`. Cover:
- Happy-path gem with description.
- Gem with `null` description → `deriveShortDescription` returns first sentence of instructions, trimmed to ≤140 chars.
- Long instructions (>100KB) → `_warnings` gets an entry like `"instructions exceed 100KB; may be rejected by GE"`.
- Instructions with CRLF + excessive blank lines → normalization applied.

#### 2.4 Publish orchestrator (minimal)

**What:** The multi-step "kick off a publish" service.

**Where:** `server/services/publish.js` (new file).

**How:** Export `async function publishGem(pool, { gemId, publisherUserId })`. Steps (subset of spec §4.4):

1. Load the gem (reuse `server/db/gems.js` helper) and assert publisher is owner or admin.
2. Load settings via `enterpriseSettings.getSettings`. If unset → return `{ status: 'failed', error: 'enterprise_not_configured' }` (the route translates to 409).
3. Build `gcpFetch` via `gcpClient.getGcpFetch`.
4. Run `geConnection.testConnection(settings)`; append step results. If not ok → persist `gem_publications` row with `status='failed'`, return it.
5. **Ensure APIs enabled** — `serviceusage POST services:enable` for any API not already enabled (idempotent).
6. **Resolve engine** — `engines.get`; confirm `displayName` returned.
7. Generate recipe via `agentRecipe.toRecipe(gem, { preferredModel: settings.preferred_model })`.
8. Insert `gem_publications` row with:
   - `status='recipe_ready'`,
   - `steps_jsonb = [ { name, status, message?, code? }, ... ]`,
   - `recipe_jsonb = recipe`,
   - `agent_resource_name = null`,
   - `data_store_resource_name = null`,
   - `instruction_hash_at_publish = gem.instruction_hash`,
   - `model = settings.preferred_model`.
9. Mark any prior `recipe_ready`/`completed` rows for the same `gem_id` as `status='superseded'`.
10. Return the inserted row (the route shapes it into JSON).

**Concurrency safety:** Wrap the orchestrator body in a PG advisory lock keyed on `('publish'::text, gem_id::uuid)` using `SELECT pg_advisory_xact_lock(hashtext($1), ('x'||substr($2,1,8))::bit(32)::int)` inside a transaction. Simpler alternative: `pg_try_advisory_lock(hashtext('publish:' || gem_id))` and fail the second concurrent attempt with 409. The second alternative is sufficient for v1.

#### 2.5 Publish routes

**What:** HTTP surface for publish + publication history + "mark complete."

**Where:** `server/routes/publish.js` (new file). Mount at `/api` (so paths read `/api/gems/:id/publish`, `/api/gems/:id/publications`, `/api/publications/:id`, `/api/publications/:id/complete`) — or create two routers and mount one under `/api/gems` and one under `/api/publications`. Mirror the existing split in `server/server.js`.

**How:** Endpoints per spec §4.7:

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| `POST` | `/api/gems/:id/publish` | owner or admin | `{}` (Phase 2 has no options) | `PublishResult` — full `gem_publications` row plus the recipe. |
| `GET` | `/api/gems/:id/publications` | owner or admin | — | `{ publications: […] }` |
| `GET` | `/api/publications/:id` | owner or admin | — | single publication row |
| `POST` | `/api/publications/:id/complete` | owner or admin | `{ agentResourceName: string }` | updated row. Validates `agentResourceName` regex matches `projects/…/agents/…`. Only allowed when current `status='recipe_ready'`. |

Use the same `formatGem`-style response shaping as `server/routes/gems.js:154–172`. Define `formatPublication(row)` in this file (camelCase keys, ISO dates).

Ownership check pattern: load the gem via `gemsDb.getById`, reject with 404 if user isn't owner and `!isAdmin(req.user.email)`.

#### 2.6 Frontend API client + types

**What:** Typed client for publish.

**Where:** `frontend/src/api/publish.ts` (new); types in `frontend/src/api/types.ts`.

**How:**

```ts
export interface PublishStepStatus { name: string; status: 'ok' | 'fail'; message?: string; code?: string; details?: Record<string, boolean>; }
export interface AgentRecipe { version: 1; displayName: string; description: string; instructions: string; model: string; tools: string[]; dataStore: string | null; knowledgeFiles: unknown[]; source: { registryGemId: string; instructionHash: string }; _warnings: string[]; _unmappedTools: string[]; _attachManually: unknown[]; }
export interface Publication { id: string; gemId: string; publishedBy: string; targetProjectId: string; targetRegion: string; targetEngineId: string; agentResourceName: string | null; dataStoreResourceName: string | null; instructionHashAtPublish: string; model: string | null; status: 'pending'|'recipe_ready'|'completed'|'failed'|'superseded'; steps: PublishStepStatus[]; recipe: AgentRecipe | null; errorMessage: string | null; createdAt: string; updatedAt: string; }

export async function publishGem(gemId: string): Promise<Publication> { … }
export async function listPublications(gemId: string): Promise<{ publications: Publication[] }> { … }
export async function completePublication(publicationId: string, agentResourceName: string): Promise<Publication> { … }
```

#### 2.7 Publish modal component

**What:** The three-state modal from spec §5.3, scoped to Phase 2 (no "include knowledge" checkbox yet).

**Where:** `frontend/src/components/PublishModal.tsx` (new file).

**How:** 

- Prop: `{ gemId: string; open: boolean; onClose: () => void }`.
- State machine: `'confirm' → 'running' → 'recipe_ready' | 'failed'`. (`running` is visible while `publishGem` is in flight; no real-time step streaming in Phase 2 — the server returns the full `steps[]` at once.)
- `confirm` state: short "You are about to publish `<gemName>` to project `<projectId>` in region `<region>`." + Publish button + Cancel.
- `running` state: spinner + "Validating connection, generating recipe…"
- `recipe_ready` state: show the recipe JSON in a `<pre>` block with a "Copy recipe" button (reuse the same clipboard pattern as `GemDetail.tsx:142–149`), plus a **Deep link** button opening `https://console.cloud.google.com/gemini/enterprise/engines/<engineId>/agents/new?project=<projectId>` in a new tab. Below it, a textbox: "After creating the agent, paste its resource name here (`projects/.../agents/...`)" and a **Mark as completed** button calling `completePublication`.
- `failed` state: show the `steps[]` with per-step status and error messages; a "Close" button.

#### 2.8 GemDetail wiring

**What:** Add the **Publish to Gemini Enterprise** button and the publication-status badge + history.

**Where:** `frontend/src/pages/GemDetail.tsx`.

**How:**

- Near the existing action buttons (around line 137 where "Copy Instructions" lives), add a **Publish to Gemini Enterprise** button. Disabled states:
  - `!isOwner` → hidden.
  - Enterprise settings not configured → show button but disabled with tooltip "Admin must configure enterprise settings first."
  - Dev-bypass mode (`!VITE_GOOGLE_CLIENT_ID`) → hidden entirely per spec §7.
- On click, open `<PublishModal gemId={gem.id} open={…} onClose={…} />`.
- After modal closes, re-fetch publications via `listPublications` and update the local state.
- Below the Tools section (spec §5.1), render a **Publication history** collapsible. Show each record: `createdAt`, status badge, agent resource name (as a link if present), "Drifted" badge if `instructionHashAtPublish !== gem.instructionHash`.
- Add a top-right status badge next to the existing `status` badge: "Never published" / "Recipe ready" / "Published" / "Drifted", derived from the most recent non-superseded publication.

Compute whether settings are configured by calling a new lightweight endpoint **only if needed** — cheapest path is: include a boolean `enterpriseConfigured` field in `GET /api/users/me` so the SPA knows without an extra round-trip. Add it in `server/routes/users.js:10` by reading `enterpriseSettings.getSettings(pool)` and returning `enterpriseConfigured: !!(settings?.project_id && settings?.engine_id && settings?.impersonation_sa_email)`.

#### 2.9 Phase 2 verification gate

1. Run migration 004 (restart API).
2. As the owner of a real gem with meaningful instructions, click **Publish to Gemini Enterprise**.
3. Confirm the modal transitions: `confirm → running → recipe_ready`. The recipe should contain the gem's instructions verbatim (after normalization) and the correct `displayName` and `description`.
4. Click the deep link; the Agent Designer "new agent" page opens in the sandbox GE project.
5. Paste the recipe's `instructions` into the Agent Designer system-prompt box, copy `displayName` into the name field, pick the configured model, click Save in Agent Designer.
6. Copy the resulting agent resource name (from the Agent Designer URL or settings) back into the SPA modal, click **Mark as completed**.
7. Reload `GemDetail`:
   - Publication history shows one row, `status='completed'`.
   - Top badge reads "Published" and links to the agent.
8. Immediately re-publish the same gem:
   - The previous row transitions to `superseded`.
   - A new `recipe_ready` row appears.
9. Edit the gem (change instructions) → reload → badge reads "Drifted."
10. Test the failure path: temporarily break the engine ID in settings → click Publish → modal lands in `failed` state with a clear error step. Restore the engine ID.

---

### Phase 3 — Knowledge files and tools

Goal: recipe now includes the gem's `default_tools` (mapped to GE built-ins) and its Drive-captured `knowledge_files`, with an optional path to automatically create a Discovery Engine data store in the customer's project and ingest the files into it.

#### 3.1 Tool mapping table

**What:** Deterministic map from extension tool strings to GE built-in tool identifiers.

**Where:** `server/services/agentRecipe.js` (add to existing file from Phase 2).

**How:** Per spec §4.3.1. A plain `const TOOL_MAP` object and a `mapTool(raw)` function returning `{ tool, builtin, warning? }`. During recipe generation, iterate `gem.default_tools`, call `mapTool`, push known tools into `recipe.tools` and unknowns into `recipe._unmappedTools`. Add unit tests for known, unknown, and empty cases.

Before freezing the exact identifier strings, the implementer should perform a one-time reconnaissance: create one of each tool type in the sandbox Agent Designer and inspect the resulting agent via `agents.list` to discover the canonical strings. Update `TOOL_MAP` accordingly before merging.

#### 3.2 Drive OAuth scope

**What:** Request `drive.readonly` on sign-in so the server can later fetch Drive files using the user's access token.

**Where:**
- `frontend/src/auth/AuthProvider.tsx` — the GIS client currently uses `google.accounts.id` (ID tokens only). For Drive, we need an OAuth **access token**, not an ID token. Add a separate `google.accounts.oauth2.initTokenClient({ client_id, scope: 'https://www.googleapis.com/auth/drive.readonly', callback })` flow that runs *only when the user clicks Publish and opted to include knowledge files* — avoids prompting the user for Drive access at sign-in time.
- `frontend/src/api/publish.ts` — `publishGem` accepts an optional `driveAccessToken` parameter passed as a header `X-Drive-Access-Token`.
- `server/routes/publish.js` — reads the header; passes to the orchestrator. Never persists it; uses it once per call.

**Why:** Requesting `drive.readonly` at sign-in would add a high-friction consent screen to every user, most of whom never publish. Lazy-requesting on publish keeps the base sign-in experience unchanged.

#### 3.3 Knowledge ingestion service

**What:** Given a list of gem `knowledge_files` with Drive IDs, create/reuse a data store and import the files.

**Where:** `server/services/knowledgeIngest.js` (new file).

**How:** Export `async function ingestKnowledge({ gcpFetch, settings, gem, driveAccessToken })`. Steps:

1. **Ensure staging bucket** — GET on `storage.googleapis.com/storage/v1/b/{bucket}`; 404 → create (call `POST storage/v1/b?project={project}` with `{ name, location }`). The bucket name is `settings.drive_staging_bucket`; fail with a clear error if unset.
2. **Ensure data store** — name is deterministic: `gem-factory-knowledge`. `GET` the data store; 404 → `POST dataStores.create` with `contentConfig: 'CONTENT_REQUIRED'`, `industryVertical: 'GENERIC'`.
3. **Attach data store to engine** — `POST engines.{engine}:addDataStores` (check exact RPC name against current GE API docs — alternatively, data stores attach at engine-creation time and manual attachment is a console-only action; in that case, surface a "please attach in console" warning in the recipe).
4. **For each knowledge file with `driveId`:**
   - Use `driveAccessToken` to call `https://www.googleapis.com/drive/v3/files/{driveId}/export?mimeType=application/pdf` (for Google-native formats) or `/drive/v3/files/{driveId}?alt=media` (for binary formats). Distinguish via the stored `mimeType`.
   - Stream the response body into a GCS object under `gs://{bucket}/gem-{gem.id}/{driveId}`.
   - Record the GCS URI.
5. **Batch `documents.import`** — `POST dataStores/{ds}/branches/default_branch/documents:import` with `gcsSource.inputUris = [...]`. Returns an LRO name.
6. **Poll LRO** — `GET operations/{name}` with backoff (1s, 2s, 4s… capped at 30s intervals, total timeout 120s). If not done by timeout, return `partial: true` with the LRO name in the publication row so a subsequent status check can resolve it.

Return `{ dataStoreName, importOperation, imported: [...], skipped: [...], warnings: [...] }`.

#### 3.4 Extend publish orchestrator

**What:** Wire tool-mapping and optional knowledge ingestion into `publish.js` from Phase 2.

**Where:** `server/services/publish.js`.

**How:**

- Accept `{ includeKnowledge: boolean, driveAccessToken: string | null }` in the options object.
- After step 6 (engine resolved), if `includeKnowledge` and the gem has at least one `knowledge_file` with a `driveId`:
  - Call `knowledgeIngest.ingestKnowledge(…)`.
  - On error, add a step `{ name: 'knowledge_ingest', status: 'fail', message, code }` but **do not abort** — continue to recipe generation with `_warnings` populated.
  - On success, pass the `dataStoreName` to the recipe generator.
- `agentRecipe.toRecipe` now accepts `{ preferredModel, dataStoreName }` and emits:
  - `tools: [...mappedTools]`
  - `dataStore: dataStoreName`
  - `knowledgeFiles: [ { name, driveUrl, driveId, gcsUri? } ]`
  - `_attachManually: [ { name } ]` for files without a `driveId`.

#### 3.5 Publish modal — Phase 3 additions

**What:** Add the "Include knowledge files" checkbox and tool-mapping preview.

**Where:** `frontend/src/components/PublishModal.tsx`.

**How:**

- In `confirm` state: checkbox "Include knowledge files" (default on if gem has files with `driveId`, disabled and unchecked otherwise with tooltip "No Drive URLs captured for this gem").
- Read-only tool mapping preview: for each `gem.defaultTools[]`, render a row "`{raw}` → `{mapped or '(no mapping)'}`".
- When the checkbox is on, the Publish flow first triggers the Drive OAuth token flow (`google.accounts.oauth2.initTokenClient(...).requestAccessToken()`) and waits for the access token before calling the API.
- `recipe_ready` state: also show the data store resource name if present, and any knowledge-ingest warnings.

#### 3.6 Phase 3 verification gate

1. Pick a gem that has ≥2 knowledge files with real Drive URLs captured (use the extension to populate one if needed).
2. Click Publish, confirm the tool mapping preview is correct, leave knowledge checkbox on.
3. OAuth consent prompt appears requesting `drive.readonly`; approve.
4. Modal transitions through `running` → `recipe_ready`.
5. In the GCS console, confirm the staging bucket contains the files under `gem-{gemId}/`.
6. In the GE console, confirm the `gem-factory-knowledge` data store exists and lists the ingested documents.
7. Paste the recipe into Agent Designer; in the "Data sources" picker, select `gem-factory-knowledge`; select the mapped tools; save.
8. Mark complete in the SPA.
9. Ask the resulting agent a question that can only be answered from a knowledge file; verify grounded response.
10. Regression: re-run Phase 2 verification on a gem with no knowledge files — must still work as before.

---

## 4. Data Model / Schema Changes

| File | Introduced in | Purpose |
|---|---|---|
| `server/db/migrations/003_add_enterprise_settings.sql` | Phase 1 | Single-row `org_enterprise_settings` table. |
| `server/db/migrations/004_add_gem_publications.sql` | Phase 2 | `gem_publications` + indexes (per spec §4.6). |

No changes to `gems`, `users`, or existing tables. No changes to the extension or the chrome-extension manifest.

New TypeScript types (in `frontend/src/api/types.ts`):

- `EnterpriseSettings` (Phase 1)
- `ConnectionTestResult`, `PublishStepStatus` (Phase 1)
- `AgentRecipe`, `Publication` (Phase 2)

No changes to existing types. No changes to `GemListResponse`, `ImportResult`, etc.

## 5. Integration Points

- **Auth middleware** (`server/middleware/auth.js`) is unchanged. New routes inherit auth because they live under `/api`.
- **Admin gating** uses the existing `requireAdmin` from `server/middleware/admin.js`.
- **Header nav** gets one new admin-only link (Phase 1, step 1.9).
- **Router** (`frontend/src/App.tsx`) gets one new protected route.
- **Docker Compose** uncomments the existing ADC volume mount (Phase 1, step 1.10).
- **Existing endpoints** — only `GET /api/users/me` gains a new `enterpriseConfigured: boolean` field (Phase 2, step 2.8). Everything else is additive.
- **Extension is untouched.** Nothing in `extension/` needs to change for any phase.

## 6. Edge Cases & Risks

| Risk | Phase | Mitigation |
|---|---|---|
| ADC mount missing on the developer's machine | 1 | Connection test fails cleanly with a friendly message; README/CLAUDE.md note to run `gcloud auth application-default login`. Do not silently fall back. |
| Admin lists the wrong engine ID | 1 | `engine_reachable` step returns 404 with a message naming the resource path that was probed, so the admin can spot the typo immediately. |
| Impersonation chain works for probe but fails later on a specific API | 1–3 | Every GCP call goes through `parseGcpError` and produces `{ code, message }` in the step output — never swallow errors. |
| Agent Designer's internal identifier strings differ from our assumptions | 3 | Before locking `TOOL_MAP` and the deep-link URL template, run the one-time reconnaissance against the sandbox described in §3.1. Document findings in a comment at the top of `agentRecipe.js`. |
| `documents.import` LRO exceeds 120s | 3 | Return `partial: true`; include the LRO name in the publication row; a future `GET /api/publications/:id` resolves it. For v1, surfacing "import still running — refresh in a minute" in the modal is acceptable. |
| Drive file too large or not accessible | 3 | Per-file try/catch; failures go into `_warnings` on the recipe with the file name and the error code. Other files still import. |
| Concurrent publishes of the same gem (user double-clicks) | 2 | Advisory lock in the orchestrator (step 2.4). Second call returns 409 "Publish already in progress." |
| Dev-bypass mode tries to publish | 2 | Publish button is hidden in the UI; the server-side orchestrator additionally rejects with a clear error (check for the absence of a real `req.user.hd`/non-`dev@localhost` email). |
| Recipe JSON gets very large | 2–3 | Cap recipe size at 256KB before insert; truncate instructions with a warning before rather than failing the INSERT. |
| `instruction_hash_at_publish` mismatch surprises users | 2 | "Drifted" badge + tooltip explaining what it means and that re-publish resolves it. |
| Multi-tenant assumption leak | All | `org_enterprise_settings` is keyed to `id = 1`. Leave a comment in the migration about how to un-constrain this when multi-tenancy is added. |
| User revokes Drive consent between attempts | 3 | OAuth flow runs anew on each publish; a stale `driveAccessToken` surfaces as a 401 from Drive, producing a clear "Drive access required" error in the `knowledge_ingest` step. |

## 7. Verification

Each phase has a verification gate (sections 1.11, 2.9, 3.6 above). In addition, add these automated tests:

- `server/test/agentRecipe.test.js` — Phase 2 creation, Phase 3 extension. Cover every branch of `mapTool`, every shape of input (with/without description, with/without knowledge files, with/without mappable tools).
- `server/test/enterpriseSettings.test.js` — Phase 1. Validates `putSettings` rejects non-admins (via the route layer with a mocked `req.user`) and that `getSettings` returns defaults when no row exists.
- `server/test/publish.test.js` — Phase 2. Mock `gcpFetch` to return canned responses for each step; assert orchestrator writes the expected `steps_jsonb` on success, failure, and partial-success paths. Assert advisory lock prevents concurrent runs.

Run them via the existing `make api-test` target (which uses Node's built-in test runner per `CLAUDE.md`).

Acceptance criteria from spec §9 that map to this plan:

- Admin can configure and test connection (Phase 1.11).
- Owner can publish a simple gem and get a deterministic recipe (Phase 2.9 steps 2–6).
- Gem with knowledge files produces a data store with ingested files (Phase 3.6 steps 5–6).
- `gem_publications` audit row exists for every attempt (all phases).
- Re-publishing supersedes prior non-completed rows (Phase 2.9 step 8).
- All new routes enforce owner-or-admin ACLs (test suite + manual).
- Dev-bypass hides the feature (Phase 2 step 2.8 + manual test).

## 8. Open Questions

1. **Add a `drive.readonly` scope to the base sign-in flow, or request it lazily on publish?** Plan currently chooses lazy (§3.2). This changes the answer if we later add other Drive features.
2. **Should we auto-create the GCS staging bucket** if the admin leaves the field blank, or hard-require it in settings? Current plan: hard-require; surface the field in Phase 1 already (marked "Phase 3 only") so admins fill it proactively.
3. **`addDataStores` on an engine** — does the current GE API expose this RPC, or is attaching a data store to an app a console-only operation? Needs verification during Phase 3 implementation; falls back to recipe-instructs-admin if the API doesn't support it (§3.3 step 3).
4. **Phase 2 deep-link URL** — `console.cloud.google.com/gemini/enterprise/engines/{engine}/agents/new` is inferred from spec §10.7. Confirm the exact path by inspecting the browser URL when clicking "Create agent" in the sandbox before shipping.
5. **Model allowlist for the Settings page dropdown** — hard-code for now (`gemini-3-pro-preview`, `gemini-3-flash-preview`, `gemini-2.5-pro`)? Or fetch dynamically? Static is simpler; revisit if Google's model cadence makes it stale quickly.
6. **Phase 2 streaming vs. batched step results** — plan ships batched (server returns all steps at once). Do we need SSE/WebSocket streaming for Phase 3's long-running ingestion, or is the "partial: true + refresh" pattern good enough?
7. **Placement of settings-configured check** — added to `GET /api/users/me` per §2.8. Alternative: dedicated `GET /api/settings/enterprise/status` endpoint that works for non-admin owners too without leaking settings content. Worth reconsidering if the `/me` response grows unwieldy.
