---
type: spec
title: "Publish Gems to Gemini Enterprise"
scope: End-to-end feature for promoting a captured gem in the Schnucks Gem Registry into an agent in a customer's Gemini Enterprise instance, including credentials model, API integration path, knowledge-file handling, and UI surface in the SPA
date: 2026-04-16
---

## 1. Problem Statement

The Schnucks Gem Registry has successfully become a central catalog of Google Gemini gem configurations (`name`, `description`, `instructions`, `default_tools`, `knowledge_files` with Drive references). Today that catalog is read-only — users can search, dedupe, and review gems, but there is no path to promote a gem out of the public Gemini consumer surface into their company's controlled **Gemini Enterprise (GE)** environment.

This matters because:

- **Personal gems live in consumer Gemini**, outside corporate governance. Prompts and knowledge attached to them cannot benefit from GE's secure data connectors, Model Armor safety layer, audit logs, or per-seat licensing.
- **Valuable prompt craft is stranded.** A useful gem that a marketing analyst built on the consumer side can't be shared back to the company as a first-class agent without being manually rebuilt inside GE's "Agent Designer."
- **Rebuilding by hand is error-prone and high-friction** — copy/paste the instructions, re-enumerate the tools, re-upload or re-attach each knowledge file, pick a model, and hope nothing got lost in translation.

The gap is the "last mile": we have the data; we need a durable path to create an equivalent agent in GE from that data.

## 2. Goals & Non-Goals

### Goals

1. Add a **"Publish to Gemini Enterprise"** action on the gem detail page (`frontend/src/pages/GemDetail.tsx`) that converts a registry gem into an agent inside a customer-controlled GE instance.
2. Support a **multi-tenant credentials model** where a customer admin configures their GCP project, region, GE app ID, and a trust relationship that lets our SaaS act on their behalf — without us holding long-lived key material.
3. Map each gem field (`name`, `description`, `instructions`, `default_tools`, `knowledge_files`) onto the closest equivalent in GE's agent model, and be explicit about which fields translate cleanly, which approximate, and which are dropped.
4. Produce an **auditable publish record** in our database: which gem, which GE project, which agent resource name, who published, when, and the outcome.
5. Handle **partial-success** gracefully — e.g. agent created but knowledge ingestion failed — with clear per-step status and retry affordance.
6. Make the feature **feasibility-honest**: where GE's API has known gaps in April 2026 (see §4.1), the UI and the server behavior must not pretend otherwise.

### Non-Goals

- **Editing a published GE agent from our SPA.** Once published, ongoing management happens in the GE console.
- **Two-way sync.** Changes to the gem here do not propagate to the published agent, and vice versa. A re-publish is an explicit user action.
- **Creating agents inside the Agent Designer product itself via API.** As of April 2026 there is no public API for this (see §4.1); we will not reverse-engineer the internal one.
- **Mass bulk publish UI.** The first iteration is one-gem-at-a-time. Bulk is a later milestone (§8).
- **Drive file discovery or re-crawl.** We use the `driveId` / `driveUrl` already captured by the extension; we do not search Drive for additional files.
- **Custom tool creation.** Tool support in v1 is limited to mapping the `default_tools` strings the extension captures onto GE's built-in tool catalog. Authoring OpenAPI tools is out of scope.
- **Billing, seat management, or license provisioning in GE.** The customer is expected to already have a GE subscription.

## 3. Proposed Solution

### 3.1 High-level shape

A new server-side module (`server/services/publish.js`) orchestrates a multi-step publish operation against the customer's GCP project using **Application Default Credentials + service-account impersonation**. The SPA exposes a single **"Publish to Gemini Enterprise"** button on `GemDetail.tsx` that opens a modal collecting any per-publish choices (target app ID, model, whether to ingest knowledge files), then hits a new `POST /api/gems/:id/publish` endpoint and streams the step-by-step result back.

A new `gem_publications` table records every attempt (success or failure) so the UI can show a **"Published"** badge on the gem detail page, link to the GE agent resource, and surface the publish history.

### 3.2 Why this approach over alternatives

The core research finding (see §4.1 and the "Feasibility notes" appendix) is that **Agent Designer itself has no public creation API.** That leaves three realistic paths:

| Path | What it delivers | Cost | Verdict |
|------|------------------|------|---------|
| **A. Register via ADK / Agent Engine** | Convert gem → ADK Python agent → deploy to Vertex AI Agent Engine (`reasoningEngines.create`) → register with GE (`agents.create` on `discoveryengine.googleapis.com/v1alpha`). Agent shows up in the customer's Agent Gallery. | High: per-agent container build + deploy; ADK code generation; users **cannot edit in Agent Designer**. | **v2+.** Right long-term path, too expensive for v1. |
| **B. Register as A2A agent** | Host execution on our infrastructure, expose Agent-to-Agent protocol, register URL with GE. | Medium: we permanently own runtime for every published gem. Shifts cost and auth to us. | Not right for "promote gems into customer's enterprise" — gems should run inside the customer's tenant. |
| **C. Export-and-import (v1)** | Produce a structured, well-formatted "GE agent recipe" from the gem and guide the customer through pasting it into Agent Designer. Optionally auto-create the app-level Google Drive data store and any app-scoped setup we *can* do via API. | Low: no runtime, no per-agent deployment. Honest about April-2026 API limits. | **Ship this first.** |

**v1 ships Path C with an automated assist layer.** We use API access where it exists (creating data stores, registering the customer's Drive folder, enabling required APIs, writing the publish record), and we produce a deterministic, copy-paste-ready agent recipe for the one step that has no API (Agent Designer itself). **v2 adds Path A** behind a feature flag for customers who want fully-programmatic creation and accept the Agent-Designer-uneditable tradeoff.

### 3.3 User-facing workflow (v1)

1. User opens a gem on `/gems/:id`.
2. If the user is the owner, a new **"Publish to Gemini Enterprise"** button appears next to the existing "Copy Instructions" / "Delete" actions.
3. Clicking it opens a modal:
   - **Target:** pre-populated from the customer's GE connection settings (configured once by an admin — see §5.2).
   - **Model:** dropdown — default to the org's preferred Gemini model.
   - **Include knowledge files:** checkbox, defaults on if the gem has `knowledge_files` with `driveId` populated.
   - **Tool mapping preview:** read-only, showing how each `default_tools` entry maps onto GE built-in tools (see §4.3).
4. User clicks **Publish**. The SPA calls `POST /api/gems/:id/publish`. The server runs the orchestration (§4.4) and streams step-status back.
5. On success the modal shows:
   - The recipe JSON to paste into Agent Designer (with a "Copy" button), OR a deep link into the customer's Agent Designer pre-filled via query params where possible.
   - The data-store resource name (if one was created for knowledge files).
   - A link to the published record.
6. On partial failure the modal shows which steps succeeded and offers **Retry failed steps**.

## 4. Technical Design

### 4.1 Feasibility constraint driving the design

The `discoveryengine.googleapis.com/v1alpha` **Agent resource does exist** and supports `agents.create`, but only for agents whose definition is one of: `adkAgentDefinition`, `dialogflowAgentDefinition`, or `a2aAgentDefinition`. **There is no field for inline instructions, inline tools, or inline knowledge** — those must be encapsulated in a backing ADK/Dialogflow/A2A agent created outside GE.

Additionally, the GE **Google Drive connector cannot be operated by a service account** — it requires a human Workspace admin signed into the Cloud Console for the account owning the Drive files. This is explicit in Google's docs: *"Searching using service account credentials isn't supported for Google Workspace data stores."*

Both constraints are load-bearing for the design. v1 therefore treats the Agent Designer creation and the Drive-connector setup as **human-in-the-loop steps** with machine-generated recipes, and uses API calls only where they work reliably (data store creation with `CONTENT_REQUIRED` config, document import from GCS, API enablement, and writing our own audit records).

See the appendix at the end of this doc for citations and the full research trail.

### 4.2 Components

#### New server files

- `server/services/publish.js` — orchestrator. Accepts `{ gemId, options }`, returns a `PublishResult` with per-step status.
- `server/services/gemini_enterprise.js` — thin client over `discoveryengine.googleapis.com` and `serviceusage.googleapis.com`. Uses `google-auth-library`'s `GoogleAuth` with target-principal impersonation.
- `server/services/agent_recipe.js` — pure function that transforms a `Gem` row into a GE-compatible agent recipe JSON (see §4.5).
- `server/routes/publish.js` — mounts `POST /api/gems/:id/publish`, `GET /api/gems/:id/publications`, and `GET /api/publications/:id`.
- `server/db/publications.js` — repository for the new `gem_publications` table.
- `server/db/migrations/003_add_gem_publications.sql` — schema migration (see §4.6).

#### Modified server files

- `server/server.js` — mount the new publish router.
- `server/package.json` — add `google-auth-library` (already present per `CLAUDE.md`) and add `googleapis` (REST helper) **only if needed** — prefer hand-rolled `fetch` calls against documented REST endpoints to keep the dependency footprint small, matching the project's existing style in `server/middleware/auth.js`.

#### New frontend files

- `frontend/src/pages/GemDetail.tsx` — add a **"Publish to Gemini Enterprise"** button near the existing "Copy Instructions" button (currently at `GemDetail.tsx:137–151` for Copy, `210–221` for Delete).
- `frontend/src/components/PublishModal.tsx` — the modal described in §3.3.
- `frontend/src/api/publish.ts` — typed client: `publishGem(gemId, options)`, `listPublications(gemId)`.
- `frontend/src/api/types.ts` — add `PublishResult`, `PublicationRecord`, `PublishStepStatus` types.

#### New page (admin-only)

- `frontend/src/pages/EnterpriseSettings.tsx` — form for configuring the customer's GE connection (project ID, region, app/engine ID, impersonation target service account, preferred model). Admin-only, reached from the header nav. Persists to a new `org_settings` table (or reuses a single-row settings table if one is later introduced).

### 4.3 Gem-to-GE field mapping

| Gem field (DB / TS) | Maps to | Confidence | Notes |
|---|---|---|---|
| `name` | Agent Designer `displayName` | **High** | Direct copy, trimmed to GE's max length (see §7). |
| `description` | Agent Designer `description` | **High** | If null, synthesize a one-liner from the first sentence of `instructions`. |
| `instructions` | Agent Designer `instructions` (system prompt) | **High** | Copied verbatim after `server/services/ingestion.js`-style normalization. GE has its own max-length bound we must truncate to; currently undocumented, so we log a warning when >100KB as a canary. |
| `icon` | Agent Designer `icon.uri` | **Medium** | The extension stores `icon` as a URL or possibly a data URI; GE wants a URI it can fetch. If `icon` is a data URI we skip it (no upload path in v1). |
| `default_tools[]` | Agent Designer tool selection | **Medium** | Deterministic string-to-enum mapping table (see §4.3.1). Anything unmapped is surfaced as a warning in the publish result and listed in the recipe's `_unmappedTools` diagnostic field. |
| `knowledge_files[]` (with `driveId`) | A Discovery Engine **data store** attached at the **app (engine) level** | **Medium — see §4.4** | Created via API if the customer authorizes our SA to call `dataStores.create` with `contentConfig: CONTENT_REQUIRED`, then `documents.import` from a GCS staging bucket after we fetch the Drive files using the user's own OAuth token. |
| `knowledge_files[]` (no `driveId`) | Listed in recipe as *"attach manually"* items | **Low** | The extension only captures file names if Drive URLs weren't captured. We cannot re-resolve these server-side; user must attach manually. |
| `gemini_id` | Stored in `gem_publications.source_gemini_id` | n/a | Audit only. |
| `instruction_hash` | Stored in `gem_publications.instruction_hash_at_publish` | n/a | Lets us detect drift between the published version and the current gem. |

#### 4.3.1 Tool mapping table

`default_tools` comes from the extension as strings scraped from the UI (e.g. `"Google Search"`, `"Code interpreter"`, `"Image generation"`). The canonical mapping table lives in `server/services/agent_recipe.js` as a typed constant so it's inspectable:

```
"Google Search"      → { tool: "search_grounding", builtin: true }
"Code interpreter"   → { tool: "code_execution",   builtin: true }
"Image generation"   → { tool: "image_generation", builtin: true }
"Google Workspace"   → { tool: "workspace_tools",  builtin: true, requiresAuthConfig: true }
(unknown)            → { tool: null, warning: "Tool not recognized: <raw>" }
```

The exact GE identifier strings will be finalized at implementation time by inspecting the GE API response for an existing reference agent in the test project.

### 4.4 Publish orchestration (the happy path)

`publish.js` runs these steps in order. Each step writes a row-level status update to `gem_publications.steps_jsonb`. Steps 1–5 are machine-executable today; step 6 is recipe-generation; step 7 is the human hand-off.

1. **Validate connection.** Confirm the org's stored GE settings exist and the impersonation target service account is reachable (`iam.serviceAccounts.get`).
2. **Ensure APIs enabled.** `discoveryengine.googleapis.com`, `aiplatform.googleapis.com` via `serviceusage.services.enable`. Idempotent.
3. **Resolve target app (engine).** `engines.get` on the configured engine ID. Fail fast with a clear error if not found.
4. **Optionally create / reuse knowledge data store.** If `options.includeKnowledge && gem.knowledge_files.some(f => f.driveId)`:
   - **Path chosen for v1: custom data store with user-provided content.** Create (or reuse) a `GenericDataStore` with `contentConfig: CONTENT_REQUIRED` named `gem-factory-knowledge` at app scope.
   - For each knowledge file with a `driveId`: fetch from Drive using **the end user's OAuth credentials** (captured via a new `drive.readonly` scope on sign-in — see §6.3), stream to a temporary GCS staging bucket in the customer's project, then `documents.import` with `gcsSource` pointing at it.
   - If `inline-only` variant: embed file contents directly into the `documents.import` call as `inlineSource` (fine for small text files, not fine for Docs/Sheets/PDFs above a few MB).
5. **Write `gem_publications` row** with `status='recipe_ready'`, `data_store_name`, `instruction_hash_at_publish`, etc.
6. **Generate recipe JSON** via `agent_recipe.toRecipe(gem, options, dataStoreName)`. Shape:
   ```json
   {
     "version": 1,
     "displayName": "...",
     "description": "...",
     "instructions": "...",
     "model": "gemini-3-pro-preview",
     "tools": ["search_grounding", "code_execution"],
     "dataStore": "projects/.../dataStores/gem-factory-knowledge",
     "knowledgeFiles": [ { "name": "...", "driveUrl": "...", "driveId": "..." } ],
     "source": { "registryGemId": "...", "instructionHash": "..." },
     "_unmappedTools": [],
     "_warnings": []
   }
   ```
7. **Return to client** with `status='recipe_ready'`, the recipe, and the deep link to Agent Designer (`https://console.cloud.google.com/gemini/enterprise/engines/<engineId>/agents/new?project=<projectId>`). The user pastes the recipe into Agent Designer's "Instructions" box and selects the matching tools/data store.
8. (Optional) When the user manually completes the Agent Designer step, they can come back and paste the resulting agent resource name into the publish record via a small form. `status` updates to `'completed'`. This is how we close the loop for audit purposes without automating the un-automatable step.

### 4.5 `agent_recipe.js` pure function

Signature:

```
toRecipe(gem: Gem, options: PublishOptions, dataStoreName: string | null): AgentRecipe
```

Key normalization rules (mirrors `server/services/ingestion.js`):

- Collapse Windows line endings, clamp 3+ blank lines.
- Strip the extension's debug markers if present (none known today; forward-compatible).
- Filter `knowledge_files` entries that don't have a `driveId` into `_attachManually`.
- Map `default_tools` via the table above; unknowns into `_unmappedTools`.
- Never include the raw `icon` if it's a `data:` URI.

This function must be **pure and unit-testable** against fixtures in `server/test/agent_recipe.test.js`.

### 4.6 Schema additions

`server/db/migrations/003_add_gem_publications.sql`:

```sql
CREATE TABLE gem_publications (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gem_id                      UUID NOT NULL REFERENCES gems(id) ON DELETE CASCADE,
  published_by                UUID NOT NULL REFERENCES users(id),
  target_project_id           TEXT NOT NULL,
  target_region               TEXT NOT NULL,
  target_engine_id            TEXT NOT NULL,
  agent_resource_name         TEXT,              -- e.g. projects/.../agents/{id}, nullable until confirmed
  data_store_resource_name    TEXT,              -- nullable
  instruction_hash_at_publish TEXT NOT NULL,
  model                       TEXT,
  status                      TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','recipe_ready','completed','failed','superseded')),
  steps_jsonb                 JSONB NOT NULL DEFAULT '[]'::jsonb,
  recipe_jsonb                JSONB,
  error_message               TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_publications_gem ON gem_publications (gem_id);
CREATE INDEX idx_publications_user ON gem_publications (published_by);

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

Single-row `org_enterprise_settings` is acceptable for v1 because the app is deployed per-customer; if we later go multi-tenant, this becomes a per-tenant row keyed on tenant id.

### 4.7 API surface additions

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/gems/:id/publish` | Owner or admin | Kick off publish; returns `PublishResult` with recipe. |
| `GET` | `/api/gems/:id/publications` | Owner or admin | List past publish attempts. |
| `GET` | `/api/publications/:id` | Owner or admin | Get a single publish record. |
| `POST` | `/api/publications/:id/complete` | Owner or admin | Record the final `agent_resource_name` once the user has pasted into Agent Designer. |
| `GET` | `/api/settings/enterprise` | Admin | Read org GE settings. |
| `PUT` | `/api/settings/enterprise` | Admin | Update org GE settings. |

All follow the existing `routes/gems.js` response-shaping style (see `formatGem` at `server/routes/gems.js`).

## 5. UI / UX

### 5.1 Gem detail page additions (`frontend/src/pages/GemDetail.tsx`)

- **"Publish to Gemini Enterprise"** button in the action row alongside "Copy Instructions". Disabled state with tooltip when GE settings are not configured or when the user isn't the owner.
- **Publication status badge** below the name/status row: "Published" / "Recipe ready" / "Never published" / "Drifted" (latter when `instruction_hash_at_publish` differs from current `instruction_hash`).
- **Publication history collapsible section** below the Tools section listing prior attempts with their `created_at`, `status`, and a link to the GE console agent (if `agent_resource_name` is set).

### 5.2 Enterprise Settings page

A new admin-only page at `/settings/enterprise`:

- Project ID
- Region
- Engine (app) ID — with a "Test connection" button that calls `engines.get`.
- Impersonation service-account email — with inline instructions on what roles it needs (copy-to-clipboard `gcloud` commands generated live, scoped to the configured project ID).
- Preferred model (dropdown, populated from a small hardcoded list for v1).
- GCS staging bucket (optional — only if `includeKnowledge` will be used; with a "Create bucket" helper button).

Form validation runs against the live project on submit; errors surface inline.

### 5.3 Publish modal

Three visual states:

1. **Form state** — pre-publish inputs (§3.3 step 3).
2. **Running state** — ordered step list (§4.4) with per-step spinners / checkmarks / error rows. Cancel is best-effort.
3. **Result state** — recipe JSON in a copy-enabled code block, a deep link button to Agent Designer, and a "Paste agent resource name" textbox for closing the loop (§4.4 step 8).

Keyboard: `Esc` closes the modal (with a confirmation if a run is in flight).

## 6. Integration Points

### 6.1 Existing auth middleware

Reuses `server/middleware/auth.js` unchanged. The new routes all require authentication. Owner-or-admin ACLs mirror the existing `gems.js` pattern (see `server/routes/gems.js:80–97`, `:133–152`).

### 6.2 Google Cloud credentials

- **Server-to-GCP calls** use Application Default Credentials via `google-auth-library`. `docker-compose.yml` already has a commented-out ADC volume mount (`~/.config/gcloud`); this feature requires uncommenting it locally, as documented in `docs/specs/authentication-authorization-SPEC.md` §3.4.
- **Target-principal impersonation** is the multi-tenant model: the customer's admin grants our runtime service account `roles/iam.serviceAccountTokenCreator` on a service account they own, which itself has the GE roles (see §6.4). We impersonate per request via `GoogleAuth({ clientOptions: { subject: impersonation_sa_email } })` (or the `Impersonated` auth client). No key material ever touches our disk.
- **Production (Cloud Run)** inherits the runtime service account from the Cloud Run service definition.

### 6.3 Drive OAuth scope (end-user)

To ingest knowledge files via Path C's data store option (§4.4 step 4), the SPA must request `https://www.googleapis.com/auth/drive.readonly` **in addition to the existing identity scopes**. This is a **user-visible consent prompt change** and must be added to the Google Sign-In flow in `frontend/src/auth/AuthProvider.tsx`. The server accepts the access token from the SPA as a header on the publish request (do not persist it server-side — use it once per publish and discard).

If the user declines Drive scope, the publish proceeds with knowledge files listed as "attach manually" and no data store is created.

### 6.4 IAM roles the customer must provision

On the impersonation service account, in the target project:

- `roles/discoveryengine.admin` (or the branded `roles/discoveryengine.agentspaceAdmin` — both work; the former is broader)
- `roles/serviceusage.serviceUsageAdmin` (for the one-time API enablement)
- `roles/storage.objectAdmin` on the staging bucket (if knowledge ingestion is enabled)
- `roles/iam.serviceAccountTokenCreator` granted to our runtime SA on this impersonation SA

On the customer's GE app (engine), via GE's own admin console:

- The impersonation SA added as an app admin, so it can register agents against the engine.

### 6.5 Cross-service data flow

```
SPA                 API server              GCP
 │   publishGem()      │                      │
 │─────────────────────▶ load gem              │
 │                     │─ check org settings   │
 │                     │─ impersonate SA ──────▶ iam.serviceAccounts
 │                     │─ enable APIs ─────────▶ serviceusage
 │                     │─ get engine ──────────▶ discoveryengine
 │                     │─ (opt) create DS ─────▶ discoveryengine
 │                     │─ (opt) drive fetch ───▶ drive (user token)
 │                     │─ (opt) gcs upload ────▶ storage
 │                     │─ (opt) doc import ────▶ discoveryengine
 │                     │─ persist publication  │
 │◀── recipe JSON ─────│                       │
 │   user pastes into Agent Designer ──────────▶ Gemini Enterprise console
 │   completePublication(agentResourceName) ▶  │ persist agent_resource_name
```

## 7. Edge Cases & Error Handling

| Case | Handling |
|---|---|
| Gem has `instructions` >100KB | Warn in recipe `_warnings`. Ship recipe as-is; let GE reject if over its own limit. Log the size at publish time. |
| Gem has no `knowledge_files` with `driveId` | Skip data store creation entirely; recipe lists knowledge files under `_attachManually`. |
| User declines the Drive OAuth scope | Same as previous row; no data store, warn in UI. |
| User re-publishes a gem that was already published | Create a new `gem_publications` row; mark the prior one `status='superseded'`. Data store is reused if it already exists (idempotent `dataStores.get` then `create` on 404). |
| Customer has no GE settings configured | `POST /api/gems/:id/publish` returns 409 with message *"Gemini Enterprise connection not configured. Ask an admin to set up at /settings/enterprise."* |
| Impersonation fails | Surface the raw GCP error code + message in `gem_publications.error_message`. Include a runbook link (to be authored) in the UI. |
| `documents.import` operation is long-running | Record the LRO name in `steps_jsonb`, poll with backoff up to 120s, then return with `status='recipe_ready'` and a note that ingestion is continuing async. A later GET resolves the final state. |
| Extension Drive URL points to a file the user can't read | Capture the 403 per-file, include failing file in `_warnings`, continue with the rest. |
| `default_tools` contains an unknown string | Populate `_unmappedTools` in the recipe, warn in the UI, do not block. |
| Gem is deleted while publish is in flight | `ON DELETE CASCADE` on `gem_publications.gem_id` removes the publication record. The in-flight orchestration should terminate on the next DB write with a no-op. |
| Concurrent publishes of the same gem | A PG advisory lock keyed on `('publish', gem_id::uuid)` serializes them at the service layer. |
| Dev-bypass mode (`GOOGLE_CLIENT_ID` empty) | Enterprise publish is disabled entirely; button is hidden with a tooltip explaining the dev-bypass restriction. GCP calls would have no credentials and leaking a fake flow would mislead. |
| Instruction hash changes after publish | UI shows a "Drifted" badge (see §5.1). Re-publish is the only resolution. |

## 8. Scope & Milestones

**v1 — "Publish via recipe" (2–3 weeks of focused work):**

1. Migration `003_add_gem_publications.sql`, repository, settings page, auth wiring.
2. `agent_recipe.js` + unit tests.
3. `POST /api/gems/:id/publish` orchestrator: steps 1–3 + step 6 only (no knowledge ingestion yet). Returns recipe JSON.
4. Publish modal + GemDetail button + publication history section.
5. `POST /api/publications/:id/complete` for closing the loop.

**v1.1 — knowledge ingestion (1–2 weeks):**

6. Drive scope on sign-in; orchestrator step 4 with custom data store + GCS staging + `documents.import`.
7. Long-running operation polling.
8. Drift detection + "Drifted" badge.

**v2 — fully-automated via ADK (spike first):**

9. ADK Python template that accepts `{ instructions, tools[], model }` as build-time params.
10. Server-side invocation of Agent Engine `reasoningEngines.create`.
11. GE `agents.create` with `adkAgentDefinition`.
12. Feature flag exposing the automated path.

**v3 — bulk operations:**

13. Multi-select on the Registry page, bulk publish with per-row status.
14. Import a pre-existing Agent Designer agent back into the registry (the reverse direction).

## 9. Success Criteria

### Functional acceptance

- [ ] An admin can configure enterprise settings at `/settings/enterprise`; the "Test connection" button returns success for a live GE project and fails cleanly for a bogus one.
- [ ] A gem owner clicking "Publish to Gemini Enterprise" on a simple gem (no knowledge files) receives a deterministic recipe JSON matching the golden fixture in tests.
- [ ] Pasting that recipe's `instructions` field and setting the `tools` in Agent Designer produces a working agent whose behavior matches the original gem (manual QA check on at least three real gems).
- [ ] A gem with three Drive-captured knowledge files, published with knowledge enabled, results in a data store containing those three files viewable in the GE console.
- [ ] `gem_publications` accurately records each attempt with status transitions visible in the UI.
- [ ] Re-publishing a gem supersedes the prior publication record without duplicating data stores.
- [ ] All new routes reject unauthenticated requests and enforce owner-or-admin ACLs.
- [ ] Tool mapping preview in the modal matches the table in `agent_recipe.js` one-to-one.

### Quality bars

- [ ] `agent_recipe.js` has ≥90% line coverage via Node's built-in test runner (matching existing `server/test/` conventions).
- [ ] End-to-end publish p95 latency <8s for a gem with no knowledge files; <45s for a gem with up to 5 Drive files <5MB each.
- [ ] No Google Cloud credentials, Drive tokens, or user access tokens are written to the database or to logs at any level higher than DEBUG.
- [ ] The publish feature is hidden entirely in dev-bypass mode and documented as such.

### Non-functional

- [ ] Adding the feature does not alter response times on the existing `/api/gems` list/detail endpoints (measured before and after with a simple benchmark).
- [ ] The Drive scope addition to sign-in is reversible — if removed, the rest of the SPA continues to function; publish simply drops into the "attach manually" mode.

## 10. Open Questions

1. **Do we ever expose v2 (ADK automated path)?** The UX cost is real — users can no longer edit instructions in Agent Designer after publish. Worth a product decision before investing.
2. **Should `org_enterprise_settings` be multi-row now** to front-load future multi-tenancy, even though the current deployment is single-tenant?
3. **Where does the `drive_staging_bucket` live?** Cleanest is *in the customer's project* (their storage cost, their data residency). Do we auto-create it or require the admin to pre-create?
4. **Do we need a per-gem `publish_suppressed` flag** so admins can block certain gems (e.g. containing sensitive prompt patterns) from being published?
5. **Hash normalization parity.** `agent_recipe.js` must produce byte-identical instructions to what gets published, so that `instruction_hash_at_publish` is comparable to current `instruction_hash`. Decide whether the recipe's `instructions` goes through `normalize()` from `ingestion.js` or bypasses it.
6. **What happens to the `gemini_id` field** once a gem is published? It's the original consumer-Gemini gem ID. We keep it in `gem_publications.source_gemini_id` for audit, but there's no product need today.
7. **Deep link format.** `console.cloud.google.com/gemini/enterprise/engines/{engine}/agents/new` is inferred; we should verify the exact URL format in the test sandbox before locking UI copy.
8. **Should we build a small verify-after-publish probe** that hits the GE agent with a canned question to confirm it responds? Useful but adds LLM-call cost.

---

## Appendix A — Feasibility research notes (April 2026)

This section exists to keep the spec honest about what the Google surfaces actually support, so the design doesn't drift.

- **Gemini Enterprise** is the successor product name for Google Agentspace (renamed 2025-10-09). Docs at `docs.cloud.google.com/gemini/enterprise/...`.
- **Agent Designer** is a UI-only surface (GA for the flow builder on 2026-01-12). The "Create an agent" doc describes the UI flow and does not mention an API creation path. A Google developer forum thread *"Making API Calls to No-code Agents (Agent Designer) in Gemini Enterprise (Agentspace)"* confirms that no-code Agent Designer agents **can be listed via `discoveryengine.googleapis.com` but cannot be created via API**.
- The `v1alpha.Agent` proto is **not published** in the open-source `googleapis/googleapis` repo; field list is inferrable from curl examples in the "Register ADK agents" / "Register A2A agents" docs.
- The GE **Google Drive connector cannot be driven by a service account** — explicit restriction in the Drive-data-store setup docs. This is why v1's knowledge ingestion uses a custom data store + `documents.import` from GCS, not the built-in Drive connector.
- The **three registrable agent definition types** are `adkAgentDefinition`, `dialogflowAgentDefinition`, `a2aAgentDefinition`. None carry inline instructions/tools/knowledge — those live in the backing system.
- Vertex AI Agent Engine (`aiplatform.googleapis.com/reasoningEngines`) is the deployment target for ADK agents; `reasoningEngines.create` is a long-running operation.
- GE project quotas (relevant ones): 100 data stores, 150 engines, 10M documents per project per location, 300 QPM. Agent-specific quotas are not published.

Source URLs for each claim are captured in the research notes attached to the implementation planning docs; to be copied into `docs/context/` if we end up needing a first-class reference sheet.
