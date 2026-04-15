# Executed: 2026-04-15T08:41:44.572362

Expand the Chrome extension's overlay UI so that when the user clicks the FAB (Gem Overlay button), the overlay window displays a list of all detected knowledge document links found on the page. Each knowledge document should be rendered as a clickable item within our overlay, giving the user clear feedback about what was detected and letting them interact with the documents directly from our interface rather than from the native Gem UI. This provides better visibility into what's actually happening during extraction.

Additionally, for each knowledge document link in the native Gem edit page UI, add a small "+" button right next to the existing "X" (close/remove) button. This "+" button should match the color and style of our main FAB overlay button, allowing users to act on individual documents with one click each without needing to open the full overlay.
