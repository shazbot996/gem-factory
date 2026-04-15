# Executed: 2026-04-15T13:39:08.076018

You are a document maintenance agent performing a **Refresh** action — rewriting a published document in-place to match the current codebase.

## Your task

Read the document below and the actual codebase, then rewrite the document at its current path so that every fact, file reference, class name, function signature, and behavioral description matches the live code. Preserve the document's structure, voice, and front matter format.

## Document to refresh

- **Path:** `docs/specs/chrome-extension-gem-extractor-SPEC.md`
- **Type:** `spec`

<document>
---
type: spec
title: "Chrome Extension: Gem Extractor v1"
scope: Manifest V3 Chrome extension for extracting Gemini gem configurations
date: 2026-04-05
---

## 1. Problem Statement

Gem Factory needs to import users' personal Gemini gem configurations into a central registry, but Google provides no official API for reading gem data. Without an extraction mechanism, users would have to manually copy-paste each gem's name and instructions from the Gemini web app — a tedious process that discourages participation and produces inconsistent data.

The Chrome extension bridges this gap by running in the user's authenticated browser session on `gemini.google.com`, extracting gem configurations directly, and presenting them for review before any data leaves the browser. This is the critical path component that makes the entire Gem Factory system viable.

## 2. Goals & Non-Goals

### Goals

- Extract all of a user's custom gem configurations (name, description, instructions, ID) from the Gemini web app in a single action.
- Present extracted gem data to the user in a reviewable format before anything is sent externally.
- Activate only on relevant Gemini pages — invisible elsewhere.
- Implement two extraction strategies (API interception and direct API call) so that if one breaks, the other can serve as fallback.
- Produce a proof-of-concept that displays captured data as pretty-printed JSON in an overlay, verifying extraction works end-to-end.

### Non-Goals

- Sending gem data to the Gem Factory backend API. This version only extracts and displays — the import flow is a separate feature.
- Extracting knowledge files attached to gems (file contents are not accessible via the internal API; only file names may be visible).
- Modifying, creating, or deleting gems in the Gemini web app.
- Supporting browsers other than Chrome (or Chromium-based browsers that support Manifest V3).
- Extracting predefined/system gems (Google's built-in gems). Only user-created custom gems are in scope.
- Publishing to the public Chrome Web Store. Distribution is via the corporate Chrome Web Store or developer mode sideloading.

## 3. Proposed Solution

Build a Manifest V3 Chrome extension with two gem extraction strategies:

**Strategy A — Direct API Call (primary).** When the user clicks the floating action button, the extension makes its own `POST` request to Gemini's internal `batchexecute` endpoint using the session cookies already present in the browser. This returns all custom gems — including full instruction text — in a single request. This is the preferred approach because it retrieves complete data for all gems at once without requiring navigation to individual edit pages.

**Strategy B — Network Response Interception (fallback).** The extension uses `chrome.webRequest.onCompleted` to monitor network requests to `/_/BardChatUi/data/batchexecute`. When the Gemini app loads gem data (e.g., when the user navigates to the gems view), the extension captures the response and parses gem data from it. This is passive — it only works after the Gemini app itself triggers the request.

DOM scraping is deliberately **not** the primary strategy. Research shows the gems list page DOM displays only gem names and icons, not the full instruction text. Full instructions are only in the DOM on individual gem edit pages (inside a `.ql-editor` Quill editor element), which would require navigating to each gem individually. The internal API, by contrast, returns all gem data including instructions in a single batch call.

After extraction, the data is displayed in a full-screen modal overlay as pretty-printed JSON — a proof-of-concept to verify the extraction pipeline works before building the import flow.

## 4. Technical Design

### 4.1 Extension File Structure

```
extension/
  manifest.json           # Manifest V3 configuration
  background.js           # Service worker: API calls, message routing, storage
  content-script.js       # Injected on gemini.google.com: FAB, overlay, page detection
  styles.css              # Styles for the FAB and modal overlay
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
  "version": "0.1.0",
  "description": "Extract Gemini gem configurations for the Gem Factory registry",
  "permissions": [
    "storage",
    "activeTab"
  ],
  "host_permissions": [
    "https://gemini.google.com/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["https://gemini.google.com/*"],
      "js": ["content-script.js"],
      "css": ["styles.css"],
      "run_at": "document_idle"
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
- `host_permissions` on `gemini.google.com/*` enables the background service worker to make `fetch` calls to the Gemini API with the user's cookies (via `credentials: 'include'`). This is required for Strategy A.
- `activeTab` is included so the extension can interact with the current tab's content when the user invokes it.
- No `webRequest` or `webRequestBlocking` permission in v1. Strategy B (network interception) would use the content script's ability to monkey-patch `fetch`/`XMLHttpRequest` on the page rather than the `webRequest` API, since reading response bodies requires page-level access, not extension-level `webRequest` (which only sees headers in Manifest V3).

### 4.3 Gemini Internal API Details

All gem operations go through a single endpoint:

```
POST https://gemini.google.com/_/BardChatUi/data/batchexecute
```

**Request format:**
- Content-Type: `application/x-www-form-urlencoded;charset=utf-8`
- Body fields:
  - `at` — Access token (`SNlM0e` value, extracted from page source)
  - `f.req` — JSON-encoded nested array specifying the RPC call
- Query parameters: `hl`, `_reqid`, `rt=c`, `bl` (build label), `f.sid` (session ID)
- Required headers: `X-Same-Domain: 1`

**Listing custom gems:**

RPC ID: `CNgdBe`

Payload for custom (user-created) gems:
```
f.req=[["CNgdBe","[2,[\"en\"],0]",null,"generic"]]
```

The `2` in `[2,["en"],0]` specifies custom gems. (`3` = predefined excluding hidden, `4` = predefined including hidden.)

**Response format:**

The `batchexecute` response is a multi-line text format. After stripping the leading `)]}'` anti-XSSI prefix, the body contains length-prefixed JSON arrays. The relevant payload is a JSON string embedded within the outer array structure at a known position. When parsed, each gem appears as a nested array:

```
gem[0] = id (string, e.g., "4c69ba2dd01c")
gem[1][0] = name (string)
gem[1][1] = description (string, may be empty)
gem[2][0] = prompt/instructions (string, full system prompt text)
```

**Authentication tokens** required for direct API calls are embedded in the Gemini page's HTML source:

| Token | Purpose | Extraction method |
|-------|---------|-------------------|
| `SNlM0e` | Access token (CSRF-like) | Regex on page source: `"SNlM0e":"([^"]+)"` |
| `cfb2h` | Build label (`bl` query param) | Regex on page source: `"cfb2h":"([^"]+)"` |
| `FdrFJe` | Session ID (`f.sid` query param) | Regex on page source: `"FdrFJe":"([^"]+)"` |

### 4.4 Extraction Strategy A — Direct API Call

This runs in the **background service worker** (`background.js`), triggered by a message from the content script.

Flow:
1. Content script sends `{ type: 'EXTRACT_GEMS' }` to the background script.
2. Background script fetches `https://gemini.google.com/app` to obtain the page HTML (with cookies automatically attached since the extension has `host_permissions`).
3. Background script extracts `SNlM0e`, `cfb2h`, and `FdrFJe` tokens from the HTML using regex.
4. Background script sends the `batchexecute` POST with the `CNgdBe` RPC payload for custom gems.
5. Background script parses the response, extracting gem objects.
6. Background script sends the parsed gems back to the content script.

Why the background script and not the content script: The content script runs in the page's DOM context and could make fetch calls, but isolating API logic in the background script keeps the content script focused on UI and makes the API layer independently testable and replaceable.

### 4.5 Extraction Strategy B — Network Interception (Fallback)

This runs in the **content script** (`content-script.js`) by monkey-patching the page's `fetch` function.

Flow:
1. On page load, the content script injects a small script element into the page that wraps `window.fetch`.
2. The wrapper checks if the request URL contains `/_/BardChatUi/data/batchexecute` and the body contains `CNgdBe`.
3. When matched, the wrapper clones the response, reads it, parses the gem data, and posts it to the content script via `window.postMessage`.
4. The content script receives the parsed gems and stores them.

This strategy is passive — it only captures data when the Gemini app itself makes the list-gems request (e.g., when the user navigates to the gems view). It serves as a fallback if Google blocks direct API calls from extensions or changes the authentication token extraction.

### 4.6 Gem Data Model (Extension-Side)

```typescript
interface ExtractedGem {
  id: string;            // Gemini's internal gem ID
  name: string;          // User-given gem name
  description: string;   // Short description (may be empty)
  instructions: string;  // Full system prompt / instruction text
  extractedAt: string;   // ISO 8601 timestamp of extraction
  source: 'direct_api' | 'network_intercept';
}

interface ExtractionResult {
  gems: ExtractedGem[];
  extractedAt: string;
  userEmail?: string;    // If detectable from the page
  strategy: 'direct_api' | 'network_intercept';
  error?: string;
}
```

### 4.7 Response Parsing

The `batchexecute` response requires multi-step parsing:

1. Strip the `)]}'` anti-XSSI prefix (first line of response).
2. The remaining body contains length-prefixed chunks. Each chunk starts with a decimal number (byte count) followed by a newline, then the JSON payload of that length.
3. Find the chunk whose parsed JSON contains the `CNgdBe` RPC ID.
4. Within that chunk, the gem data is a JSON-encoded string nested inside the outer array. The string at position `[0][2]` of the chunk array is the inner payload to `JSON.parse` again.
5. The inner payload is an array of gem arrays, each with the structure described in section 4.3.

This parsing logic should be isolated in a dedicated `parseGemsFromBatchResponse(responseText)` function for testability and easy updates when the response format changes.

### 4.8 Page Detection

The content script must determine whether the user is on a relevant gems page before showing the FAB. Relevant URL patterns:

| Pattern | Page | FAB shown? |
|---------|------|------------|
| `gemini.google.com/app` | Main Gemini app (gems may be in sidebar) | Yes |
| `gemini.google.com/gems/view` | Gems library/list view | Yes |
| `gemini.google.com/gem/*` | Individual gem view | Yes |
| `gemini.google.com/gems/edit/*` | Gem edit page | Yes |
| `gemini.google.com/gems/create` | Gem creation page | No (nothing to extract yet) |
| Any other `gemini.google.com/*` path | Other pages | No |

Since Gemini is a single-page app with client-side routing, URL changes don't trigger full page loads. The content script must use a `MutationObserver` on `document.title` or poll `location.href` to detect navigation. A `setInterval` polling `location.href` every 500ms is the simplest reliable approach — SPA routers don't always fire `popstate` for all navigations.

### 4.9 Storage

Extracted gems are stored in `chrome.storage.local` under the key `extractedGems`:

```json
{
  "extractedGems": {
    "gems": [...],
    "extractedAt": "2026-04-05T14:30:00Z",
    "strategy": "direct_api"
  }
}
```

Storage is overwritten on each new extraction (not appended). The data persists until the next extraction or until the SPA clears it after a successful import (future feature).

## 5. UI / UX

### 5.1 Floating Action Button (FAB)

A circular button fixed to the bottom-right corner of the page:

- **Position:** `bottom: 24px; right: 24px; position: fixed; z-index: 10000`
- **Size:** 56px diameter (Material Design FAB standard)
- **Appearance:** Solid background color (Gem Factory brand color, e.g., `#4285F4` Google blue), white icon (a gem/diamond SVG icon or a simple download arrow)
- **Visibility:** Only shown when the content script detects the user is on a relevant gems page (see section 4.8). Hidden otherwise via `display: none`.
- **Hover state:** Slight scale-up (`transform: scale(1.1)`) and box shadow increase.
- **States:**
  - **Idle:** Default icon. Click triggers extraction.
  - **Loading:** Spinner animation replaces the icon while extraction is in progress.
  - **Success:** Brief checkmark icon (1.5s), then reverts to idle.
  - **Error:** Brief error icon (red X), then reverts to idle. Error details shown in the overlay.

### 5.2 Full-Screen Modal Overlay

Triggered on successful extraction (FAB click → extraction completes → overlay opens).

- **Backdrop:** Semi-transparent black (`rgba(0, 0, 0, 0.7)`), covering the entire viewport. Clicking the backdrop closes the overlay.
- **Content panel:** Centered card, `max-width: 800px`, `max-height: 90vh`, white background, with:
  - **Header:** "Gem Factory — Extracted Gems" title, gem count badge (e.g., "12 gems found"), close button (X) in top-right.
  - **Body:** Scrollable `<pre>` block containing the extracted gems as pretty-printed JSON (`JSON.stringify(gems, null, 2)`). Monospace font.
  - **Footer:** Two buttons:
    - "Copy to Clipboard" — copies the JSON to clipboard, brief "Copied!" feedback.
    - "Close" — dismisses the overlay.
- **Escape key:** Closes the overlay.
- **Scroll lock:** The page body should have `overflow: hidden` while the overlay is open to prevent background scrolling.

### 5.3 User Workflow

1. User installs the extension (corporate Chrome Web Store or developer mode).
2. User navigates to `gemini.google.com` and goes to their gems view.
3. A blue circular button appears in the bottom-right corner.
4. User clicks the button.
5. Button shows a spinner (1-3 seconds while the API call completes).
6. A full-screen overlay appears showing all extracted gems as formatted JSON.
7. User can review the data, copy it to clipboard, or close the overlay.

## 6. Integration Points

### 6.1 Future: SPA Communication

This v1 does not communicate with the Gem Factory SPA. The architecture document (`docs/context/ARCH.md`, section 7.2) defines the future messaging protocol:

```javascript
// SPA → Extension
chrome.runtime.sendMessage(EXTENSION_ID, { type: 'GET_GEMS' }, callback);
chrome.runtime.sendMessage(EXTENSION_ID, { type: 'CLEAR_GEMS' });
```

To support this in the future, the background script's message handler should already be structured to respond to these message types, returning data from `chrome.storage.local`. In v1, these handlers can exist but will only be exercised by the extension's own content script.

### 6.2 Future: Backend Import

The `ExtractedGem` data model (section 4.6) is designed to align with the backend's import payload shape (`docs/context/ARCH.md`, section 7.1):

```json
{ "name": "...", "instructions": "...", "icon": "...", "source": "extension" }
```

The `instructions` field in `ExtractedGem` maps directly to the backend's `instructions` field. The `source` field will be set to `"extension"` when sending to the backend.

### 6.3 Dependencies

- **Runtime:** Chrome browser (or Chromium-based) with Manifest V3 support.
- **External services:** `gemini.google.com` — the extension depends on the Gemini web app's internal `batchexecute` endpoint and its response format.
- **Libraries:** None. The extension uses only browser-native APIs (`fetch`, `chrome.storage`, `chrome.runtime`, DOM APIs). No build step, no bundler, no npm dependencies.

## 7. Edge Cases & Error Handling

### 7.1 Authentication / Session Issues

| Condition | Behavior |
|-----------|----------|
| User not logged into Gemini | Direct API call returns a redirect or error HTML. Extension detects non-JSON response, shows error: "Please sign in to Gemini first." |
| Session expired mid-extraction | `batchexecute` returns 401 or error payload. Extension shows error: "Your Gemini session has expired. Please refresh the page." |
| Multiple Google accounts | The extension's `fetch` uses the cookies for `gemini.google.com`, which correspond to whichever account the user has active in that browser profile. This is the correct behavior — it extracts gems for the account the user is currently using. |

### 7.2 API Response Changes

| Condition | Behavior |
|-----------|----------|
| Response format changes (parsing fails) | `parseGemsFromBatchResponse` throws. Extension catches the error, shows "Extraction failed — the Gemini page format may have changed. Try updating the extension." Falls back to Strategy B if Strategy A failed, or shows the error overlay if both fail. |
| RPC ID changes | Strategy A's direct call would return empty results. Strategy B's network interception would stop matching. Both failures surface as "No gems found" — the error message should distinguish between "you have no gems" and "extraction may have failed." |
| `SNlM0e` / token extraction fails | Extension cannot make the direct API call. Falls back to Strategy B. If Strategy B also has no data, shows error: "Could not authenticate with Gemini. Please refresh the page and try again." |

### 7.3 Empty and Boundary States

| Condition | Behavior |
|-----------|----------|
| User has zero gems | Extraction succeeds but returns empty array. Overlay shows: "No custom gems found in your Gemini account." |
| User has very many gems (100+) | The `batchexecute` response may be large. No pagination is expected from the API (it returns all gems). The JSON display in the overlay should handle large payloads gracefully (the `<pre>` block is scrollable). |
| Gem has empty instructions | Valid state — some gems may be stubs. Include in results with `instructions: ""`. |
| Gem instructions contain special characters / HTML | Instructions are plain text from the API. The overlay uses `textContent` (not `innerHTML`) to display within the `<pre>` block, preventing XSS. |

### 7.4 Extension Lifecycle

| Condition | Behavior |
|-----------|----------|
| Extension installed but page already loaded | Content script injected at `document_idle`. FAB appears on next URL check cycle (within 500ms). |
| Gemini SPA navigates without full page reload | URL polling (`setInterval` at 500ms) detects the new URL and shows/hides the FAB accordingly. |
| Multiple Gemini tabs open | Each tab has its own content script instance. Extraction in one tab does not affect others. `chrome.storage.local` is shared, so the last extraction wins. |
| Extension updated while page is open | Chrome reloads the service worker. In-progress extractions may fail; the user should refresh the page. |

## 8. Scope & Milestones

### Milestone 1: Page Detection + FAB (smallest shippable slice)

- Content script that activates on `gemini.google.com`.
- URL polling to detect gems-related pages.
- FAB appears/disappears based on page detection.
- Clicking FAB shows a placeholder overlay ("Extraction not yet implemented").

### Milestone 2: Strategy A — Direct API Extraction

- Background script extracts `SNlM0e`, `cfb2h`, `FdrFJe` tokens from page HTML.
- Background script makes `batchexecute` POST for custom gems.
- Response parser extracts gem objects (id, name, description, instructions).
- Overlay displays extracted gems as pretty-printed JSON.
- Error handling for auth failures and parse errors.

### Milestone 3: Strategy B — Network Interception Fallback

- Content script injects a fetch wrapper into the page.
- Wrapper captures `batchexecute` responses containing `CNgdBe` data.
- Parsed gems are stored and available as fallback when Strategy A fails.
- FAB click tries Strategy A first; if it fails, uses cached Strategy B data.

### Milestone 4: Polish

- Loading, success, and error states on the FAB.
- Copy-to-clipboard on the overlay.
- Storage of extracted gems in `chrome.storage.local`.
- Keyboard shortcut to close the overlay (Escape).

### Deferred to v2

- Communication with the Gem Factory SPA (`GET_GEMS` / `CLEAR_GEMS` messages).
- Selective gem extraction (user picks which gems to include).
- Badge count on the extension icon showing number of extracted gems.
- Extraction of knowledge file names attached to gems.

## 9. Success Criteria

### Must pass

1. With the extension installed and the user on `gemini.google.com/gems/view` (or the main app page with gems visible), a floating button appears in the bottom-right corner.
2. The button does not appear on non-gems Gemini pages (e.g., a regular chat).
3. Clicking the button triggers gem extraction and displays a modal overlay within 5 seconds.
4. The overlay shows a JSON array containing all of the user's custom gems.
5. Each gem object in the JSON includes `id`, `name`, `description`, and `instructions` fields.
6. The `instructions` field contains the full system prompt text (not truncated, not empty for gems that have instructions).
7. The overlay can be closed by clicking the backdrop, clicking the X button, or pressing Escape.
8. If the user has no custom gems, the overlay displays an appropriate empty-state message.
9. If extraction fails (e.g., user not logged in), the overlay displays a meaningful error message rather than crashing silently.

### Should pass

10. "Copy to Clipboard" button works and provides visual feedback.
11. The FAB shows a loading spinner during extraction and a brief success/error indicator after.
12. The extension works after SPA navigation (e.g., user navigates from a chat to the gems page without a full page reload).
13. Strategy B (network interception) captures gem data when the user navigates to the gems view, and this data is available as a fallback if Strategy A fails.

## 10. Open Questions

### Q1: Token extraction reliability

The `SNlM0e`, `cfb2h`, and `FdrFJe` tokens are extracted via regex from the Gemini page's HTML. If Google changes the format of how these tokens are embedded (e.g., switches from inline JSON to a separate script tag or obfuscates them), Strategy A will break. **Mitigation:** Strategy B (network interception) does not need these tokens. The fallback path should be robust.

**Decision needed:** Should Strategy A fetch `gemini.google.com/app` fresh to extract tokens, or should it ask the content script to extract them from the already-loaded page DOM? Fetching fresh is simpler (no message passing) but adds a network round-trip. Extracting from the DOM is faster but requires the content script to find the tokens in script tags or `window` variables.

**Recommendation:** Fetch fresh in the background script. The extra round-trip (~200ms) is negligible for a user-initiated action, and it avoids coupling the background script to the DOM structure.

### Q2: Corporate Chrome Web Store vs. sideloading

For initial testing, the extension can be sideloaded via developer mode. For broader rollout, it should be published to the corporate (private) Chrome Web Store and force-installed via Chrome management policy. This decision affects the extension ID (which the SPA will need for future messaging).

**Recommendation:** Start with sideloading for development. Publish to corporate Chrome Web Store before broader rollout. Document the extension ID once it's assigned.

### Q3: Rate limiting on batchexecute

It's unknown whether Google rate-limits the `batchexecute` endpoint per session. Since the extension only makes one call per user-initiated click, this is unlikely to be a problem. But if users click rapidly, the extension should debounce and not fire concurrent requests.

**Recommendation:** Disable the FAB while an extraction is in progress. Ignore clicks until the current extraction completes or times out (10 second timeout).

### Q4: Gems with knowledge files

The internal API may return references to knowledge files (uploaded documents) attached to gems. The v1 extension does not extract file contents (and likely cannot — they may be stored in a separate system). However, file names/references visible in the API response could be captured as metadata.

**Recommendation:** If file references appear in the API response during implementation, include them in the extracted data as a `knowledgeFiles: string[]` array of file names. Do not attempt to download the files.
</document>

## Instructions

1. **Read the actual code.** Use your tools to explore files, grep for patterns, and read implementations. Do not rely solely on the embedded content — verify everything against the live codebase.
2. **Preserve structure.** Keep the same section headings, organizational hierarchy, and writing style. Do not reorganize the document unless a section is entirely obsolete.
3. **Update facts.** Fix file paths, class/function names, line number references, behavioral descriptions, configuration values, and any other claims that have drifted from reality.
4. **Add missing coverage.** If new modules, classes, or features fall within the document's stated scope and are not documented, add them in the appropriate section. Follow the existing style for new entries.
5. **Remove obsolete content.** If the document describes code that no longer exists, remove those references. Do not leave stale descriptions with "removed" annotations — just take them out cleanly.
6. **Update front matter.** Set the `date` field to today's date. Keep all other front matter fields intact (update `title` or `scope` only if they are factually wrong).

## Output

Overwrite the file at `docs/specs/chrome-extension-gem-extractor-SPEC.md` with the refreshed content. Do not create a new file — write directly to the existing path. Git provides rollback if needed.

## Guidelines

- **Do not invent.** Only document what actually exists in the codebase. If you are unsure whether something exists, read the code to verify before including it.
- **Be specific.** Reference actual file paths, class names, and function names — the same level of specificity as the original document.
- **Maintain voice.** If the document uses a formal tone, keep it formal. If it uses concise bullet points, keep that style. Match the original author's approach.
- **Minimize churn.** Do not rewrite paragraphs that are already accurate. Only change what needs changing. This makes the git diff reviewable.
- **Keep it maintainable.** Write at the right level of abstraction — enough detail to be useful, not so much that it goes stale immediately.

