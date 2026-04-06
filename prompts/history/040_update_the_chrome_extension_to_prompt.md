# Executed: 2026-04-05T14:39:54.287971

Update the Chrome extension to add a "Send to API" button alongside the existing "Copy to Clipboard" button in the overlay. The existing UI and functionality should stay the same — just add the new button.

When clicked, the new button should POST the extracted gem to the API server's import endpoint (`/api/gems/import`).

The extension needs a configurable API host URL (defaulting to `http://localhost:9090`) so it can be pointed at the eventual published API server. Add a configuration mechanism for this host setting.
