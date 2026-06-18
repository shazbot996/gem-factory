# Gem Factory — AI Coding Assistant Entry Point

This file is the canonical entry point for AI coding assistants working in
this repository. It is read by tools that look for `AGENTS.md` and points
to the per-assistant context files for everything else.

## Per-assistant context files

Each assistant has its own context file at the repository root. Both files
carry the same project context — they differ only in framing and per-tool
notes. Pick the one that matches the tool you are running:

- **Claude Code** → read [CLAUDE.md](./CLAUDE.md)
- **Gemini CLI** → read [GEMINI.md](./GEMINI.md)

If your tool does not match either of the above, **default to
[CLAUDE.md](./CLAUDE.md)** — it is the most detailed file and is kept in
sync with `GEMINI.md`.

## Quick orientation

Gem Factory is the **Schnucks Gem Registry** — a client-only catalog of
Google Gemini gem configurations for Schnucks Markets. There is no
application server and no database; gems live as JSON in a Google Cloud
Storage bucket (one immutable object per gem at
`users/<email>/gems/<gem-id>.json`) and both clients talk to GCS directly
using the signed-in user's Google credentials.

Two clients:

- **`frontend/`** — React 19 + Vite + Tailwind SPA. Admin-only browser
  that lists, views, and deletes per-gem objects in the bucket.
- **`extension/`** — Chrome extension (Manifest V3) that extracts gems
  from `gemini.google.com` edit pages and uploads them to GCS via
  `chrome.identity`. The popup treats the bucket as the source of truth
  and shows local extractions as "pending upload" until they're synced.

See [CLAUDE.md](./CLAUDE.md) or [GEMINI.md](./GEMINI.md) for the full
project structure, configuration model, run instructions, and conventions.

## Subprojects with their own context

- **`voicecode-bbs/`** — a separate VoiceCode BBS Python curses
  application that lives in this repo. It has its own
  `voicecode-bbs/AGENTS.md`, `voicecode-bbs/CLAUDE.md`, and
  `voicecode-bbs/GEMINI.md`. From the gem-factory root, the only
  touchpoint is `make voicecode`.

## Keeping the context files in sync

When you change project context (architecture, configuration, run
instructions, conventions), update **both** `CLAUDE.md` and `GEMINI.md`
so neither assistant becomes a second-class citizen. Tool-specific notes
can live in just one file.
