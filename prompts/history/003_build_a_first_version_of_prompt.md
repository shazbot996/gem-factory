# Prompt v1
# Saved: 2026-04-05T11:49:22.915409
# Fragments: 0

Build a first version of the Chrome extension for Gem Factory. Referring to the architecture in `docs/context/ARCH.md`, create a Manifest V3 Chrome extension that:

1. **Activates only on Gemini gem pages** (`gemini.google.com`), specifically when the user is viewing or editing gems.

2. **Investigates how gem data is accessible** — determine whether there's a way to extract all gems at once from a list/management page, or whether the user needs to visit each gem's edit screen individually. Implement whichever approach is possible, preferring the batch/one-step approach if feasible.

3. **Shows a floating action button** — a small button fixed to the bottom-right corner of the page. It should only appear when the extension detects it's on a relevant gems page.

4. **On button click, opens a full-screen modal overlay** that displays the captured gem data as pretty-printed JSON. This is just a proof-of-concept to verify extraction is working — no API calls yet.

5. Use the extraction strategies described in the architecture doc: DOM extraction from the gems management page, and/or network interception of internal API responses containing gem instruction text. Implement both strategies if possible, with DOM extraction as the primary approach.
