# Response: 2026-04-08T08:24:18.491792

I refactored the Chrome extension to be fully local and offline. The FAB extraction still works the same, but gems now accumulate in local storage instead of being sent to the API. There's a new popup accessible from the extension icon that shows all extracted gems with the ability to delete individual gems, copy all as JSON, or clear the list. All API calls, auth dependencies, and the options page have been removed.
