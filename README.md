---
type: readme
title: "Gem Factory"
scope: Project overview — central registry for Google Gemini gem configurations, branded as the Schnucks Gem Registry
date: 2026-04-16
---

# Gem Factory

**A central registry for Google Gemini gem configurations — branded as the Schnucks Gem Registry.**

## Overview

Gem Factory is an internal tool for organizations whose employees have been building custom gems on `gemini.google.com`. Individual users create gems to suit their own workflows — a code reviewer here, a meeting summarizer there — but those gems stay siloed in each user's personal Gemini account. The organization has no visibility into what's been built, no way to discover useful gems across teams, and no path to promote the best ones into a governed environment.

Gem Factory solves that by providing a shared catalog. Users install a Chrome extension that extracts gem configurations from their Gemini edit pages and imports them into a central registry. The registry (the **Schnucks Gem Registry** in this deployment, for Schnucks Markets) gives the company an organizational view of the agents its people are actually building and using day-to-day — their instructions, the knowledge documents they reference, the tools they enable.

The long-term goal is to use that central database as the seed corpus for **Gemini Enterprise**: the registered gems become the blueprint for rebuilding vetted, governed versions of those agents inside the protected corporate environment the company is standing up for enterprise-scale agent work.

## How it works

```
  gemini.google.com            Gem Factory SPA         Gemini Enterprise
  ┌──────────────┐    extract  ┌──────────────┐  seed  ┌──────────────┐
  │  User's gem  │  ────────▶  │  Schnucks    │  ───▶  │  Governed    │
  │  (personal)  │   Chrome    │  Gem Registry│        │  enterprise  │
  └──────────────┘  extension  └──────────────┘        │  agents      │
                                      │                └──────────────┘
                                      ▼
                               PostgreSQL
                               (dedup + search)
```

1. **Extract.** A user opens one of their gems on `gemini.google.com`, clicks the extension's blue floating button, and the gem's full instructions, knowledge documents, and enabled tools are captured into the extension's local storage.
2. **Import.** The extension's popup sends the collected gems to the Gem Factory API, which normalizes, hashes, and deduplicates them into PostgreSQL.
3. **Browse.** Any employee signs into the Schnucks Gem Registry SPA and sees the full catalog — every gem across the org, searchable, filterable by owner.
4. **Promote.** Over time, the organization uses the registry to decide which agents deserve to be rebuilt in Gemini Enterprise with proper governance, data controls, and scaling.

## Features

- **Chrome extension** that extracts Gemini gem configurations directly from the edit page DOM — full instructions, descriptions, knowledge file metadata, Drive URLs, and enabled tools.
- **Silent Drive link capture** for knowledge documents, so the registry records not just file names but the actual Drive URLs users can follow.
- **REST API** with Google ID token authentication, full-text search, SHA-256-based deduplication, and a lightweight migration runner.
- **React SPA** with a personal Dashboard (your own gems) and a full organizational Registry (all gems, paginated 50 at a time, searchable and filterable by owner).
- **Schnucks branding** — logo, red color theme, and "Schnucks Gem Registry" identity applied throughout the SPA.
- **Local-first workflow** — gems live in the extension's storage until the user chooses to import them, so nothing leaves the browser unintentionally.

## Getting started

### Prerequisites

- PostgreSQL 16 (running on an accessible server — not inside Docker)
- Docker and Docker Compose (for the API server)
- Node.js 20+ and npm (for the SPA)
- Chrome or a Chromium-based browser (for the extension)

### 1. Configure the database

```bash
make db-init    # Interactive setup — saves credentials to .db-config (gitignored)
make db-test    # Verify the connection and privileges
```

### 2. Start the API server

```bash
make api-start  # Builds and starts the Docker Compose service on port 9090
make api-logs   # Tail logs
make api-stop   # Stop the container
```

The server runs schema migrations on startup. Dev-bypass auth is active whenever `GOOGLE_CLIENT_ID` is empty.

### 3. Start the SPA

```bash
make spa-install  # First time only — installs npm dependencies
make spa-dev      # Starts the Vite dev server on port 3000 (proxies /api → 9090)
```

Visit `http://localhost:3000`. In dev-bypass mode you're automatically signed in as `dev@localhost`.

For a production build:

```bash
make spa-build    # Outputs to server/public/ — the API server serves it as static files
```

### 4. Load the Chrome extension

1. Go to `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the `extension/` directory.
3. Open a gem on `gemini.google.com/gems/edit/*` — a blue floating button appears bottom-right.

## Usage

**Extracting gems:**

1. Open any of your gems for editing on `gemini.google.com`.
2. Click the blue gem button that appears in the bottom-right corner.
3. An overlay confirms the gem was captured and shows an instructions preview.
4. (Optional) Click **Capture All Links** to silently grab Drive URLs for each knowledge document attached to the gem.
5. Repeat for each gem you want to add to the registry.

**Importing to the registry:**

1. Click the extension's toolbar icon to open the popup.
2. Enter the API server URL (default `http://localhost:9090`) and your email.
3. Click **Save to Gem Factory** — the popup reports how many were imported, updated, or skipped.

**Browsing the registry:**

- **Dashboard (`/`)** — Your own gems in a compact table, plus org-wide stats.
- **Registry (`/registry`)** — Every gem in the org with full-text search, owner filter, and pagination.
- **Gem detail (`/gems/:id`)** — Full instructions, knowledge documents with Drive links, enabled tools, and (for owners) a delete action.

## Architecture

The repo contains three cooperating pieces plus a shared PostgreSQL schema:

| Path | What it is |
|------|------------|
| `extension/` | Manifest V3 Chrome extension — DOM extraction on gem edit pages, Drive link capture, popup UI for saving to the API |
| `server/` | Node.js + Express REST API — Google ID token auth, gem ingestion with SHA-256 dedup, full-text search, migrations |
| `frontend/` | React 19 + TypeScript + Vite + Tailwind v4 SPA — Dashboard, Registry, gem detail views, Schnucks branded |
| `server/db/migrations/` | PostgreSQL schema — `users`, `gems` (with `tsvector` search column), plus cluster tables reserved for future near-duplicate detection |
| `docs/context/ARCH.md` | Full system architecture, data flows, extension points |
| `docs/specs/` | Detailed specs for the extension, API, SPA, and auth |
| `docs/plans/` | Implementation plans for each component |
| `CLAUDE.md` | Orientation document for AI coding agents |

Run `make help` to see all available Makefile targets.

## Roadmap

Built and working in Phase 1:

- Chrome extension with DOM extraction and Drive link capture
- REST API with dedup, search, and authentication
- SPA with Dashboard and Registry

Deferred to later phases:

- Near-duplicate clustering beyond exact-hash matches (the tables exist, the logic is stubbed)
- Review workflow with status transitions and reviewer roles
- Promotion pipeline into Gemini Enterprise
- Production deployment (Cloud Run, CI/CD, OAuth client, managed database)

## Contributing

This is an internal tool. The codebase includes detailed context documents in `docs/` and a project-level `CLAUDE.md` for anyone (human or AI) onboarding onto the project. Start with `docs/context/ARCH.md` for the big picture, then the relevant spec under `docs/specs/` for the component you're working on.
