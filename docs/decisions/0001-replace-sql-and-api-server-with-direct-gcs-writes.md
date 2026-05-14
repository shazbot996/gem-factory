---
type: adr
title: "ADR-0001: Replace SQL database and API server with direct Chrome-extension writes to Google Cloud Storage"
status: Accepted
date: 2026-05-14
decision_summary: >
  Eliminate the Express API server and Cloud SQL PostgreSQL database. The Chrome
  extension writes one JSON file per user directly to a Google Cloud Storage
  bucket using the user's own OAuth credentials. The SPA is a read-only viewer
  that loads each user's JSON from the bucket. See
  docs/plans/gcs-direct-write-rewrite-PLAN.md for the implementation that
  realized this decision.
---

## ADR-0001: Replace SQL database and API server with direct Chrome-extension writes to Google Cloud Storage

## Status

**Accepted** (implemented 2026-05-14)

## Correction (post-acceptance)

The original "Decision" section below proposed using a Cloud IAM Condition of
the form
`resource.name.startsWith(".../users/" + request.auth.claims.email + "/")`.
**This is not supported.** Cloud Storage IAM Conditions only expose
`resource.name`, `resource.type`, `resource.service`, and `request.time` —
not `request.auth.claims.*`. Per-user prefix isolation therefore requires
either one IAM binding per user (with a per-user `resource.name.startsWith`
condition) or accepting group-wide write access. Phase 1 accepts group-wide
write access and relies on object versioning + Cloud Audit Logs; see
`docs/deployment/gcs-bucket-setup.md`.

## Context

The current architecture (`docs/context/ARCH.md`) is a layered monolith on Cloud Run with three runtime tiers:

1. A Chrome extension (`extension/`) that extracts gem configurations from `gemini.google.com` and posts them to the API.
2. An Express API server (`server/server.js`, ~7 route/middleware files, `server/services/ingestion.js`) that validates Google ID tokens, normalizes payloads, deduplicates by SHA-256 hash, and persists to Postgres.
3. A Cloud SQL PostgreSQL database with `users`, `gems`, and two duplicate-cluster tables (`server/db/migrations/001_initial_schema.sql`). The `gems` table uses a generated `tsvector` column with a GIN index for full-text search.

Several forces motivate revisiting this design:

- **The project is short-lived and small.** It serves a single corporate org (Schnucks) plus a small number of Gmail collaborators. Traffic is bursty and rare — users import their gems once and occasionally browse.
- **The relational schema does no real relational work.** Two tables (`duplicate_clusters`, `duplicate_cluster_members`) are unused. The remaining queries are "list my gems", "list all gems", "get one gem", and "delete one gem". `instruction_hash` powers an upsert dedup that could just as easily be "overwrite the file on each save".
- **Operational cost.** Cloud SQL is the most expensive moving part by an order of magnitude — it requires sizing, backups, the Cloud SQL Auth Proxy, and DB credential management (`.db-config`, gitignored). Migrations run on every API boot (`server/db/migrate.js`).
- **Auth complexity is concentrated in the API tier.** `server/middleware/auth.js` exists to validate ID tokens; with no API, the storage system itself can enforce identity natively via GCS IAM.
- **The Gemini Enterprise publish work in flight (`docs/specs/gemini-enterprise-publish-SPEC.md`) is a separate consumer.** It does not need a live API — it needs a bag of gem documents it can read on a schedule.

The decision in scope: **can the application be collapsed to (a) a Chrome extension writing JSON to GCS and (b) one or more readers consuming that bucket — eliminating the API server and Cloud SQL entirely?**

The core feasibility question is whether unprivileged corporate users (and Gmail users) can be safely granted *write* access to a Cloud Storage bucket from a Chrome extension.

### Feasibility analysis: direct extension → GCS writes

**Identity acquisition in the extension.** The Chrome extension can obtain a Google OAuth 2.0 access token via `chrome.identity.getAuthToken` (for Workspace identities, the extension declares the `identity` permission and an `"oauth2"` block in `manifest.json` with the scope `https://www.googleapis.com/auth/devstorage.read_write`). The token is bound to the signed-in Chrome profile — no separate sign-in flow, no credential forwarding. This replaces today's "piggyback on the SPA session" mechanism (`docs/specs/authentication-authorization-SPEC.md` §3.2).

**Authorization at the bucket.** GCS IAM supports two mechanisms that together make per-user write access safe:

1. **Group-based grant.** A Google Group (e.g., `gem-importers@schnucks.example`) is granted `roles/storage.objectCreator` and `roles/storage.objectViewer` on the bucket. Any member can write and read. Org admins manage membership in the directory — no application-level user provisioning.
2. **IAM Conditions for prefix isolation.** A condition expression of the form `resource.name.startsWith("projects/_/buckets/<bucket>/objects/users/" + request.auth.claims.email + "/")` constrains each principal to write only under their own prefix. Without this, any group member could overwrite another user's file. With it, a user calling `objects.insert` outside their prefix is rejected by GCS before the request reaches application code.

**The Gmail problem.** IAM bindings on GCS accept individual Gmail accounts (`user:alice@gmail.com`) but cannot be expressed as a group of "all Gmail users." Today's spec allows Gmail accounts when `ALLOW_GMAIL=true`. Two viable answers:

- Drop or downgrade Gmail support — the registry is internal to Schnucks; Gmail support exists mostly to let the maintainer (`charles.schiele@gmail.com`) test against production. Maintain a short explicit allow-list of individual Gmail principals on the bucket.
- Keep a thin token-exchange Cloud Function for Gmail-only — but this re-introduces a server.

The recommendation below assumes the first option.

**No reason this approach is fundamentally unsound.** It is a standard pattern for direct-from-browser uploads (mobile apps, Firebase Storage, GCS Browser SDK). The objections that *would* block it — credential forwarding, audit gaps, write storms — do not apply here: the user already holds a corporate identity in Chrome, GCS produces native audit logs (Cloud Audit Logs / Data Access logs), and the write volume is trivial.

## Decision

**We will eliminate the API server and the Cloud SQL database.** Gem configurations will be stored as JSON files in a Google Cloud Storage bucket. The Chrome extension will write directly to GCS using the user's OAuth credentials, scoped by an IAM Condition to a per-user object prefix.

**Storage layout.** One object per user, keyed by email:

```
gs://schnucks-gem-registry/users/<email>/gems.json
```

The file contains the user's full gem collection as a JSON document — `{ owner, updatedAt, gems: [...] }`. Each save from the extension overwrites the file (no append/merge on the server side). Object versioning is enabled on the bucket to retain history.

**Authorization.**

- Group `gem-importers@schnucks.example` granted `roles/storage.objectCreator` + `roles/storage.objectViewer` on the bucket, restricted by IAM Condition to `resource.name.startsWith("projects/_/buckets/schnucks-gem-registry/objects/users/" + request.auth.claims.email + "/")`.
- Admins granted `roles/storage.objectAdmin` (unconditional) for cleanup and the Enterprise publish job.
- Bucket uses Uniform Bucket-Level Access (no per-object ACLs).

**Readers.** The viewer becomes a static SPA hosted in the same bucket (or Cloud Storage static-site hosting / Firebase Hosting) that lists objects under `users/` and renders them. Any future processor — the Gemini Enterprise publish job, dedup analysis, search indexing — is a separate Cloud Run job that reads the bucket on a schedule. None of these needs to share a database or an API surface.

**Why this over the current architecture.** The current system is sized for a multi-tenant SaaS but serves a registry the size of a small Slack channel. Removing the API tier eliminates the only stateful service we operate (Cloud SQL), the only Node.js process we deploy (Cloud Run), the auth middleware (`server/middleware/auth.js`), the migration runner (`server/db/migrate.js`), and the entire `server/` tree. The remaining components — extension, viewer, optional processor — are each independently deployable and have no shared runtime state.

## Alternatives Considered

### Alternative A: Keep Cloud SQL, eliminate API server only

Have the extension write directly to Cloud SQL via the Cloud SQL Auth Proxy or a Postgres connection from a browser.

- **Pros:** Preserves full-text search and existing schema.
- **Cons:** No supported path for a Chrome extension to authenticate to Cloud SQL with IAM database auth — IAM DB auth requires a service-account-grade token, not a user ID token. Exposing Postgres credentials to the extension is a non-starter. This option is essentially infeasible.

### Alternative B: Replace Cloud SQL with Firestore, keep the API server

Swap Postgres for Firestore Native Mode. Firestore supports browser SDK with Firebase Authentication and security rules that can enforce per-user document ownership without a server.

- **Pros:** Mature direct-from-browser pattern. Real-time updates if ever needed. Better fit than Postgres for the actual access pattern.
- **Cons:** Requires Firebase Authentication (separate from corporate Google Sign-In, though they can federate). Security-rule language is its own learning surface. Does not eliminate as much code as the GCS option — the API server stays for any aggregation. Firestore's full-text search is poor (the same problem we have to solve with GCS).

### Alternative C: One file per gem, not one file per user

`gs://.../gems/<owner>/<gem-id>.json` instead of `gs://.../users/<email>/gems.json`.

- **Pros:** Per-gem object versioning. Smaller writes. Easier per-gem delete.
- **Cons:** "List my gems" requires a `objects.list` with a prefix scan; reading a user's full collection is N round-trips. The user's stated preference is one file per user. Easy to migrate to this scheme later if needed — the readers, not the writers, define the shape consumers see.

### Alternative D: Signed-URL service (thin backend)

Keep a tiny Cloud Function that mints short-lived signed URLs for upload. The extension calls the function to get a URL, then PUTs to GCS.

- **Pros:** Centralizes auth policy in code rather than IAM Conditions. Easier to add Gmail support without per-user IAM bindings. Easier to do server-side validation on the JSON before it lands.
- **Cons:** Re-introduces a stateful (or at least deployed) service. Defeats much of the operational simplification. The IAM-Condition approach gives equivalent security with no code.

### Alternative E: Status quo (Cloud SQL + Express API)

Do nothing.

- **Pros:** Already built and working. Full-text search via tsvector. Familiar to the maintainer.
- **Cons:** All the costs in the Context section persist — DB sizing, migrations on every boot, two deployable tiers, an auth middleware to maintain, an API surface to evolve. Disproportionate for the actual scale and lifetime.

## Consequences

### Positive

- **Two fewer deployed services.** No Cloud Run (or hosting becomes static-only), no Cloud SQL instance. No `docker-compose.yml`, no `.db-config`, no migration runner.
- **Auth simplifies dramatically.** No ID-token validation code, no admin-list env var, no CORS middleware, no dev-bypass branch. IAM is the single source of truth.
- **Audit logging is free.** GCS Data Access logs record every write with the principal's email, request ID, and timestamp — better than what we have today.
- **Versioning is free.** GCS object versioning gives us full history of every user's gem set without a schema for it.
- **Consumers decouple cleanly.** The Gemini Enterprise publisher, future search indexer, and dedup analyzer all become independent readers of the bucket.
- **Deployment of the extension becomes the only release artifact.** Push it to the Chrome Web Store (or sideload internally).

### Negative

- **Full-text search disappears.** Today's `tsvector` GIN index goes away. The viewer must either load all users' files and search client-side (fine at this scale — a few hundred gems total) or a separate indexer must materialize a search index (e.g., write `index.json` after each upload, or run a periodic Cloud Run job that rebuilds an index).
- **Cross-user dedup gets harder.** Today's `instruction_hash` unique index catches exact duplicates at write time across all users. With per-user JSON files, dedup becomes a read-side concern — a periodic scanner produces a duplicate report, but writers cannot see each other's hashes synchronously.
- **Gmail support narrows.** IAM bindings on Gmail accounts must be explicit per-user. The convenient `ALLOW_GMAIL=true` toggle goes away. This is acceptable because Gmail support was always a maintainer convenience, not a product requirement.
- **Schema evolution is implicit.** Today's `001_initial_schema.sql` / `002_add_gem_metadata.sql` give a clear story for fields. With JSON files, schema changes happen ad hoc; readers must tolerate old shapes. Mitigate by writing a `schemaVersion` field into the JSON.
- **Browser-side write of large payloads.** Knowledge file metadata is small; instructions are capped at 100 KB. Total per-user payload is well within GCS single-request limits. No concern here, but worth noting.
- **The extension grows in scope.** It now owns serialization, the GCS write call, and OAuth scope acquisition. Today it just calls one REST endpoint.

### Neutral

- **The SPA viewer stays, but its job changes.** Instead of calling `/api/gems`, it lists the bucket and renders objects. It can remain a React app served as static files.
- **CLAUDE.md, the architecture doc, and the auth spec all need substantial revision.** This is expected for a change of this scope.
- **Dev workflow changes.** No more `make api-start` / `make db-init`. The new dev story is `make spa-dev` + a dev GCS bucket (or the gcsfuse / fake-gcs emulator).

## Related Decisions

- `docs/context/ARCH.md` — current architecture (will be superseded by this ADR's implementation).
- `docs/specs/authentication-authorization-SPEC.md` §3.2 — current "extension piggybacks on SPA session" approach (replaced by direct `chrome.identity.getAuthToken`).
- `docs/specs/api-server-SPEC.md` — entire spec becomes obsolete if this ADR is accepted.
- `docs/specs/gemini-enterprise-publish-SPEC.md` — the publisher's input changes from "Postgres rows" to "GCS objects under `users/`"; the rest of its design is unaffected.
- A follow-up ADR may be needed to decide the search/dedup strategy (client-side scan vs. periodic indexer) once this one is accepted.
