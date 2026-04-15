# Executed: 2026-04-08T08:22:09.825764

Refactor the Chrome extension (`extension/`) to work in a local-first, offline mode instead of pushing gems directly to the API. Here's what I want:

1. **Local gem storage:** When a user extracts a gem from the edit page, store it locally in the extension (using `chrome.storage.local` or similar) rather than sending it to the API. Each gem gets added to a persistent local list that accumulates over time as the user visits and extracts more gems.

2. **Gem list viewer:** Add a popup or UI accessible by clicking the extension icon where the user can view their full list of locally stored gems. This list should show all gems they've extracted so far and grow as they add more.

3. **Remove API and auth dependencies:** Strip out any OAuth, authentication, or direct API calls from the extension for now. The extension should be fully self-contained — no backend communication needed. The gem data lives entirely in the browser under the user's control.

4. **Preserve extraction functionality:** Keep the existing DOM extraction logic (FAB on gem edit pages, reading from `.ql-editor`, etc.) exactly as it works today. Only change where the extracted data goes — local storage instead of the API.

5. **Future-proof for batch push:** Don't build it yet, but keep in mind that a future step will add the ability to push the locally accumulated gems to the API in bulk. Don't make design choices that would make this harder later.
