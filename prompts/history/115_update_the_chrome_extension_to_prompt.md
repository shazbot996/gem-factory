# Executed: 2026-06-09T08:56:05.383944

Update the Chrome extension to use the new logo image at `media/logo-icon.png` in two places:

1. **Browser toolbar icon** — Replace the current extension icon (currently placeholder PNGs in `extension/icons/`) that appears in the browser bar when the extension is enabled. Use `media/logo-icon.png` for this.

2. **Floating action button (FAB)** — Replace the current blue gem icon that appears in the bottom-right corner of the page when the extension activates on a gem edit page. Use the same `media/logo-icon.png` image, but rendered at a larger size than the toolbar icon.

Make whatever changes are needed in `extension/manifest.json`, `extension/icons/`, `extension/content-script.js`, and `extension/styles.css` (or wherever the FAB is defined) to wire up the new image in both locations.
