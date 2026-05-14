---
type: readme
title: "Gem Factory"
scope: Project overview — central registry for Google Gemini gem configurations, branded as the Schnucks Gem Registry
date: 2026-05-14
---

# Gem Factory

**A central registry for Google Gemini gem configurations — branded as the Schnucks Gem Registry.**

## Overview

Gem Factory is an internal tool for organizations whose employees have been building custom gems on `gemini.google.com`. Individual users create gems to suit their own workflows — a code reviewer here, a meeting summarizer there — but those gems stay siloed in each user's personal Gemini account. The organization has no visibility into what's been built, no way to discover useful gems across teams, and no path to promote the best ones into a governed environment.

Gem Factory solves that by providing a shared catalog. Users install a Chrome extension that extracts gem configurations from their Gemini edit pages and writes them directly into a central registry. The registry (the **Schnucks Gem Registry** in this deployment, for Schnucks Markets) gives the company an organizational view of the agents its people are actually building and using day-to-day — their instructions, the knowledge documents they reference, the tools they enable.

The long-term goal is to use that central catalog as the seed corpus for **Gemini Enterprise**: the registered gems become the blueprint for rebuilding vetted, governed versions of those agents inside the protected corporate environment the company is standing up for enterprise-scale agent work.

## How it works

```
  gemini.google.com           Google Cloud Storage      Gemini Enterprise
  ┌──────────────┐    extract  ┌──────────────┐  seed  ┌──────────────┐
  │  User's gem  │  ────────▶  │  Schnucks    │  ───▶  │  Governed    │
  │  (personal)  │   Chrome    │  Gem Registry│        │  enterprise  │
  └──────────────┘  extension  │  (gems.json) │        │  agents      │
                               └──────┬───────┘        └──────────────┘
                                      │ read-only
                                      ▼
                               ┌──────────────┐
                               │   Schnucks   │
                               │  Registry SPA│
                               └──────────────┘
```

1. **Extract.** A user opens one of their gems on `gemini.google.com`, clicks the extension's floating action button, and the gem's full instructions, knowledge documents, and enabled tools are captured into the extension's local storage.
2. **Save.** From the extension popup, the user clicks **Save to Registry**. The extension obtains an OAuth token via `chrome.identity`, merges the new gems into `users/<email>/gems.json` in the configured GCS bucket, and writes it back with `If-Match` for optimistic concurrency.
3. **Browse.** An administrator signs into the Schnucks Gem Registry SPA, which lists every `users/<email>/gems.json` in the bucket and flattens them into a single catalog — searchable and filterable by owner.
4. **Promote.** Over time, the organization uses the registry to decide which agents deserve to be rebuilt in Gemini Enterprise with proper governance, data controls, and scaling.

## Features

- **Chrome extension (Manifest V3)** that extracts Gemini gem configurations directly from the edit page DOM — full instructions, descriptions, knowledge file metadata, Drive URLs, and enabled tools.
- **Silent Drive link capture** for knowledge documents, so the registry records not just file names but the actual Drive URLs users can follow.
- **Direct-to-GCS writes** from the extension using each user's own OAuth credentials — no application server, no relational database. One JSON document per user (`users/<email>/gems.json`) with `If-Match` etag-based optimistic concurrency on overwrite.
- **React SPA viewer** with a single Registry page: every gem in the bucket, debounced client-side search across name/description/instructions, owner filter, and 50-per-page pagination.
- **Schnucks branding** — logo, red color theme, and "Schnucks Gem Registry" identity applied throughout the SPA.
- **Local-first workflow** — gems live in the extension's local storage until the user explicitly clicks **Save to Registry**, so nothing leaves the browser unintentionally.

## Getting started

### Prerequisites

- A Google Cloud project with a GCS bucket configured per [`docs/deployment/gcs-bucket-setup.md`](docs/deployment/gcs-bucket-setup.md) — UBLA, object versioning, CORS, and the IAM bindings authorized users need.
- A Google OAuth client ID for each side that needs one:
  - A **Chrome-Extension**-type client (bound to the extension's ID) for the extension.
  - A **Web application**-type client (with `http://localhost:3000` as an authorized origin) for the SPA.
- Node.js 20+ and npm (for the SPA).
- Chrome or a Chromium-based browser (for the extension).

### 1. Configure the SPA

Set the GCS bucket and SPA OAuth client ID in `frontend/.env.development.local` (copy the `.example` file as a starting point):

```bash
VITE_GOOGLE_CLIENT_ID=<web-application-oauth-client-id>
VITE_GCS_BUCKET=gcs-gem-registry
```

Leaving `VITE_GOOGLE_CLIENT_ID` empty enables dev-bypass mode (auto-signs in as `dev@localhost`).

### 2. Start the SPA

```bash
make spa-install  # First time only — installs npm dependencies
make spa-dev      # Starts the Vite dev server on port 3000
```

Visit `http://localhost:3000`. Sign in with Google and the SPA will load every `users/<email>/gems.json` it can read from the configured bucket.

For a production build:

```bash
make spa-build    # Outputs to frontend/dist/
```

### 3. Configure and load the Chrome extension

The bucket name and Chrome-Extension OAuth client ID live in **two** files that must stay in sync — Chrome reads `manifest.json` when calling `chrome.identity.getAuthToken`:

- `extension/config.js` — `bucketName` + `oauthClientId`
- `extension/manifest.json` — `oauth2.client_id`

Then:

1. Go to `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the `extension/` directory.
3. Open a gem on `gemini.google.com/gems/edit/*` — a floating gem button appears bottom-right.

## Usage

**Extracting gems:**

1. Open any of your gems for editing on `gemini.google.com`.
2. Click the floating gem button that appears in the bottom-right corner.
3. An overlay confirms the gem was captured and shows an instructions preview.
4. (Optional) Click **Capture All Links** to silently grab Drive URLs for each knowledge document attached to the gem.
5. Repeat for each gem you want to add to the registry.

**Saving to the registry:**

1. Click the extension's toolbar icon to open the popup. Pending gems are listed with the target bucket shown in the header strip.
2. Click **Save to Registry**. On first use, Chrome shows the Google consent screen for the `devstorage.read_write` and `userinfo.email` scopes.
3. The extension reads your existing `users/<email>/gems.json` (or starts an empty one), merges the new gems by id, and writes the document back. The popup reports the number saved.

**Browsing the registry:**

- **Registry (`/`)** — Every gem in the bucket with debounced search across name, description, and instructions; an owner dropdown; and 50-per-page pagination.
- **Gem detail (`/gems/:id`)** — Full instructions (with a Copy button), knowledge documents linked back to Drive, and the enabled-tools list.

## Architecture

The repo contains two cooperating clients of a shared GCS bucket — no application server, no relational database:

| Path | What it is |
|------|------------|
| `extension/` | Manifest V3 Chrome extension — DOM extraction on gem edit pages, Drive link capture, direct GCS writes via `chrome.identity` |
| `frontend/` | React 19 + TypeScript + Vite 6 + Tailwind v4 SPA — read-only viewer over the bucket, Schnucks branded |
| `docs/context/ARCH.md` | Full system architecture, data flows, document schema |
| `docs/decisions/` | Architecture decision records (ADR-0001 explains the SQL → GCS rewrite) |
| `docs/deployment/gcs-bucket-setup.md` | Bucket configuration runbook (UBLA, versioning, CORS, IAM) |
| `docs/specs/` | Detailed specs for the extension, SPA, auth, and the future Gemini Enterprise publisher |
| `docs/plans/` | Implementation plans for each component |
| `CLAUDE.md` | Orientation document for AI coding agents |

Run `make help` to see all available Makefile targets.

## Roadmap

Built and working:

- Chrome extension (v0.12.0) with DOM extraction, Drive link capture, and direct-to-GCS writes with etag-based optimistic concurrency
- React SPA viewer with Google Sign-In, GCS list/download, client-side search, owner filter, and pagination
- Schnucks branding across the SPA

Deferred to later phases:

- Cross-user near-duplicate clustering and a periodic indexer (`index.json`) for the SPA to consume
- Review workflow with status transitions and reviewer roles
- Promotion pipeline into Gemini Enterprise (see `docs/specs/gemini-enterprise-publish-SPEC.md`)
- Production deployment — a hosted bucket, a production OAuth client per side, and SPA hosting

## Contributing

This is an internal tool. The codebase includes detailed context documents in `docs/` and a project-level `CLAUDE.md` for anyone (human or AI) onboarding onto the project. Start with `docs/context/ARCH.md` for the big picture, then `docs/decisions/0001-replace-sql-and-api-server-with-direct-gcs-writes.md` for why the current shape exists, and the relevant spec under `docs/specs/` for the component you're working on.
