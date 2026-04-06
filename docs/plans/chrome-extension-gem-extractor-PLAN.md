---
type: plan
title: "Chrome Extension: Gem Extractor v1 — Implementation Plan"
spec: docs/specs/chrome-extension-gem-extractor-SPEC.md
scope: Build the complete Manifest V3 Chrome extension for extracting Gemini gem configurations
date: 2026-04-05
---

## 1. Goal

Implement a Manifest V3 Chrome extension that extracts users' custom Gemini gem configurations (name, description, instructions, ID, and knowledge file references) from `gemini.google.com` and displays them as reviewable JSON in a full-screen overlay. This is the critical-path component that makes the Gem Factory registry viable by bridging the gap left by the absence of an official Gemini gems API. The extension implements two extraction strategies (direct API call as primary, network interception as fallback) and is distributed via developer-mode sideloading.

Spec: [`docs/specs/chrome-extension-gem-extractor-SPEC.md`](../specs/chrome-extension-gem-extractor-SPEC.md)

## 2. Context & Prior Art

### Existing codebase

The Gem Factory project currently has no frontend or extension code. The codebase consists of:

- `docs/context/ARCH.md` — Architecture document defining the extension's role (section 3.1), the SPA ↔ extension messaging protocol (section 7.2), and the backend import payload shape (section 7.1).
- `docs/specs/chrome-extension-gem-extractor-SPEC.md` — Detailed spec for this extension (the source of this plan).
- `voicecode-bbs/` — An unrelated Python curses application (VoiceCode BBS). No patterns to reuse.
- `voicecode-bbs/workflow.jsx` — A React component using Tailwind CSS. Not directly relevant but shows the project uses blue (#4285F4) as a primary UI color.

### Key architecture constraints (from ARCH.md)

- The extension communicates with the future SPA via `chrome.runtime.sendMessage(EXTENSION_ID, { type: 'GET_GEMS' | 'CLEAR_GEMS' })` (ARCH.md section 7.2).
- The backend import payload is `{ gems: [{ name, instructions, icon?, source }] }` (ARCH.md section 7.1).
- The extension stores data in `chrome.storage.local` and has no backend dependencies.

### Dependencies

- **Runtime:** Chrome (or Chromium) with Manifest V3 support.
- **External services:** `gemini.google.com` internal `batchexecute` endpoint.
- **Libraries:** None. Pure browser-native APIs. No build step.

### Files to create

All files live under a new `extension/` directory at the project root:

```
extension/
  manifest.json
  background.js
  content-script.js
  styles.css
  icons/
    icon-16.png
    icon-48.png
    icon-128.png
```

## 3. Implementation Steps

The steps follow the spec's milestone ordering: foundation first (manifest, page detection, FAB), then Strategy A (direct API), then Strategy B (network interception fallback), then polish.

---

### Phase 1: Manifest, Page Detection & FAB

#### Step 1: Create the extension directory and manifest

**What:** Create `extension/manifest.json` with the Manifest V3 configuration.

**Where:** `extension/manifest.json`

**How:**
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

Key decisions per spec section 4.2:
- `host_permissions` on `gemini.google.com/*` enables the background service worker to make credentialed `fetch` calls (Strategy A).
- `activeTab` for interacting with the current tab.
- No `webRequest` permission — Strategy B uses page-level fetch monkey-patching instead.

#### Step 2: Create placeholder icon files

**What:** Create simple placeholder PNG icons at 16x16, 48x48, and 128x128.

**Where:** `extension/icons/icon-16.png`, `extension/icons/icon-48.png`, `extension/icons/icon-128.png`

**How:** Generate minimal solid-color placeholder PNGs (e.g., a blue square with a white diamond/gem shape). These can be created with any image tool or as base64-encoded minimal PNGs written to files. For initial development, even 1x1 scaled PNGs are acceptable — Chrome will display them in the extensions page and toolbar.

**Why:** Chrome requires icons to load the extension. Placeholders unblock development; final icons come in polish phase.

#### Step 3: Create the content script with page detection and FAB

**What:** Create `extension/content-script.js` with URL-based page detection and a floating action button.

**Where:** `extension/content-script.js`

**How:**

Implement three concerns in this file:

**3a. Page detection** (spec section 4.8):

```javascript
const GEMS_URL_PATTERNS = [
  /^https:\/\/gemini\.google\.com\/app\b/,
  /^https:\/\/gemini\.google\.com\/gems\/view\b/,
  /^https:\/\/gemini\.google\.com\/gem\/.+/,
  /^https:\/\/gemini\.google\.com\/gems\/edit\/.+/
];

const EXCLUDED_PATTERNS = [
  /^https:\/\/gemini\.google\.com\/gems\/create\b/
];

function isGemsPage(url) {
  if (EXCLUDED_PATTERNS.some(p => p.test(url))) return false;
  return GEMS_URL_PATTERNS.some(p => p.test(url));
}
```

Use `setInterval` polling at 500ms on `location.href` to detect SPA navigation (spec section 4.8 rationale: SPA routers don't always fire `popstate`). Track `lastUrl` to avoid redundant work:

```javascript
let lastUrl = '';
setInterval(() => {
  const currentUrl = location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    updateFabVisibility();
  }
}, 500);
```

**3b. FAB creation and management** (spec section 5.1):

Create the FAB element once on script load. Toggle `display: none` vs `display: flex` based on `isGemsPage()`. The FAB is a `<button>` element appended to `document.body`:

```javascript
function createFab() {
  const fab = document.createElement('button');
  fab.id = 'gem-factory-fab';
  fab.innerHTML = /* gem/diamond SVG icon */;
  fab.addEventListener('click', handleFabClick);
  document.body.appendChild(fab);
  return fab;
}
```

**3c. FAB click handler** (placeholder for Phase 1):

```javascript
async function handleFabClick() {
  setFabState('loading');
  try {
    const result = await chrome.runtime.sendMessage({ type: 'EXTRACT_GEMS' });
    if (result.error) {
      setFabState('error');
      showOverlay({ error: result.error });
    } else {
      setFabState('success');
      showOverlay(result);
    }
  } catch (err) {
    setFabState('error');
    showOverlay({ error: err.message });
  }
}
```

For Phase 1 (before Strategy A is implemented), the `showOverlay` call can display a placeholder message: "Extraction not yet implemented."

**3d. FAB state management:**

```javascript
function setFabState(state) {
  // state: 'idle' | 'loading' | 'success' | 'error'
  // Swap innerHTML between icon SVGs / spinner / checkmark / X
  // For 'success' and 'error': revert to 'idle' after 1500ms
}
```

#### Step 4: Create the styles

**What:** Create `extension/styles.css` with FAB and overlay styles.

**Where:** `extension/styles.css`

**How:** Implement all styles from spec sections 5.1 and 5.2:

```css
/* FAB - spec section 5.1 */
#gem-factory-fab {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 10000;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: none;
  background: #4285F4;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

#gem-factory-fab:hover {
  transform: scale(1.1);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

/* Overlay backdrop - spec section 5.2 */
#gem-factory-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.7);
  z-index: 10001;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Overlay content panel */
#gem-factory-overlay .gf-panel {
  background: white;
  border-radius: 12px;
  max-width: 800px;
  width: 90%;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Header, body, footer, pre block, buttons */
/* ... (full implementation per spec section 5.2) */
```

Include a spinner animation for the loading state:
```css
@keyframes gf-spin {
  to { transform: rotate(360deg); }
}
#gem-factory-fab.loading svg {
  animation: gf-spin 1s linear infinite;
}
```

#### Step 5: Create the overlay UI in the content script

**What:** Add overlay creation and management functions to `content-script.js`.

**Where:** `extension/content-script.js` (additions to the file from Step 3)

**How:**

```javascript
function showOverlay(result) {
  removeOverlay(); // Remove any existing overlay

  const overlay = document.createElement('div');
  overlay.id = 'gem-factory-overlay';

  const panel = document.createElement('div');
  panel.className = 'gf-panel';

  // Header
  const header = document.createElement('div');
  header.className = 'gf-header';
  // Title, gem count badge, close button (X)

  // Body
  const body = document.createElement('div');
  body.className = 'gf-body';

  if (result.error) {
    body.textContent = result.error;
  } else if (!result.gems || result.gems.length === 0) {
    body.textContent = 'No custom gems found in your Gemini account.';
  } else {
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(result.gems, null, 2); // textContent, not innerHTML — XSS safe
    body.appendChild(pre);
  }

  // Footer with "Copy to Clipboard" and "Close" buttons
  const footer = document.createElement('div');
  footer.className = 'gf-footer';
  // Copy button with "Copied!" feedback
  // Close button

  panel.append(header, body, footer);
  overlay.appendChild(panel);

  // Click backdrop to close
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) removeOverlay();
  });

  // Escape key to close
  document.addEventListener('keydown', handleEscapeKey);

  // Lock body scroll
  document.body.style.overflow = 'hidden';

  document.body.appendChild(overlay);
}

function removeOverlay() {
  const existing = document.getElementById('gem-factory-overlay');
  if (existing) existing.remove();
  document.body.style.overflow = '';
  document.removeEventListener('keydown', handleEscapeKey);
}

function handleEscapeKey(e) {
  if (e.key === 'Escape') removeOverlay();
}
```

**Why:** Using `textContent` for the JSON display (not `innerHTML`) prevents XSS from gem instructions containing HTML (spec section 7.3).

#### Step 6: Create the background script skeleton

**What:** Create `extension/background.js` with message routing.

**Where:** `extension/background.js`

**How:**

```javascript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXTRACT_GEMS') {
    extractGems()
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message }));
    return true; // Keep message channel open for async response
  }
});

// Also listen for external messages (future SPA communication, ARCH.md section 7.2)
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_GEMS') {
    chrome.storage.local.get('extractedGems', (data) => {
      sendResponse(data.extractedGems || { gems: [] });
    });
    return true;
  }
  if (message.type === 'CLEAR_GEMS') {
    chrome.storage.local.remove('extractedGems', () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

async function extractGems() {
  // Placeholder — implemented in Phase 2
  return { error: 'Extraction not yet implemented.' };
}
```

**Why:** Setting up `onMessageExternal` now (even though the SPA doesn't exist yet) follows the spec's recommendation in section 6.1 to structure the handler for future use.

---

### Phase 2: Strategy A — Direct API Extraction

#### Step 7: Implement token extraction from Gemini page HTML

**What:** Add a function to `background.js` that fetches the Gemini app page and extracts authentication tokens.

**Where:** `extension/background.js`

**How:**

```javascript
async function fetchTokens() {
  const response = await fetch('https://gemini.google.com/app', {
    credentials: 'include'
  });

  if (!response.ok) {
    throw new Error('Please sign in to Gemini first.');
  }

  const html = await response.text();

  // Check for non-HTML (redirect to login)
  if (!html.includes('SNlM0e')) {
    throw new Error('Please sign in to Gemini first.');
  }

  const snlm0e = html.match(/"SNlM0e":"([^"]+)"/)?.[1];
  const cfb2h = html.match(/"cfb2h":"([^"]+)"/)?.[1];
  const fdrfje = html.match(/"FdrFJe":"([^"]+)"/)?.[1];

  if (!snlm0e) {
    throw new Error('Could not authenticate with Gemini. Please refresh the page and try again.');
  }

  return { snlm0e, cfb2h, fdrfje };
}
```

**Decision:** Per the user's answer to open question Q1, we fetch the page fresh from the background script rather than extracting tokens from the content script's DOM. The ~200ms round-trip is acceptable for a user-initiated action.

#### Step 8: Implement the batchexecute API call

**What:** Add a function to `background.js` that calls the Gemini `batchexecute` endpoint for custom gems.

**Where:** `extension/background.js`

**How:**

```javascript
async function callBatchExecute(tokens) {
  const params = new URLSearchParams({
    'rpcids': 'CNgdBe',
    'hl': 'en',
    '_reqid': String(Math.floor(Math.random() * 900000) + 100000),
    'rt': 'c'
  });
  if (tokens.cfb2h) params.set('bl', tokens.cfb2h);
  if (tokens.fdrfje) params.set('f.sid', tokens.fdrfje);

  const body = new URLSearchParams({
    'at': tokens.snlm0e,
    'f.req': JSON.stringify([['CNgdBe', '[2,["en"],0]', null, 'generic']])
  });

  const response = await fetch(
    `https://gemini.google.com/_/BardChatUi/data/batchexecute?${params}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        'X-Same-Domain': '1'
      },
      credentials: 'include',
      body: body.toString()
    }
  );

  if (response.status === 401) {
    throw new Error('Your Gemini session has expired. Please refresh the page.');
  }

  if (!response.ok) {
    throw new Error(`Gemini API returned status ${response.status}.`);
  }

  return await response.text();
}
```

#### Step 9: Implement response parsing

**What:** Add the `parseGemsFromBatchResponse(responseText)` function.

**Where:** `extension/background.js`

**How:** Per spec section 4.7:

```javascript
function parseGemsFromBatchResponse(responseText) {
  // Step 1: Strip anti-XSSI prefix
  const lines = responseText.split('\n');
  let startIndex = 0;
  if (lines[0].trim().startsWith(')]}\' ') || lines[0].trim() === ')]}\'') {
    startIndex = 1;
  }

  // Step 2: Parse length-prefixed chunks
  const chunks = [];
  let i = startIndex;
  while (i < lines.length) {
    const lengthLine = lines[i].trim();
    if (/^\d+$/.test(lengthLine)) {
      const byteCount = parseInt(lengthLine, 10);
      // Collect subsequent lines until we have enough bytes
      i++;
      let chunkText = '';
      while (i < lines.length && chunkText.length < byteCount) {
        chunkText += lines[i] + '\n';
        i++;
      }
      try {
        chunks.push(JSON.parse(chunkText.trim()));
      } catch {
        // Not valid JSON — skip
      }
    } else {
      i++;
    }
  }

  // Step 3: Find the chunk containing CNgdBe response
  const gemChunk = chunks.find(chunk =>
    Array.isArray(chunk) && JSON.stringify(chunk).includes('CNgdBe')
  );

  if (!gemChunk) {
    return [];
  }

  // Step 4: Extract the inner payload
  // The gem data string is at position [0][2] of the chunk array
  const innerPayloadStr = gemChunk[0]?.[2];
  if (!innerPayloadStr || typeof innerPayloadStr !== 'string') {
    return [];
  }

  const innerPayload = JSON.parse(innerPayloadStr);

  // Step 5: Map gem arrays to ExtractedGem objects
  // innerPayload is an array of gem arrays
  const gemArrays = Array.isArray(innerPayload) ? innerPayload : [];
  const now = new Date().toISOString();

  return gemArrays
    .filter(gem => Array.isArray(gem) && gem[0]) // Filter out malformed entries
    .map(gem => ({
      id: gem[0] || '',
      name: gem[1]?.[0] || '',
      description: gem[1]?.[1] || '',
      instructions: gem[2]?.[0] || '',
      knowledgeFiles: extractKnowledgeFiles(gem),
      extractedAt: now,
      source: 'direct_api'
    }));
}

function extractKnowledgeFiles(gemArray) {
  // Knowledge file references may appear at various positions in the gem array.
  // Inspect the structure during development and extract file names/references.
  // Return an array of file name strings, or empty array if none found.
  // This is a best-effort extraction — the exact position depends on the API response structure.
  // TODO: Determine exact array position during live testing.
  return [];
}
```

**Why:** The parser is isolated in its own function per spec section 4.7 ("for testability and easy updates when the response format changes"). The `extractKnowledgeFiles` function is stubbed — per the user's decision on Q4, we capture file references when they appear in the API response.

#### Step 10: Wire up the full extraction flow in background.js

**What:** Implement the `extractGems()` function that ties together token extraction, API call, and parsing.

**Where:** `extension/background.js` — replace the placeholder from Step 6.

**How:**

```javascript
let extractionInProgress = false;

async function extractGems() {
  if (extractionInProgress) {
    return { error: 'Extraction already in progress.' };
  }

  extractionInProgress = true;
  try {
    // Strategy A: Direct API call
    const tokens = await fetchTokens();
    const responseText = await callBatchExecute(tokens);
    const gems = parseGemsFromBatchResponse(responseText);

    const result = {
      gems,
      extractedAt: new Date().toISOString(),
      strategy: 'direct_api'
    };

    // Store in chrome.storage.local
    await chrome.storage.local.set({ extractedGems: result });

    return result;
  } catch (strategyAError) {
    // Strategy A failed — try to use cached Strategy B data
    const cached = await chrome.storage.local.get('interceptedGems');
    if (cached.interceptedGems && cached.interceptedGems.gems.length > 0) {
      return cached.interceptedGems;
    }

    // Both strategies failed
    return {
      error: strategyAError.message ||
        'Extraction failed. Please refresh the Gemini page and try again.',
      gems: []
    };
  } finally {
    extractionInProgress = false;
  }
}
```

**Why:** The `extractionInProgress` guard implements debouncing per the spec's answer to Q3 (disable FAB while extraction is in progress / 10-second timeout). A timeout should also be added:

```javascript
// Add timeout wrapper
function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
  ]);
}

// In extractGems:
const tokens = await withTimeout(fetchTokens(), 10000, 'Request timed out.');
```

---

### Phase 3: Strategy B — Network Interception Fallback

#### Step 11: Implement fetch monkey-patching in the content script

**What:** Add network interception logic to `content-script.js` that captures `batchexecute` responses.

**Where:** `extension/content-script.js`

**How:** Per spec section 4.5, inject a script element into the page to wrap `window.fetch`:

```javascript
function injectFetchInterceptor() {
  const script = document.createElement('script');
  script.textContent = `
    (function() {
      const originalFetch = window.fetch;
      window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        try {
          const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
          const body = args[1]?.body || '';
          if (url.includes('/_/BardChatUi/data/batchexecute') &&
              typeof body === 'string' && body.includes('CNgdBe')) {
            const clone = response.clone();
            clone.text().then(text => {
              window.postMessage({
                type: 'GEM_FACTORY_INTERCEPT',
                payload: text
              }, '*');
            });
          }
        } catch (e) {
          // Silently ignore interception errors
        }
        return response;
      };
    })();
  `;
  (document.head || document.documentElement).appendChild(script);
  script.remove(); // Clean up the script tag
}
```

Then listen for the `postMessage` in the content script:

```javascript
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== 'GEM_FACTORY_INTERCEPT') return;

  // Send the raw response text to the background script for parsing
  chrome.runtime.sendMessage({
    type: 'INTERCEPTED_BATCH_RESPONSE',
    payload: event.data.payload
  });
});
```

Call `injectFetchInterceptor()` once on content script load.

#### Step 12: Handle intercepted data in the background script

**What:** Add a message handler in `background.js` for intercepted network data.

**Where:** `extension/background.js`

**How:**

```javascript
// In the onMessage listener, add:
if (message.type === 'INTERCEPTED_BATCH_RESPONSE') {
  try {
    const gems = parseGemsFromBatchResponse(message.payload);
    if (gems.length > 0) {
      const result = {
        gems,
        extractedAt: new Date().toISOString(),
        strategy: 'network_intercept'
      };
      chrome.storage.local.set({ interceptedGems: result });
    }
  } catch (e) {
    // Silently ignore parse failures from interception
  }
  // No sendResponse needed — this is fire-and-forget
}
```

**Why:** Intercepted data is stored under a separate key (`interceptedGems`) from the direct API data (`extractedGems`) so they don't overwrite each other. The extraction flow in Step 10 already falls back to `interceptedGems` when Strategy A fails.

---

### Phase 4: Polish & Knowledge Files

#### Step 13: Implement FAB state transitions

**What:** Complete the visual state management for the FAB (loading spinner, success checkmark, error X).

**Where:** `extension/content-script.js`, `extension/styles.css`

**How:**

Define SVG icons for each state as string constants:

```javascript
const ICONS = {
  idle: '<svg>...</svg>',      // Gem/diamond icon
  loading: '<svg>...</svg>',   // Circular spinner
  success: '<svg>...</svg>',   // Checkmark
  error: '<svg>...</svg>'      // X mark
};

function setFabState(state) {
  const fab = document.getElementById('gem-factory-fab');
  if (!fab) return;

  fab.className = state; // CSS uses this for animation
  fab.innerHTML = ICONS[state];
  fab.disabled = (state === 'loading');

  if (state === 'success' || state === 'error') {
    setTimeout(() => setFabState('idle'), 1500);
  }
}
```

Add CSS for the error state (red background on the X icon):
```css
#gem-factory-fab.error { background: #d93025; }
```

#### Step 14: Implement Copy to Clipboard

**What:** Wire up the "Copy to Clipboard" button in the overlay with visual feedback.

**Where:** `extension/content-script.js`

**How:**

```javascript
copyButton.addEventListener('click', async () => {
  const pre = document.querySelector('#gem-factory-overlay pre');
  if (!pre) return;
  await navigator.clipboard.writeText(pre.textContent);
  copyButton.textContent = 'Copied!';
  setTimeout(() => { copyButton.textContent = 'Copy to Clipboard'; }, 2000);
});
```

#### Step 15: Implement knowledge file extraction

**What:** Flesh out the `extractKnowledgeFiles` function based on actual API response structure.

**Where:** `extension/background.js`

**How:** This requires live testing against the Gemini API to determine the exact array position of knowledge file references. The implementation pattern:

```javascript
function extractKnowledgeFiles(gemArray) {
  // During development, log the full gem array to inspect structure:
  // console.log('Gem array structure:', JSON.stringify(gemArray));

  // Expected: file references appear as an array of [fileName, fileId?, ...] tuples
  // at a specific index in the gem array (e.g., gem[3] or gem[4]).
  // Exact index TBD during live testing.

  const fileRefs = gemArray[/* TBD index */];
  if (!Array.isArray(fileRefs)) return [];

  return fileRefs
    .filter(ref => Array.isArray(ref) && ref[0])
    .map(ref => ({
      name: ref[0],
      id: ref[1] || null
    }));
}
```

**Why:** Per the user's answer to Q4, we definitely capture file references and present them so users can take action on them. The exact array position must be determined empirically.

#### Step 16: Update the overlay to display knowledge files

**What:** Enhance the overlay to show knowledge file references for each gem.

**Where:** `extension/content-script.js`

**How:** The JSON display already includes `knowledgeFiles` in the gem objects. No additional UI changes are strictly needed since the spec's v1 overlay is pretty-printed JSON. However, for clarity, ensure the `knowledgeFiles` array is included in the output:

```javascript
// In the gem mapping (already part of parseGemsFromBatchResponse):
// knowledgeFiles: extractKnowledgeFiles(gem)
// This is already included in the JSON.stringify output.
```

If the knowledge files should be more prominent (beyond just appearing in the JSON), a future enhancement could add a visual list. For v1, inclusion in the JSON output satisfies the requirement.

#### Step 17: Distinguish "no gems" from "extraction failed"

**What:** Ensure error messages differentiate between a user having zero gems and extraction failure.

**Where:** `extension/background.js`, `extension/content-script.js`

**How:** In `extractGems()`, when the API call succeeds but returns zero gems:

```javascript
const result = {
  gems,
  extractedAt: new Date().toISOString(),
  strategy: 'direct_api',
  empty: gems.length === 0 // Explicit flag
};
```

In the overlay:
```javascript
if (result.error) {
  body.textContent = result.error;
} else if (result.empty || result.gems.length === 0) {
  body.textContent = 'No custom gems found in your Gemini account.';
} else {
  // Show JSON
}
```

This distinguishes a successful-but-empty response from a failed extraction (which would have `result.error` set).

---

## 4. Data Model / Schema Changes

### Extension-side data model (no database — all in chrome.storage.local)

```typescript
// From spec section 4.6, extended with knowledgeFiles per Q4 decision
interface ExtractedGem {
  id: string;                          // Gemini's internal gem ID
  name: string;                        // User-given gem name
  description: string;                 // Short description (may be empty)
  instructions: string;                // Full system prompt text
  knowledgeFiles: KnowledgeFileRef[];  // File references (Q4 decision)
  extractedAt: string;                 // ISO 8601 timestamp
  source: 'direct_api' | 'network_intercept';
}

interface KnowledgeFileRef {
  name: string;       // File name
  id: string | null;  // File ID if available
}

interface ExtractionResult {
  gems: ExtractedGem[];
  extractedAt: string;
  strategy: 'direct_api' | 'network_intercept';
  empty?: boolean;     // True when API succeeded but returned 0 gems
  error?: string;
}
```

### Storage keys in chrome.storage.local

| Key | Type | Written by | Purpose |
|-----|------|-----------|---------|
| `extractedGems` | `ExtractionResult` | Strategy A (direct API) | Primary extraction result |
| `interceptedGems` | `ExtractionResult` | Strategy B (network intercept) | Fallback cached data |

Storage is overwritten on each new extraction (not appended).

## 5. Integration Points

### Current (v1)

- **Gemini web app:** The extension operates on `gemini.google.com` pages, making API calls to `/_/BardChatUi/data/batchexecute`.
- **No backend integration** — v1 only extracts and displays.

### Future (wired up but not exercised in v1)

- **SPA ↔ Extension messaging:** `background.js` already handles `GET_GEMS` and `CLEAR_GEMS` external messages (Step 6), matching the protocol in `docs/context/ARCH.md` section 7.2.
- **Backend import payload alignment:** The `ExtractedGem` model's `instructions` field maps directly to the backend's `instructions` field in the import payload (`docs/context/ARCH.md` section 7.1).

### UI integration

- FAB injected into `gemini.google.com` pages (bottom-right corner, z-index 10000).
- Full-screen modal overlay (z-index 10001) for displaying results.
- No Chrome popup UI (`popup.html`). The spec does not include one — all UI is via the content script.

## 6. Edge Cases & Risks

### Authentication

| Risk | Mitigation |
|------|-----------|
| User not logged into Gemini | `fetchTokens()` detects redirect/missing `SNlM0e` and returns descriptive error (Step 7) |
| Session expires mid-extraction | 401 response from `batchexecute` triggers error message (Step 8) |
| Multiple Google accounts | Extension uses cookies for the active `gemini.google.com` session — correct behavior per spec |

### API stability

| Risk | Mitigation |
|------|-----------|
| Google changes `batchexecute` response format | Parser isolated in `parseGemsFromBatchResponse()` — single function to update. Strategy B serves as fallback |
| RPC ID `CNgdBe` changes | Both strategies stop working. Error message: "Extraction may have failed — try updating the extension" |
| Token embedding format changes | Strategy A breaks; Strategy B doesn't need tokens |

### Content script concerns

| Risk | Mitigation |
|------|-----------|
| Gemini SPA updates break page detection URLs | URL patterns are broad enough (`/gems/view`, `/gem/*`) to survive minor URL changes. `setInterval` polling is resilient |
| FAB overlaps Gemini UI elements | Fixed position at bottom-right with z-index 10000. May need adjustment if Gemini adds its own FAB |
| Multiple Gemini tabs | Each tab has independent content script. `chrome.storage.local` is shared — last extraction wins (acceptable for v1) |
| Injected fetch wrapper conflicts with page code | The wrapper calls `originalFetch.apply()` and only reads responses — doesn't modify them. Wrapped in try/catch to avoid breaking the page |

### Performance

| Risk | Mitigation |
|------|-----------|
| Large gem collections (100+ gems) | No pagination expected from API. Scrollable `<pre>` block handles large JSON. No DOM creation per gem (it's just text) |
| FAB click spam | `extractionInProgress` flag + disabled button prevents concurrent requests (Step 10) |
| 500ms polling interval | Negligible CPU cost for a string comparison on `location.href` |

## 7. Verification

### Manual test steps (by milestone)

**After Phase 1 (Steps 1-6):**
1. Load the extension in Chrome via `chrome://extensions` → "Load unpacked" → select `extension/` directory.
2. Navigate to `gemini.google.com/gems/view` — verify the blue FAB appears in the bottom-right.
3. Navigate to `gemini.google.com` (main chat page with no gems context) — verify FAB appears (it's a valid gems-accessible page per `/app` pattern).
4. Navigate to `gemini.google.com/gems/create` — verify FAB is hidden.
5. Click the FAB — verify overlay appears (with placeholder or error message).
6. Press Escape — verify overlay closes.
7. Click backdrop — verify overlay closes.

**After Phase 2 (Steps 7-10):**
1. Ensure you're logged into Gemini and have at least one custom gem.
2. Navigate to any gems page and click the FAB.
3. Verify the overlay shows JSON with your gems within 5 seconds.
4. Verify each gem has `id`, `name`, `description`, and `instructions` fields.
5. Verify `instructions` contains the full system prompt (not truncated).
6. Test with a user who has zero gems — verify "No custom gems found" message.
7. Test while logged out — verify "Please sign in to Gemini first" error.

**After Phase 3 (Steps 11-12):**
1. Load a Gemini gems page and let it load fully (this triggers the Gemini app's own API call).
2. Intentionally break Strategy A (e.g., temporarily corrupt the token regex).
3. Click the FAB — verify it falls back to intercepted data.
4. Verify the result shows `strategy: 'network_intercept'`.

**After Phase 4 (Steps 13-17):**
1. Click FAB — verify spinner appears during loading.
2. After success — verify brief checkmark, then return to idle.
3. Click "Copy to Clipboard" — paste into a text editor and verify valid JSON.
4. If gems have knowledge files — verify `knowledgeFiles` array appears in the JSON.

### Success criteria (from spec section 9)

**Must pass:**
1. FAB visible on `gemini.google.com/gems/view` and main app page.
2. FAB hidden on non-gems pages (regular chat).
3. Click → extraction → overlay within 5 seconds.
4. JSON array of all custom gems with `id`, `name`, `description`, `instructions`.
5. Full (non-truncated) instructions.
6. Overlay closes via backdrop click, X button, or Escape.
7. Empty state message for zero gems.
8. Error message (not silent crash) on failure.

**Should pass:**
9. Copy to Clipboard works with feedback.
10. FAB loading spinner and success/error indicators.
11. Works after SPA navigation (no full page reload needed).
12. Strategy B fallback captures data and serves it when Strategy A fails.

## 8. Open Questions

### Resolved (per user input)

| Question | Decision |
|----------|----------|
| Q1: Token extraction — fetch fresh or read from DOM? | **Fetch fresh** in the background script. Network round-trip is acceptable. |
| Q2: Distribution — corporate Chrome Web Store or sideload? | **Sideload** via developer mode. |
| Q3: Rate limiting / debounce? | **Disable FAB** while extraction is in progress. 10-second timeout. |
| Q4: Knowledge files? | **Yes**, capture file references. Include `knowledgeFiles` in extracted data. Provide opportunity for user action. |

### Remaining

| Question | Impact | When to resolve |
|----------|--------|----------------|
| Exact array position of knowledge file references in batchexecute response | Affects `extractKnowledgeFiles()` implementation (Step 15) | During live testing against Gemini API |
| Whether the `batchexecute` response uses byte-count or character-count for chunk lengths | Affects parsing logic if multi-byte characters are present | During live testing — start with character-count assumption |
| Whether Google serves different `batchexecute` response structures for different account types (Workspace vs. consumer) | Could affect parsing | Test with corporate Workspace account |
| Icon design for the FAB | Low impact — placeholder works for development | Before any wider distribution |
