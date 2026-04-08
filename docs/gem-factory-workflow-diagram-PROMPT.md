# Gem Factory Workflow Diagram — Napkin AI Prompt

Use this prompt in Napkin AI to generate a visual diagram of the Gem Factory system workflow.

---

## Prompt

Create a clear, left-to-right workflow diagram showing the Gem Factory system — a tool for extracting and cataloging Google Gemini gem configurations across a corporate organization.

The diagram should show these components and data flows:

**Step 1 — Gem Edit Page**
The user opens a Gemini gem edit page on gemini.google.com. The page contains the gem name in an input field and the full instructions in a rich text editor.

**Step 2 — Chrome Extension Extracts**
The Gem Factory Chrome extension detects the edit page and shows a blue floating action button (FAB). The user clicks it. The extension reads the gem name and instructions directly from the page DOM.

**Step 3 — Local Storage**
The extracted gem is saved to the browser's local storage (chrome.storage.local). Gems accumulate over time as the user visits and extracts more gems. If the same gem is extracted again, the existing entry is updated rather than duplicated.

**Step 4 — Confirmation Overlay**
The extension shows a confirmation overlay on the page indicating the gem was saved, with an instructions preview and a running list of all gems collected so far.

**Step 5 — Popup Gem List**
The user can click the extension icon at any time to see a popup showing their full local gem collection with names, dates, and instruction previews. They can delete individual gems or copy all gems as JSON.

**Step 6 — Future: SPA Import (not yet built, show as dashed/grayed)**
A future web application (SPA) will communicate with the extension to retrieve the locally stored gems. The user reviews and confirms which gems to import.

**Step 7 — Future: API Server (not yet built, show as dashed/grayed)**
The SPA sends confirmed gems to the Gem Factory API server. The API normalizes instructions, hashes them for deduplication, and stores them in a PostgreSQL database with the user's identity.

**Step 8 — Future: Central Registry (not yet built, show as dashed/grayed)**
All imported gems live in a shared, searchable registry. Regular users see only their own gems. Admins see all gems across the organization.

Use a clean, modern style. Steps 1 through 5 should be solid and prominent since they are built and working. Steps 6 through 8 should be visually distinct — dashed outlines or lower opacity — to indicate they are planned but not yet implemented. Group steps 1-5 under a label like "Current (Local-First)" and steps 6-8 under "Planned (Server Integration)."
