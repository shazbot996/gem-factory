# Response: 2026-04-15T10:40:51.129469

The server URL is configured directly in the extension popup. There's an API Server URL text field at the top that defaults to localhost 9090 and persists whatever you type. I also just added a wildcard host permission for run.app domains in the manifest, so when you deploy to Cloud Run you can just paste the URL in the popup and it'll work without any code changes.
