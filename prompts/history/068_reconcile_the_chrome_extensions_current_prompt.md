# Executed: 2026-04-15T10:00:09.157321

Reconcile the Chrome extension's current gem data model with the API server, then add a "Save to Gem Factory" button in the extension popup.

**Context:** The extension (`extension/`) now captures significantly more data per gem than when the API server (`server/`) was originally built — including description, knowledge files (with Drive URLs), and enabled tools. The API server spec is at `docs/specs/api-server-SPEC.md`. The server's import endpoint and database schema need to be updated to accept and store all the fields the extension now captures.

**What I want:**

1. **Reconcile the data models.** Compare what the extension currently extracts and stores (see `content-script.js`, `background.js`) against what the API server's `/api/gems/import` endpoint and database schema accept. Update the server (schema, import endpoint, services) to handle all the fields the extension now captures.

2. **Add a "Save to Gem Factory" button in the extension popup.** When I click the extension icon in the browser toolbar, the popup (`popup.html` / `popup.js`) currently shows my saved gems with options to clear and copy all as JSON. Add a button that sends all captured gems to the API server's import endpoint, including the username of the logged-in user.

3. **Identity: defer auth, but wire up the user.** Everyone will ultimately authenticate via Google (supporting both Gmail and Cloud Identity/corporate domain accounts). For now, focus on getting the data plane working — make sure the gem data flows correctly from extension to server and is stored properly. We'll layer in the real authentication afterward.
