# Executed: 2026-04-05T13:58:18.896040

You are a maintenance agent performing an **Update** action — regenerating a root project context file so it accurately reflects the current codebase.

## Your task

Rewrite the context file at `CLAUDE.md` so every fact matches the live code. This file is read by AI coding agents (Claude, Gemini) as their primary orientation to the project, so accuracy is critical.

## Document to update

- **Path:** `CLAUDE.md`
- **Role:** Root project context file (read by AI agents via CLAUDE.md / GEMINI.md / AGENTS.md)

<document>
# Gem Factory — Claude Code Instructions

## What this project is

Gem Factory is a central registry for Google Gemini gem configurations across a corporate Google Cloud org. Users import their personal gems into a shared catalog for discovery, dedup, and promotion to Enterprise agents.

## Project structure

```
gem-factory/
  CLAUDE.md                 ← you are here
  Makefile                  ← project-level commands (help, db-init, db-test, voicecode)
  .db-config                ← local database credentials (gitignored, created by `make db-init`)
  .gitignore
  docs/
    context/ARCH.md         ← full system architecture (Cloud Run, SPA, extension, DB schema)
    specs/                  ← feature specifications
    plans/                  ← implementation plans
  extension/                ← Chrome extension (Manifest V3) — gem extractor
    manifest.json           ← v0.3.0 — edit-page DOM extraction approach
    background.js           ← service worker: gem storage, message routing, future SPA comms
    content-script.js       ← FAB + overlay on gem edit pages, reads DOM fields directly
    page-script.js          ← MAIN world script (stub — reserved for future network interception)
    styles.css              ← FAB and modal overlay styles
    icons/                  ← placeholder PNGs (blue diamond)
  voicecode-bbs/            ← separate project — VoiceCode BBS (Python curses app)
    CLAUDE.md               ← its own Claude Code instructions
  prompts/history/          ← prompt/response history from development sessions
```

## Key documents — read these first

- `docs/context/ARCH.md` — full architecture: Chrome extension, SPA, backend API, Cloud SQL schema, data flows, extension points
- `docs/specs/chrome-extension-gem-extractor-SPEC.md` — detailed spec for the Chrome extension
- `docs/plans/chrome-extension-gem-extractor-PLAN.md` — implementation plan (partially executed)

## Chrome extension (`extension/`)

**Current approach (v0.3.0):** Extract one gem at a time from the gem **edit** page.

- The FAB (floating action button) only appears on `/gems/edit/*` URLs
- Clicking the FAB reads the gem name from input fields and full instructions from the `.ql-editor` (Quill rich-text editor) element directly in the DOM
- No API calls are made — all data comes from the rendered edit form
- The overlay shows the extracted gem as JSON with a "Copy to Clipboard" button
- Extracted gems accumulate in `chrome.storage.local` (keyed by gem ID, last extraction wins)

**Why this approach:** The Gemini internal `batchexecute` list API (`CNgdBe` RPC) truncates instructions at ~100 chars. The edit page is the only place the full instructions are reliably available in the browser.

**To test the extension:**
1. Go to `chrome://extensions`, enable Developer mode, click "Load unpacked", select `extension/`
2. Navigate to `gemini.google.com`, open a gem for editing
3. The blue FAB appears bottom-right — click to extract

**Key conventions:**
- No build step, no npm, no bundler — pure browser APIs only
- Manifest V3 with `host_permissions` on `gemini.google.com/*`
- Version in `manifest.json` should be bumped on each testable change
- `page-script.js` runs in the `MAIN` world (for future network interception); `content-script.js` runs in the isolated world
- XSS prevention: use `textContent`, never `innerHTML`, for user-supplied data

**Future SPA integration (not built yet):**
The background script already handles `GET_GEMS` and `CLEAR_GEMS` external messages per the protocol in `ARCH.md` section 7.2.

## Database

- PostgreSQL (Cloud SQL target, local dev via any PG instance)
- `make db-init` — interactive setup, saves credentials to `.db-config`, creates the database if needed
- `make db-test` — verifies connection and privileges
- `.db-config` is gitignored — never commit credentials
- Schema is defined in `ARCH.md` section 3.4 (tables: `users`, `gems`, `duplicate_clusters`, `duplicate_cluster_members`) — not yet applied

## Makefile

All commands: `make help`. Key targets:
- `make db-init` — interactive database config + connection test + auto-create DB
- `make db-test` — test DB connection and check privileges
- `make voicecode` — launch the VoiceCode BBS app (separate project)

The Makefile uses `SHELL := /bin/bash` (required for `read -s` and config sourcing).

## voicecode-bbs/

A separate Python curses application that lives in this repo. It has its own `CLAUDE.md` — read that file if working on VoiceCode. From the gem-factory root, the only touchpoint is `make voicecode`.

## Conventions

- No frontend framework yet — the SPA is not built
- Backend is not built — only the extension and DB config exist so far
- Docs follow a type/frontmatter convention: `type: arch|spec|plan|drift-report`
- Plans go in `docs/plans/`, specs in `docs/specs/`, architecture in `docs/context/`
</document>

## Instructions

1. **Read the actual code.** Use your tools to explore files, grep for patterns, and read implementations. Do not rely solely on the embedded content — verify every claim against the live codebase.

2. **Use git history for context.** Run `git log --oneline -30` and `git diff HEAD~10..HEAD --stat` to understand recent changes. This helps you identify what's new, what's been renamed, and what's been removed.

3. **Preserve structure and voice.** Keep the same section headings, organizational hierarchy, and writing style. The document should feel like a natural update, not a rewrite from scratch.

4. **Update all facts:**
   - File paths and directory structure
   - Module, class, and function names
   - Architecture descriptions and data flows
   - Configuration values and environment variables
   - Dependencies and integration points
   - UI descriptions and keyboard shortcuts

5. **Add missing coverage.** If new modules, features, or subsystems have been added since the last update and they fall within this document's scope, add them in the appropriate section following the existing style.

6. **Remove obsolete content.** If the document describes code or features that no longer exist, remove those references cleanly. Don't annotate removals — just take them out.

7. **Cross-reference sibling context files.** If this is AGENTS.md, ensure references to CLAUDE.md and GEMINI.md are accurate. If this is CLAUDE.md or GEMINI.md, ensure it complements (not duplicates) AGENTS.md.

## Output

Overwrite the file at `CLAUDE.md` with the updated content. Do not create a new file — write directly to the existing path. Git provides rollback if needed.

## Guidelines

- **Accuracy over completeness.** It's better to omit something than to include a wrong claim. AI agents will trust this file.
- **Be specific.** Reference actual file paths, class names, and module structure — vague descriptions are unhelpful for agents navigating the codebase.
- **Keep it maintainable.** Write at the right level of abstraction. Don't list every function — describe the architecture and key entry points.
- **Minimize churn.** Don't rewrite sections that are already accurate. Only change what needs changing so the git diff stays reviewable.

