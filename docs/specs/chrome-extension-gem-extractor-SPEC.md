---
type: spec
title: "Chrome Extension: Gem Extractor"
scope: Manifest V3 Chrome extension for extracting Gemini gem configurations from edit pages
date: 2026-04-15
---

## 1. Problem Statement

Gem Factory needs to import users' personal Gemini gem configurations into a central registry, but Google provides no official API for reading gem data. Without an extraction mechanism, users would have to manually copy-paste each gem's name and instructions from the Gemini web app — a tedious process that discourages participation and produces inconsistent data.

The Chrome extension bridges this gap by running in the user's authenticated browser session on `gemini.google.com`, extracting gem configurations directly from edit page DOM fields, and presenting them for review before any data leaves the browser. This is the critical path component that makes the entire Gem Factory system viable.

## 2. Goals & Non-Goals

### Goals

- Extract gem configurations (name, description, instructions, knowledge files, enabled tools) from the Gemini web app's gem **edit page** DOM.
- Capture Google Drive file IDs and URLs for knowledge documents by silently opening the Drive viewer.
- Present extracted gem data to the user in a structured overlay with confirmation banners, instructions preview, and knowledge document status.
- Accumulate gems across multiple edit page visits into a running collection stored in `chrome.storage.local`.
- Activate only on gem edit pages (`gemini.google.com/gems/edit/*`) — invisible elsewhere.
- Communicate with the Gem Factory SPA via `chrome.runtime.onMessageExternal` for import and clear operations.
- Provide a browser-action popup for viewing all extracted gems, saving them to the API server, and managing the collection.

### Non-Goals

- Extracting gems in bulk via API calls. The Gemini internal `batchexecute` API (`CNgdBe` RPC) truncates instructions at ~100 chars, making it unsuitable for full extraction. Only the edit page DOM has complete data.
- Extracting knowledge file **contents** (only file metadata, Drive IDs, and Drive URLs are captured).
- Modifying, creating, or deleting gems in the Gemini web app.
- Supporting browsers other than Chrome (or Chromium-based browsers that support Manifest V3).
- Extracting predefined/system gems (Google's built-in gems). Only user-created custom gems are in scope.
- Publishing to the public Chrome Web Store. Distribution is via developer mode sideloading.

## 3. Proposed Solution

Build a Manifest V3 Chrome extension that extracts one gem at a time from the gem **edit page**, reading form fields directly from the DOM. This is the only reliable approach because:

- The Gemini internal `batchexecute` list API (`CNgdBe` RPC) truncates instructions at ~100 chars. The edit page is the only place the full instructions are reliably available in the browser.
- Knowledge file Drive IDs only appear when the Drive viewer opens — they are not present in the edit page DOM otherwise.

After extraction, data is displayed in a structured modal overlay with confirmation status, instructions preview, knowledge document list with Drive link capture, and a running collection of all extracted gems.

### Key workflow

1. User installs the extension (developer mode sideloading).
2. User navigates to `gemini.google.com` and opens a gem for editing.
3. A blue circular FAB (floating action button) appears in the bottom-right corner.
4. User clicks the FAB.
5. The extension reads DOM fields (name, description, instructions, knowledge files, tools), stores the gem, and shows a confirmation overlay.
6. In the overlay, user can click "Capture All Links" to silently grab Drive URLs for knowledge documents.
7. User repeats for each gem they want to extract.
8. User can view all collected gems, save them to the API server, or copy JSON via the toolbar popup.

## 4. Technical Design

### 4.1 Extension File Structure

```
extension/
  manifest.json           # Manifest V3 configuration
  background.js           # Service worker: gem storage, message routing, SPA communication
  content-script.js       # Injected on gemini.google.com: FAB, overlay, DOM extraction, Drive capture
  page-script.js          # MAIN world script (stub — reserved for future network interception)
  popup.html              # Browser-action popup (extension toolbar icon)
  popup.js                # Popup logic: gem list, save to server, copy JSON, settings
  styles.css              # Styles for the FAB, modal overlay, and knowledge list
  icons/
    icon-16.png
    icon-48.png
    icon-128.png
```

### 4.2 Manifest Configuration

```json
{
  "manifest_version": 3,
  "name": "Gem Factory Extractor",
  "version": "0.10.0",
  "description": "Extract Gemini gem configurations for the Gem Factory registry",
  "permissions": [
    "storage",
    "activeTab"
  ],
  "host_permissions": [
    "https://gemini.google.com/*",
    "http://localhost:9090/*",
    "https://*.run.app/*"
  ],
  "externally_connectable": {
    "matches": ["http://localhost:3000/*"]
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  },
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["https://gemini.google.com/*"],
      "js": ["content-script.js"],
      "css": ["styles.css"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://gemini.google.com/*"],
      "js": ["page-script.js"],
      "run_at": "document_start",
      "world": "MAIN"
    }
  ],
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  }
}
```

Key decisions:
- `host_permissions` on `gemini.google.com/*` enables the content script to interact with the page and the background script to make fetch calls. Additional host permissions on `localhost:9090/*` and `*.run.app/*` allow the popup to save gems to the API server in dev and production.
- `externally_connectable` with `http://localhost:3000/*` enables the SPA to communicate with the extension via `chrome.runtime.sendMessage`.
- `activeTab` is included so the extension can interact with the current tab's content when the user invokes it.
- `page-script.js` runs in the `MAIN` world (for potential future network interception). Currently a stub.
- `action.default_popup` configures the browser-action toolbar popup (`popup.html`).

### 4.3 DOM Extraction Strategy

The extension reads gem data directly from the edit page's form fields. No API calls are made.

**What it extracts:**

| Field | DOM Source | Extraction Method |
|-------|-----------|-------------------|
| Gem ID | URL path | Regex on `location.href`: `/gems/edit/(.+)` |
| Name | First `<input>` field | Finds first text input with a non-empty value under 200 chars |
| Description | `#gem-description-input` textarea | `.value.trim()` |
| Instructions | `.ql-editor` (Quill rich-text editor) | `.innerText` or `.textContent`, trimmed |
| Knowledge files | `uploader-file-preview` elements inside `.knowledge-container` | Name from `[data-test-id="file-name"]`, type from `.file-type`, mime type parsed from `[data-test-id="file-icon-img"]` src URL |
| Enabled tools | `bots-creation-default-tool-section` | Dropdown label from `.default-tool-trigger .logo-pill-label-container span` |

**Why DOM extraction over API interception:** The Gemini internal `batchexecute` API truncates instructions at ~100 chars. The edit page is the only place the full instructions are available. Knowledge file Drive IDs only appear when the Drive viewer is opened — they require an additional capture step (section 4.7).

### 4.4 Background Script Messages (`background.js`)

The background service worker handles gem storage and message routing:

**Internal messages** (from content script and popup via `chrome.runtime.onMessage`):

| Message Type | Behavior |
|-------------|----------|
| `STORE_GEM` | Stores the gem in `chrome.storage.local`, replacing an existing gem with the same ID or appending if new. Returns `{ success, totalGems, wasUpdate, allGems }`. |
| `GET_ALL_GEMS` | Returns all stored gems: `{ gems: [...], extractedAt, strategy }`. |
| `DELETE_GEM` | Removes a gem by ID. Returns `{ success, totalGems }`. |

**External messages** (from SPA via `chrome.runtime.onMessageExternal`):

| Message Type | Behavior |
|-------------|----------|
| `GET_GEMS` | Returns all stored gems (same format as `GET_ALL_GEMS`). |
| `CLEAR_GEMS` | Removes the `extractedGems` key from storage. Returns `{ success }`. |

### 4.5 Page Detection

The content script shows the FAB only on gem **edit** pages. The relevant URL pattern:

| Pattern | FAB shown? |
|---------|------------|
| `gemini.google.com/gems/edit/*` | Yes |
| All other pages | No |

The `EDIT_PAGE_PATTERN` regex is: `/^https:\/\/gemini\.google\.com\/gems\/edit\/(.+)/`

Since Gemini is a single-page app with client-side routing, URL changes don't trigger full page loads. The content script polls `location.href` every 500ms via `setInterval` to detect navigation and show/hide the FAB accordingly.

### 4.6 Gem Data Model (Extension-Side)

Each extracted gem is stored with this shape:

```javascript
{
  id: "gemini-internal-id",     // From the edit page URL
  name: "Code Reviewer",        // From the input field
  description: "Reviews code",  // From #gem-description-input
  instructions: "You are...",   // Full text from .ql-editor
  knowledgeFiles: [             // From uploader-file-preview elements
    {
      name: "style-guide.pdf",
      type: "PDF",
      mimeType: "application/pdf",
      driveId: "1abc...",        // Added by Drive link capture
      driveUrl: "https://..."    // Added by Drive link capture
    }
  ],
  defaultTools: ["Code execution"],  // From bots-creation-default-tool-section
  extractedAt: "2026-04-05T14:30:00Z",
  source: "edit_page"
}
```

### 4.7 Drive Link Capture

Knowledge file Drive IDs are not present in the edit page DOM. To capture them, the extension programmatically opens the Google Drive viewer for each file, reads the file info, then closes it:

1. **Click the file preview chip** — the `[data-test-id="file-preview"]` element (or the `uploader-file-preview` fallback) that the user would click to open a file. This triggers the native Drive viewer overlay.
2. **Hide the viewer** — immediately set `opacity: 0` and `z-index: -1` on `div.drive-viewer.drive-viewer-overlay` so the user doesn't see it flash open. Never set `pointer-events: none` — that prevents the close button from working.
3. **Poll for `#drive-active-item-info`** — this hidden element contains a JSON object with `{ id, title, mimeType }`. Poll every 75ms for up to 6 seconds.
4. **Parse the file info** — extract `id`, build a canonical Drive URL using `buildDriveUrl(fileId, mimeType)` which produces URLs like `https://docs.google.com/spreadsheets/d/{id}` for Sheets, `https://docs.google.com/document/d/{id}` for Docs, etc.
5. **Close the viewer** — dispatch Escape key events on the viewer element, click the close button (`.drive-viewer-close-button[aria-label="Close"]`), and dispatch Escape on the parent as fallback.
6. **Wait for cleanup** — poll until the viewer element is removed from the DOM (up to 4 seconds, with a retry close at the halfway point). Never force-remove the DOM — Angular must manage its own lifecycle or subsequent viewer opens will break.
7. **Persist the link** — update the gem's `knowledgeFiles` in `chrome.storage.local` via `persistKnowledgeLink()` which sends `GET_ALL_GEMS` + `STORE_GEM` messages.

The `captureAllDriveLinks()` function processes files sequentially with a 600ms pause between captures to let Angular settle. An `onProgress` callback fires after each file for UI updates, and `onDone` fires when all files are processed.

**Critical constraint:** The Drive viewer must be closed via Escape key dispatch and/or close button click — never by force-removing the viewer DOM. Force removal corrupts Angular's component state and prevents subsequent viewer opens.

### 4.8 Storage

Extracted gems are accumulated in `chrome.storage.local` under the key `extractedGems`:

```json
{
  "extractedGems": {
    "gems": [...],
    "extractedAt": "2026-04-05T14:30:00Z",
    "strategy": "edit_page"
  }
}
```

Storage is **accumulated** across edit page visits — each gem is added or updated by ID (not overwritten). Previously captured Drive links are preserved when a gem is re-extracted: the content script merges old `driveId`/`driveUrl` values into the fresh extraction before storing.

Popup settings (API URL, user email) are stored separately under the key `gfSettings`.

## 5. UI / UX

### 5.1 Floating Action Button (FAB)

A circular button fixed to the bottom-right corner of the page:

- **Position:** `bottom: 24px; right: 24px; position: fixed; z-index: 10000`
- **Size:** 56px diameter (Material Design FAB standard)
- **Appearance:** Solid `#4285F4` Google blue background, white gem/diamond SVG icon.
- **Visibility:** Only shown on gem edit pages (`/gems/edit/*`). Hidden via `display: none` otherwise.
- **Hover state:** `transform: scale(1.1)` and increased box shadow.
- **States:**
  - **Idle:** Diamond icon. Click triggers extraction.
  - **Loading:** Spinner animation (CSS `gf-spin` rotation). FAB disabled during extraction.
  - **Success:** Green background (`#0f9d58`), checkmark icon for 1.5s, then reverts to idle.
  - **Error:** Red background (`#d93025`), X icon for 1.5s, then reverts to idle.

### 5.2 Full-Screen Modal Overlay

Triggered after extraction completes (FAB click → DOM extraction → store → overlay opens).

- **Backdrop:** Semi-transparent black (`rgba(0, 0, 0, 0.7)`), covering the entire viewport. Clicking the backdrop closes the overlay (unless Drive link capture is in progress).
- **Content panel:** Centered card, `max-width: 800px`, `max-height: 90vh`, white background, with:

  **Header:**
  - Title: "Gem Factory — Gem Saved" (or "Gem Updated" / "Error").
  - Gem name badge (blue pill).
  - Close button (X) in top-right.

  **Body:**
  - **Confirmation banner:** Green for new ("has been saved to your local gem list"), amber for update ("was already in your list and has been updated").
  - **Instructions preview:** First 300 characters of the instructions in a monospace block.
  - **Knowledge documents section:** List of extracted knowledge files with icon, name, mime type label, and per-item status indicator. A "Capture All Links" button triggers sequential silent Drive link capture (section 4.7), showing hourglass → checkmark/X status per file. Previously captured links display inline.
  - **Gem collection list:** All extracted gems (newest first), with the current gem highlighted.

  **Footer:**
  - "Copy JSON" — copies the gem's data (with Drive links) to clipboard, brief "Copied!" feedback.
  - "Close" — dismisses the overlay.

- **Escape key:** Closes the overlay (disabled during Drive link capture via `capturingLinks` flag).
- **Scroll lock:** Body `overflow: hidden` while the overlay is open.

### 5.3 Browser-Action Popup

The toolbar popup (`popup.html` + `popup.js`) provides a persistent view of all extracted gems and server communication:

- **Header:** "Gem Factory" title with gem count badge.
- **Settings section:** API Server URL input (default: `http://localhost:9090`) and email input. Persisted in `chrome.storage.local` under `gfSettings`.
- **Gem list:** All gems sorted newest-first, showing name, extraction date, instructions preview (2-line clamp), knowledge file names, and enabled tools. Each gem has a delete button.
- **Footer actions:**
  - "Save to Gem Factory" — POSTs all gems to `{apiUrl}/api/gems/import` with `X-Dev-User-Email` header. Shows success/error status messages with imported/updated/skipped counts.
  - "Copy JSON" — copies all gems as JSON to clipboard.
  - "Clear" — removes all stored gems.

### 5.4 User Workflow

1. User installs the extension (developer mode, "Load unpacked" from `extension/` directory).
2. User navigates to `gemini.google.com` and opens a gem for editing.
3. A blue circular FAB appears in the bottom-right corner.
4. User clicks the FAB.
5. FAB shows a spinner briefly while DOM fields are read.
6. Overlay appears with confirmation, instructions preview, and knowledge files.
7. User optionally clicks "Capture All Links" to grab Drive URLs for knowledge documents.
8. User closes the overlay, navigates to the next gem's edit page, and repeats.
9. When done, user clicks the extension toolbar icon to review all gems in the popup.
10. User clicks "Save to Gem Factory" in the popup to import gems to the API server.

## 6. Integration Points

### 6.1 SPA Communication

The background script's `chrome.runtime.onMessageExternal` handler responds to messages from the Gem Factory SPA:

```javascript
// SPA → Extension
chrome.runtime.sendMessage(EXTENSION_ID, { type: 'GET_GEMS' }, callback);
chrome.runtime.sendMessage(EXTENSION_ID, { type: 'CLEAR_GEMS' }, callback);
```

The `externally_connectable` manifest key restricts this to `http://localhost:3000/*` (the SPA dev server). The SPA uses the extension ID from its `VITE_EXTENSION_ID` environment variable.

### 6.2 Backend API (Popup)

The popup's "Save to Gem Factory" button sends gems to the API server:

- Endpoint: `POST {apiUrl}/api/gems/import`
- Auth: `X-Dev-User-Email` header (dev bypass mode)
- Payload: `{ gems: [{ name, description, instructions, icon, source, geminiId, knowledgeFiles, defaultTools, extractedAt }] }`
- Response handling: Shows imported/updated/skipped counts as a status message.

### 6.3 Dependencies

- **Runtime:** Chrome browser (or Chromium-based) with Manifest V3 support.
- **External services:** `gemini.google.com` — the extension depends on the Gemini web app's DOM structure for gem edit pages.
- **Libraries:** None. The extension uses only browser-native APIs (`chrome.storage`, `chrome.runtime`, DOM APIs). No build step, no bundler, no npm dependencies.

## 7. Edge Cases & Error Handling

### 7.1 Extraction Edge Cases

| Condition | Behavior |
|-----------|----------|
| Instructions not found in DOM | Shows error overlay: "Could not find gem instructions on this page. The page may still be loading — wait a moment and try again." |
| Gem name not found | Uses fallback name `"(unnamed)"`. |
| Gem has empty description | Valid state — `description` stored as empty string. |
| Knowledge files not present | `knowledgeFiles` stored as empty array. |
| No enabled tools | `defaultTools` stored as empty array. |
| Very long instructions | Overlay shows first 300 chars in preview. Full text stored in `chrome.storage.local`. |
| Gem instructions contain special characters / HTML | Instructions are read as plain text via `innerText`/`textContent`. Overlay uses `textContent` (not `innerHTML`) for display, preventing XSS. |

### 7.2 Drive Link Capture Edge Cases

| Condition | Behavior |
|-----------|----------|
| Drive viewer doesn't appear within 6 seconds | Capture times out, returns `null`. Status shows X for that file. |
| `#drive-active-item-info` element not found | Capture returns `null`. Status shows X. |
| JSON parse of file info fails | Capture returns `null`. Status shows X. |
| Drive viewer won't close | After 4 seconds, hides viewer with CSS and moves on. Angular state preserved. |
| File has no clickable preview element | Skipped, status shows X. |
| Re-extraction after previous capture | Previously captured `driveId`/`driveUrl` values are preserved via merge from stored data. |

### 7.3 Extension Lifecycle

| Condition | Behavior |
|-----------|----------|
| Extension installed but page already loaded | Content script injected at `document_idle`. FAB appears on next URL check cycle (within 500ms). |
| Gemini SPA navigates without full page reload | URL polling (`setInterval` at 500ms) detects the new URL and shows/hides the FAB accordingly. |
| Multiple Gemini tabs open | Each tab has its own content script instance. `chrome.storage.local` is shared, so gems from all tabs accumulate. |
| Extension updated while page is open | Chrome reloads the service worker. In-progress extractions may fail; the user should refresh the page. |

### 7.4 Popup / Server Communication Edge Cases

| Condition | Behavior |
|-----------|----------|
| API URL not configured | Shows error: "Please enter the API server URL." |
| Email not configured | Shows error: "Please enter your email address." |
| Server unreachable | Shows error with the fetch error message. |
| Server returns error | Shows error with the server's error message. |
| Save succeeds | Shows "Saved: N imported, N updated, N skipped" for 4 seconds. |

## 8. Scope & Milestones

### Milestone 1: Page Detection + FAB ✓

- Content script activates on `gemini.google.com`.
- URL polling to detect gem edit pages.
- FAB appears/disappears based on URL pattern.

### Milestone 2: DOM Extraction ✓

- Extract gem name, description, instructions from edit page form fields.
- Extract knowledge file names, types, and mime types from `uploader-file-preview` elements.
- Extract enabled tools from `bots-creation-default-tool-section`.
- Store gems in `chrome.storage.local` with accumulation (add/update by ID).
- Overlay shows confirmation, instructions preview, knowledge docs, and gem collection list.

### Milestone 3: Drive Link Capture ✓

- Silent Drive viewer open/capture/close for knowledge file IDs and URLs.
- Sequential capture with per-item progress feedback in the overlay.
- Drive link persistence across gem re-extractions.

### Milestone 4: SPA Communication ✓

- `GET_GEMS` and `CLEAR_GEMS` external message handlers.
- `externally_connectable` manifest configuration for `http://localhost:3000/*`.

### Milestone 5: Popup ✓

- Browser-action popup with gem list, delete, and status display.
- "Save to Gem Factory" sends gems to the API server.
- "Copy JSON" and "Clear" actions.
- Settings persistence (API URL, user email).

### Deferred

- Bulk extraction via API interception (would require a working API that returns full instructions).
- Selective gem extraction (user picks which gems to capture before overlay appears).
- Badge count on the extension icon showing number of extracted gems.
- Production auth (Google ID tokens instead of `X-Dev-User-Email` header).

## 9. Success Criteria

### Must pass

1. With the extension installed and the user on a gem edit page (`gemini.google.com/gems/edit/*`), a floating button appears in the bottom-right corner.
2. The button does not appear on non-edit Gemini pages (e.g., a regular chat, the gems list view).
3. Clicking the button extracts gem data from the DOM and displays a confirmation overlay within a few seconds.
4. The overlay shows the gem name, an instructions preview, and knowledge files (if any).
5. Each extracted gem includes `name`, `description`, `instructions`, `knowledgeFiles`, and `defaultTools` fields.
6. The `instructions` field contains the full system prompt text from the Quill editor (not truncated).
7. The overlay can be closed by clicking the backdrop, clicking the X button, clicking Close, or pressing Escape.
8. Gems accumulate in storage across edit page visits — extracting a new gem does not erase previously extracted gems.
9. If extraction fails (e.g., instructions not found), the overlay displays a meaningful error message.

### Should pass

10. "Capture All Links" in the overlay silently captures Drive file IDs and URLs for each knowledge document, showing per-item progress.
11. The FAB shows a loading spinner during extraction and a brief success/error indicator after.
12. The extension works after SPA navigation (e.g., user navigates from one edit page to another without a full page reload).
13. The popup shows all extracted gems with name, date, instructions preview, knowledge files, and tools.
14. The popup's "Save to Gem Factory" sends gems to the API server and displays the result.
15. Previously captured Drive links are preserved when a gem is re-extracted.

## 10. Open Questions (Resolved)

### Q1: Extraction strategy

**Resolved:** DOM extraction from edit pages. The `batchexecute` API truncates instructions, making it unsuitable. The edit page is the only reliable source for full gem data. The extension extracts one gem at a time as the user visits each edit page.

### Q2: Distribution

**Resolved:** Developer mode sideloading for now. The extension is loaded via `chrome://extensions` > "Load unpacked" > select `extension/` directory.

### Q3: Rate limiting / debouncing

**Resolved:** The FAB is disabled during extraction (set to `loading` state). Users cannot trigger concurrent extractions.

### Q4: Knowledge files

**Resolved:** File names, types, and mime types are extracted from the DOM. Drive file IDs and URLs are captured via the silent Drive viewer technique. The `knowledgeFiles` array includes `name`, `type`, `mimeType`, `driveId`, and `driveUrl` fields.

### Q5: Drive viewer close strategy

**Resolved:** Close via Escape key dispatch on the viewer element + close button click. Never force-remove the viewer DOM — this corrupts Angular's component state and breaks subsequent viewer opens. If the viewer doesn't close within 4 seconds, hide it with CSS and move on.
