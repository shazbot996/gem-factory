# Response: 2026-04-05T12:49:59.900709

I completely restructured the extraction to make the API call from the Gemini page context itself, as a same-origin request, rather than from the extension's background script. This is identical to how the Gemini app calls its own backend. The tokens are extracted directly from the loaded page, no extra fetch needed. Reload and try again.
